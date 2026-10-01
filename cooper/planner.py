"""What to do first, and when to do it.

Two small pure functions with no model and no I/O.

`rank` scores open tasks. `place` drops the top of that ranking into your working hours,
skipping anything already on the calendar. Working hours replace the old focus-window system:
same protection, one setting instead of a screen.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections.abc import Sequence
from typing import Any, Literal
from zoneinfo import ZoneInfo

from cooper.db import Item, aware
from cooper.sources import Commitment, deduplicate_commitments, merge_intervals

# Score weights sum to 1. The deadline has the greatest weight.
W_DUE = 0.60
W_IMPORTANCE = 0.20
W_AGE = 0.10
W_QUICK = 0.10

HORIZON_DAYS = 14
GAP = 10
LEAD = 15


@dataclasses.dataclass(frozen=True, slots=True)
class Scored:
    item: Item
    score: float
    why: dict[str, float]

    @property
    def id(self) -> str:
        return self.item.id


def rank(items: list[Item], *, at: dt.datetime) -> list[Scored]:
    """Open tasks, most worth doing first. Pinned items jump the queue."""
    scored: list[Scored] = []
    for item in items:
        if item.status != "open" or item.kind != "task":
            continue
        why = _terms(item, at=at)
        total = (
            why["due"] * W_DUE
            + why["importance"] * W_IMPORTANCE
            + why["age"] * W_AGE
            + why["quick"] * W_QUICK
        )
        scored.append(Scored(item=item, score=round(total, 3), why=why))

    scored.sort(
        key=lambda entry: (
            not entry.item.pinned,
            -entry.score,
            aware(entry.item.created_at) or at,
            entry.item.id,
        )
    )
    return scored


def _terms(item: Item, *, at: dt.datetime) -> dict[str, float]:
    due = aware(item.due)
    if due is None:
        due_term = 0.0
    else:
        days = (due - at).total_seconds() / 86_400
        due_term = 1.0 if days <= 0 else max(0.0, 1.0 - days / HORIZON_DAYS)

    created = aware(item.created_at) or at
    age_days = max(0.0, (at - created).total_seconds() / 86_400)

    # Short tasks score slightly higher. Unestimated tasks stay in the middle.
    quick = 0.5 if item.minutes is None else max(0.0, 1.0 - min(item.minutes, 240) / 240)

    return {
        "due": round(due_term, 3),
        "importance": round((item.importance - 1) / 4, 3),
        "age": round(min(age_days / 21, 1.0), 3),
        "quick": round(quick, 3),
    }


TaskState = Literal[
    "not_started",
    "scheduled",
    "in_progress",
    "blocked",
    "overdue",
    "missed_block",
    "completed",
    "dropped",
]


def task_state(item: Item, *, at: dt.datetime, availability_complete: bool = True) -> TaskState:
    """Derive the useful planning state without adding workflow columns."""
    if item.status == "done":
        return "completed"
    if item.status == "dropped":
        return "dropped"

    due = aware(item.due)
    if due is not None and due < at:
        return "overdue"

    start, end = aware(item.start_at), aware(item.end_at)
    if start is not None and end is not None:
        if start <= at < end:
            return "in_progress"
        if end <= at:
            return "missed_block"
        return "scheduled"

    if not availability_complete and item.minutes is not None and item.minutes > 0:
        return "blocked"
    return "not_started"


def build_planning_snapshot(
    *,
    items: Sequence[Item],
    commitments: Sequence[Commitment],
    source_health: Sequence[dict[str, Any]],
    hours: Hours,
    at: dt.datetime,
) -> dict[str, Any]:
    """Project all planning facts once for every product surface."""
    zone = ZoneInfo(hours.timezone)
    at = at.astimezone(dt.UTC)
    today = at.astimezone(zone).date()
    day_start = dt.datetime.combine(today, dt.time(), tzinfo=zone).astimezone(dt.UTC)
    day_end = dt.datetime.combine(today + dt.timedelta(days=1), dt.time(), tzinfo=zone).astimezone(
        dt.UTC
    )
    complete = all(entry.get("status") == "ok" for entry in source_health)
    unique = deduplicate_commitments(commitments)
    today_commitments = [
        entry for entry in unique if entry.start < day_end and day_start < entry.end
    ]
    occupied = merge_intervals(
        [(max(entry.start, day_start), min(entry.end, day_end)) for entry in today_commitments]
    )
    ranked = rank(list(items), at=at)
    tasks = [
        {
            **entry.item.to_dict(),
            "score": entry.score,
            "why": entry.why,
            "state": task_state(entry.item, at=at, availability_complete=complete),
        }
        for entry in ranked
    ]

    largest_free = _largest_free_block(
        hours=hours,
        at=at,
        day_start=day_start,
        day_end=day_end,
        occupied=occupied,
    )
    current_free = _current_free_block(
        hours=hours,
        at=at,
        day_start=day_start,
        day_end=day_end,
        occupied=occupied,
    )

    active = next((entry for entry in unique if entry.start <= at < entry.end), None)
    upcoming = next((entry for entry in unique if entry.start > at), None)
    projected = (
        project_open_tasks(
            items=items,
            remote_busy=[(entry.start, entry.end) for entry in unique if entry.source != "cooper"],
            hours=hours,
            at=at,
        )
        if complete
        else []
    )
    recommended = next(
        (slot for slot in projected if slot.start == at + dt.timedelta(minutes=LEAD)), None
    )
    candidate_ids = {slot.item_id for slot in projected}
    for task in tasks:
        if task["id"] in candidate_ids:
            task["waiting_reason"] = "Not scheduled yet; an unsaved candidate slot is available."
    capacity = assess_today_capacity(
        items=items,
        hours=hours,
        at=at,
        complete=complete,
        projected_slots=projected,
        occupied=occupied,
    )

    risks: list[dict[str, Any]] = []
    for entry in ranked:
        state = task_state(entry.item, at=at, availability_complete=complete)
        if state in {"overdue", "missed_block", "blocked"}:
            risks.append({"kind": state, "item_id": entry.item.id})
    for health in source_health:
        if health.get("status") != "ok":
            risks.append(
                {
                    "kind": "source_unavailable",
                    "source": health.get("source"),
                    **({"message": health["message"]} if health.get("message") else {}),
                }
            )

    conflicts = 0
    conflict_ids: set[str] = set()
    for index, first in enumerate(unique):
        for second in unique[index + 1 :]:
            if first.start < second.end and second.start < first.end:
                conflicts += 1
                conflict_ids.update((first.id, second.id))
                risks.append(
                    {
                        "kind": "conflict",
                        "commitment_ids": [first.id, second.id],
                    }
                )

    occupied_minutes = round(sum((end - start).total_seconds() / 60 for start, end in occupied))
    return {
        "generated_at": at.isoformat(),
        "today": today.isoformat(),
        "timezone": hours.timezone,
        "complete": complete,
        "source_health": list(source_health),
        "commitments": [
            _commitment_dict(entry, conflict=entry.id in conflict_ids) for entry in unique
        ],
        "tasks": tasks,
        "focus": {
            "now_id": active.id if active else recommended.item_id if recommended else None,
            "next_id": upcoming.id if upcoming else None,
        },
        "risks": risks,
        "recommended_start_at": recommended.start.isoformat() if recommended else None,
        "capacity": capacity,
        "metrics": {
            "scheduled_count": len(today_commitments),
            "occupied_minutes": occupied_minutes,
            "remaining_effort_minutes": sum(
                item.minutes or 0 for item in items if item.kind == "task" and item.status == "open"
            ),
            "current_free_block_minutes": current_free,
            "largest_free_block_minutes": largest_free,
            "conflict_count": conflicts,
        },
    }


def project_open_tasks(
    *,
    items: Sequence[Item],
    remote_busy: Sequence[tuple[dt.datetime, dt.datetime]],
    hours: Hours,
    at: dt.datetime,
    days: int = 7,
    item_ids: Sequence[str] | None = None,
    released: frozenset[str] = frozenset(),
) -> list[Slot]:
    """Share one ranked cohort and placement algorithm across assessment and scheduling."""
    local = [item for item in items if (item.source or "me") == "me"]
    selected = set(item_ids or [])
    busy = [
        *remote_busy,
        *(
            (aware(item.start_at), aware(item.end_at))
            for item in items
            if item.start_at and item.end_at and item.id not in released
        ),
    ]
    return place(
        rank([item for item in local if not selected or item.id in selected], at=at),
        busy=busy,
        hours=hours,
        at=at,
        days=days,
        scheduled=local,
        released=released,
    )


@dataclasses.dataclass(frozen=True, slots=True)
class RecoveryMove:
    item_id: str
    title: str
    old_start: dt.datetime
    old_end: dt.datetime
    start: dt.datetime
    end: dt.datetime


@dataclasses.dataclass(frozen=True, slots=True)
class RecoveryPlan:
    moves: list[RecoveryMove]
    kept: list[tuple[str, str]]
    unplaced: list[tuple[str, str]]


def preview_recovery(
    *,
    items: Sequence[Item],
    remote_busy: Sequence[tuple[dt.datetime, dt.datetime]],
    hours: Hours,
    at: dt.datetime,
    days: int = 7,
) -> RecoveryPlan:
    """Re-place missed local blocks without mutating inputs; pinned blocks stay put."""
    missed = sorted(
        (
            item
            for item in items
            if (item.source or "me") == "me"
            and item.kind == "task"
            and item.status == "open"
            and item.start_at
            and item.end_at
            and aware(item.end_at) <= at
        ),
        key=lambda item: aware(item.start_at),
    )
    kept = [(item.id, "pinned") for item in missed if item.pinned]
    released = frozenset(item.id for item in missed if not item.pinned)
    if not released:
        return RecoveryPlan(moves=[], kept=kept, unplaced=[])
    slots = {
        slot.item_id: slot
        for slot in project_open_tasks(
            items=items,
            remote_busy=remote_busy,
            hours=hours,
            at=at,
            days=days,
            item_ids=sorted(released),
            released=released,
        )
    }
    moves: list[RecoveryMove] = []
    unplaced: list[tuple[str, str]] = []
    for item in missed:
        if item.id not in released:
            continue
        slot = slots.get(item.id)
        if slot is not None:
            moves.append(
                RecoveryMove(
                    item_id=item.id,
                    title=item.title,
                    old_start=aware(item.start_at),
                    old_end=aware(item.end_at),
                    start=slot.start,
                    end=slot.end,
                )
            )
        elif item.due and aware(item.due) < at:
            unplaced.append((item.id, "overdue"))
        elif not item.minutes:
            unplaced.append((item.id, "unknown_estimate"))
        else:
            unplaced.append((item.id, "no_feasible_slot"))
    return RecoveryPlan(moves=moves, kept=kept, unplaced=unplaced)


def assess_today_capacity(
    *,
    items: Sequence[Item],
    hours: Hours,
    at: dt.datetime,
    complete: bool,
    projected_slots: Sequence[Slot],
    occupied: Sequence[tuple[dt.datetime, dt.datetime]],
) -> dict[str, Any]:
    zone = ZoneInfo(hours.timezone)
    today = at.astimezone(zone).date()
    end = dt.datetime.combine(today + dt.timedelta(days=1), dt.time(), tzinfo=zone).astimezone(
        dt.UTC
    )
    local = [
        item
        for item in items
        if (item.source or "me") == "me" and item.kind == "task" and item.status == "open"
    ]
    pending = [item for item in local if not item.scheduled]
    due_today = [
        item for item in pending if aware(item.due) is not None and at <= aware(item.due) < end
    ]
    overdue = [item for item in pending if aware(item.due) is not None and aware(item.due) < at]
    unknown = [item for item in due_today if not item.minutes or item.minutes <= 0]
    known = [item for item in due_today if item not in unknown]
    due_ids = {item.id for item in due_today}
    candidates = [slot for slot in projected_slots if slot.item_id in due_ids and slot.end <= end]
    placed = {slot.item_id for slot in candidates}
    unplaced = [{"item_id": item.id, "reason": "overdue"} for item in overdue]
    if complete:
        unplaced.extend(
            {"item_id": item.id, "reason": "no_feasible_slot"}
            for item in known
            if item.id not in placed
        )
    padded = list(occupied)
    gap = dt.timedelta(minutes=hours.break_minutes)
    for item in local:
        if item.start_at and item.end_at:
            padded.append((aware(item.start_at) - gap, aware(item.end_at) + gap))
    open_minutes = 0
    if complete:
        for start, stop in _windows(hours, at, 1):
            cursor, stop = max(start, at + dt.timedelta(minutes=LEAD)), min(stop, end)
            for busy_start, busy_end in merge_intervals(padded):
                if busy_end <= cursor or busy_start >= stop:
                    continue
                open_minutes += max(0, (min(busy_start, stop) - cursor).total_seconds() / 60)
                cursor = max(cursor, busy_end)
            open_minutes += max(0, (stop - cursor).total_seconds() / 60)
    return {
        "day": today.isoformat(),
        "generated_at": at.isoformat(),
        "status": "source_unavailable"
        if not complete
        else "needs_estimates"
        if unknown
        else "checked",
        "demand_scope": "due_today_unscheduled",
        "scheduling_scope": "all_open_local_tasks_7_days",
        "due_today_ids": [item.id for item in due_today],
        "overdue_ids": [item.id for item in overdue],
        "other_backlog_count": len(pending) - len(due_today) - len(overdue),
        "missed_block_ids": [item.id for item in local if item.end_at and aware(item.end_at) <= at],
        "unknown_estimate_ids": [item.id for item in unknown],
        "unknown_estimate_count": len(unknown),
        "assessment_partial": bool(unknown),
        "known_estimated_due_today_minutes": sum(item.minutes for item in known),
        "candidate_slots": [
            {
                "item_id": slot.item_id,
                "start_at": slot.start.isoformat(),
                "end_at": slot.end.isoformat(),
            }
            for slot in candidates
        ],
        "unplaced": unplaced,
        **({"open_window_minutes": round(open_minutes)} if complete else {}),
    }


def _commitment_dict(commitment: Commitment, *, conflict: bool) -> dict[str, Any]:
    return {
        "id": commitment.id,
        "source": commitment.source,
        "source_id": commitment.source_id,
        "aliases": list(commitment.aliases),
        "title": commitment.title,
        "kind": commitment.kind,
        "start_at": commitment.start.isoformat(),
        "end_at": commitment.end.isoformat(),
        "all_day": commitment.all_day,
        "category": commitment.category,
        "editable": commitment.editable,
        "local_item_id": commitment.local_item_id,
        "conflict": conflict,
    }


def _largest_free_block(
    *,
    hours: Hours,
    at: dt.datetime,
    day_start: dt.datetime,
    day_end: dt.datetime,
    occupied: list[tuple[dt.datetime, dt.datetime]],
) -> int:
    largest = 0.0
    for window_start, window_end in _windows(hours, day_start, 1):
        cursor = max(window_start, day_start, at)
        limit = min(window_end, day_end)
        for busy_start, busy_end in occupied:
            if busy_end <= cursor or busy_start >= limit:
                continue
            largest = max(largest, (min(busy_start, limit) - cursor).total_seconds() / 60)
            cursor = max(cursor, busy_end)
        largest = max(largest, (limit - cursor).total_seconds() / 60)
    return max(0, round(largest))


def _current_free_block(
    *,
    hours: Hours,
    at: dt.datetime,
    day_start: dt.datetime,
    day_end: dt.datetime,
    occupied: list[tuple[dt.datetime, dt.datetime]],
) -> int:
    for window_start, window_end in _windows(hours, day_start, 1):
        limit = min(window_end, day_end)
        if not window_start <= at < limit:
            continue
        for busy_start, busy_end in occupied:
            if busy_end <= at:
                continue
            if busy_start <= at:
                return 0
            limit = min(limit, busy_start)
            break
        return max(0, int((limit - at).total_seconds() // 60))
    return 0


@dataclasses.dataclass(frozen=True, slots=True)
class Slot:
    item_id: str
    title: str
    start: dt.datetime
    end: dt.datetime

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


@dataclasses.dataclass(frozen=True, slots=True)
class Hours:
    """When you are willing to work. The only place the scheduler may put anything."""

    start_hour: int = 9
    end_hour: int = 18
    weekdays: tuple[int, ...] = (0, 1, 2, 3, 4)
    timezone: str = "Asia/Singapore"
    max_per_day: int = 4
    windows: tuple[tuple[int, int, int], ...] | None = None
    break_minutes: int = GAP
    max_minutes_per_day: int | None = None

    @classmethod
    def from_setting(cls, value: dict | None) -> Hours:
        if not value:
            return cls()
        return cls(
            start_hour=int(value.get("start_hour", 9)),
            end_hour=int(value.get("end_hour", 18)),
            weekdays=tuple(value.get("weekdays", [0, 1, 2, 3, 4])),
            timezone=str(value.get("timezone", "Asia/Singapore")),
            max_per_day=int(value.get("max_per_day", 4)),
            windows=(
                tuple(tuple(w) for w in value["windows"])
                if value.get("windows") is not None
                else None
            ),
            break_minutes=int(value.get("break_minutes", GAP)),
            max_minutes_per_day=value.get("max_minutes_per_day"),
        )

    def as_setting(self) -> dict:
        return {
            "start_hour": self.start_hour,
            "end_hour": self.end_hour,
            "weekdays": list(self.weekdays),
            "timezone": self.timezone,
            "max_per_day": self.max_per_day,
            "windows": [list(w) for w in self.windows] if self.windows is not None else None,
            "break_minutes": self.break_minutes,
            "max_minutes_per_day": self.max_minutes_per_day,
        }


def place(
    ranked: list[Scored],
    *,
    busy: list[tuple[dt.datetime, dt.datetime]],
    hours: Hours,
    at: dt.datetime,
    days: int = 7,
    scheduled: list[Item] | None = None,
    until: dt.datetime | None = None,
    released: frozenset[str] = frozenset(),
) -> list[Slot]:
    """Place exact continuous sessions within availability and before deadlines.

    `released` items keep their stored slot but are treated as unscheduled: their old
    time is neither reserved nor counted, and they may be placed again.
    """
    zone = ZoneInfo(hours.timezone)
    earliest = at.astimezone(dt.UTC) + dt.timedelta(minutes=LEAD)
    taken = [(a.astimezone(dt.UTC), b.astimezone(dt.UTC)) for a, b in busy]
    counts: dict[dt.date, int] = {}
    minutes: dict[dt.date, float] = {}
    gap = dt.timedelta(minutes=hours.break_minutes)
    for item in scheduled or []:
        if (
            item.id in released
            or item.status != "open"
            or item.kind != "task"
            or not item.scheduled
        ):
            continue
        start, end = aware(item.start_at), aware(item.end_at)
        if start is None or end is None:
            continue
        taken.append((start - gap, end + gap))
        day = start.astimezone(zone).date()
        counts[day] = counts.get(day, 0) + 1
        for work_day, work_minutes in _day_minutes(start, end, zone).items():
            minutes[work_day] = minutes.get(work_day, 0) + work_minutes
    taken.sort()
    windows = _windows(hours, earliest, days)
    slots: list[Slot] = []
    for entry in ranked:
        item = entry.item
        if (
            (item.scheduled and item.id not in released)
            or item.minutes is None
            or item.minutes <= 0
        ):
            continue
        duration = dt.timedelta(minutes=item.minutes)
        deadline = aware(item.due)
        for window_start, window_end in windows:
            cursor = max(window_start, earliest)
            limit = min(window_end, deadline) if deadline else window_end
            if until is not None:
                limit = min(limit, until.astimezone(dt.UTC))
            while cursor + duration <= limit:
                day = cursor.astimezone(zone).date()
                end = cursor + duration
                usage = _day_minutes(cursor, end, zone)
                if counts.get(day, 0) >= hours.max_per_day or (
                    hours.max_minutes_per_day is not None
                    and any(
                        minutes.get(work_day, 0) + work_minutes > hours.max_minutes_per_day
                        for work_day, work_minutes in usage.items()
                    )
                ):
                    cursor = dt.datetime.combine(
                        day + dt.timedelta(days=1), dt.time(), tzinfo=zone
                    ).astimezone(dt.UTC)
                    continue
                clash = next(((a, b) for a, b in taken if a < end and cursor < b), None)
                if clash:
                    cursor = clash[1]
                    continue
                slots.append(Slot(item_id=item.id, title=item.title, start=cursor, end=end))
                taken.append((cursor - gap, end + gap))
                taken.sort()
                counts[day] = counts.get(day, 0) + 1
                for work_day, work_minutes in usage.items():
                    minutes[work_day] = minutes.get(work_day, 0) + work_minutes
                break
            else:
                continue
            break
    return slots


def accepts_interval(
    *,
    start: dt.datetime,
    end: dt.datetime,
    busy: Sequence[tuple[dt.datetime, dt.datetime]],
    hours: Hours,
    at: dt.datetime,
    deadline: dt.datetime | None = None,
    scheduled: Sequence[Item] | None = None,
    skip_item_id: str | None = None,
    days: int = 7,
) -> bool:
    """Return whether one exact interval satisfies the same rules as `place()`."""
    zone = ZoneInfo(hours.timezone)
    start = start.astimezone(dt.UTC)
    end = end.astimezone(dt.UTC)
    at = at.astimezone(dt.UTC)
    if end <= start:
        return False
    deadline_utc = deadline.astimezone(dt.UTC) if deadline else None
    if deadline_utc is not None and end > deadline_utc:
        return False

    gap = dt.timedelta(minutes=hours.break_minutes)
    earliest = at + dt.timedelta(minutes=LEAD)
    if start < earliest:
        return False

    windows = _windows(hours, at, days)
    if not any(
        window_start <= start
        and end <= (min(window_end, deadline_utc) if deadline_utc else window_end)
        for window_start, window_end in windows
    ):
        return False

    counts: dict[dt.date, int] = {}
    minutes: dict[dt.date, float] = {}
    taken = [(a.astimezone(dt.UTC), b.astimezone(dt.UTC)) for a, b in busy]
    for item in scheduled or []:
        if item.id == skip_item_id or item.status != "open" or item.kind != "task":
            continue
        item_start, item_end = aware(item.start_at), aware(item.end_at)
        if item_start is None or item_end is None:
            continue
        taken.append((item_start - gap, item_end + gap))
        day = item_start.astimezone(zone).date()
        counts[day] = counts.get(day, 0) + 1
        for work_day, work_minutes in _day_minutes(item_start, item_end, zone).items():
            minutes[work_day] = minutes.get(work_day, 0) + work_minutes

    day = start.astimezone(zone).date()
    usage = _day_minutes(start, end, zone)
    if counts.get(day, 0) >= hours.max_per_day or (
        hours.max_minutes_per_day is not None
        and any(
            minutes.get(work_day, 0) + work_minutes > hours.max_minutes_per_day
            for work_day, work_minutes in usage.items()
        )
    ):
        return False

    return not any(busy_start < end and start < busy_end for busy_start, busy_end in taken)


def _day_minutes(start: dt.datetime, end: dt.datetime, zone: ZoneInfo) -> dict[dt.date, float]:
    """Charge elapsed work to every local date it actually occupies."""
    usage: dict[dt.date, float] = {}
    cursor = start.astimezone(dt.UTC)
    end = end.astimezone(dt.UTC)
    while cursor < end:
        day = cursor.astimezone(zone).date()
        next_midnight = dt.datetime.combine(
            day + dt.timedelta(days=1), dt.time(), tzinfo=zone
        ).astimezone(dt.UTC)
        boundary = min(end, next_midnight)
        usage[day] = usage.get(day, 0) + (boundary - cursor).total_seconds() / 60
        cursor = boundary
    return usage


def _windows(
    hours: Hours, earliest: dt.datetime, days: int
) -> list[tuple[dt.datetime, dt.datetime]]:
    """Expand local windows, including yesterday's overnight tail, into UTC."""
    zone = ZoneInfo(hours.timezone)
    today = earliest.astimezone(zone).date()
    rules = (
        hours.windows
        if hours.windows is not None
        else tuple((day, hours.start_hour * 60, hours.end_hour * 60) for day in hours.weekdays)
    )
    windows = []
    horizon = dt.datetime.combine(
        today + dt.timedelta(days=days), dt.time(), tzinfo=zone
    ).astimezone(dt.UTC)
    for offset in range(-1, days):
        day = today + dt.timedelta(days=offset)
        midnight = dt.datetime.combine(day, dt.time(), tzinfo=zone)
        for weekday, start_minute, end_minute in rules:
            if day.weekday() != weekday:
                continue
            start = (midnight + dt.timedelta(minutes=start_minute)).astimezone(dt.UTC)
            end = (
                midnight
                + dt.timedelta(minutes=end_minute + (1440 if end_minute <= start_minute else 0))
            ).astimezone(dt.UTC)
            end = min(end, horizon)
            if end > max(start, earliest):
                windows.append((start, end))
    merged: list[tuple[dt.datetime, dt.datetime]] = []
    for start, end in sorted(windows):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged
