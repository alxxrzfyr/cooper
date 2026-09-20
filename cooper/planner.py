"""What to do first, and when to do it.

Two small pure functions with no model and no I/O.

`rank` scores open tasks. `place` drops the top of that ranking into your working hours,
skipping anything already on the calendar. Working hours replace the old focus-window system:
same protection, one setting instead of a screen.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from typing import Literal
from zoneinfo import ZoneInfo

from cooper.db import Item, aware

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
) -> list[Slot]:
    """Place exact continuous sessions within availability and before deadlines."""
    zone = ZoneInfo(hours.timezone)
    earliest = at.astimezone(dt.UTC) + dt.timedelta(minutes=LEAD)
    taken = [(a.astimezone(dt.UTC), b.astimezone(dt.UTC)) for a, b in busy]
    counts: dict[dt.date, int] = {}
    minutes: dict[dt.date, float] = {}
    gap = dt.timedelta(minutes=hours.break_minutes)
    for item in scheduled or []:
        if item.status != "open" or item.kind != "task" or not item.scheduled:
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
        if item.scheduled or item.minutes is None or item.minutes <= 0:
            continue
        duration = dt.timedelta(minutes=item.minutes)
        deadline = aware(item.due)
        for window_start, window_end in windows:
            cursor = max(window_start, earliest)
            limit = min(window_end, deadline) if deadline else window_end
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
