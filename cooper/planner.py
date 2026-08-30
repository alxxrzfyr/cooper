"""What to do first, and when to do it.

Two small pure functions with no model and no I/O.

`rank` scores open tasks. `place` drops the top of that ranking into your working hours,
skipping anything already on the calendar. Working hours replace the old focus-window system:
same protection, one setting instead of a screen.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from zoneinfo import ZoneInfo

from cooper.db import Item, aware

# Score weights sum to 1. The deadline has the greatest weight.
W_DUE = 0.60
W_AGE = 0.15
W_QUICK = 0.25

HORIZON_DAYS = 14
MIN_SLOT = 20
MAX_SLOT = 90
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
        total = why["due"] * W_DUE + why["age"] * W_AGE + why["quick"] * W_QUICK
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
        "age": round(min(age_days / 21, 1.0), 3),
        "quick": round(quick, 3),
    }


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
        )

    def as_setting(self) -> dict:
        return {
            "start_hour": self.start_hour,
            "end_hour": self.end_hour,
            "weekdays": list(self.weekdays),
            "timezone": self.timezone,
            "max_per_day": self.max_per_day,
        }


def place(
    ranked: list[Scored],
    *,
    busy: list[tuple[dt.datetime, dt.datetime]],
    hours: Hours,
    at: dt.datetime,
    days: int = 7,
) -> list[Slot]:
    """Fit the ranked tasks into working hours, around whatever is already booked.

    Nothing lands outside your hours, because the only candidate times are built from them.

    A task with no estimate is skipped rather than given an invented length. This used to assume
    half an hour, on the grounds that skipping silently left an item stranded with nothing on
    screen explaining why. The dashboard's "waiting for a time" group is that explanation, so the
    guess is no longer buying anything — and an errand like "buy milk" should be on a list, not
    holding a booking.
    """
    zone = ZoneInfo(hours.timezone)
    earliest = at + dt.timedelta(minutes=LEAD)
    taken = sorted(busy)
    per_day: dict[dt.date, int] = {}
    slots: list[Slot] = []

    for entry in ranked:
        if entry.item.scheduled or entry.item.minutes is None:
            continue
        length = max(MIN_SLOT, min(entry.item.minutes, MAX_SLOT))

        placed = _first_gap(
            length=length,
            zone=zone,
            hours=hours,
            earliest=earliest,
            taken=taken,
            per_day=per_day,
            days=days,
        )
        if placed is None:
            continue

        start, end = placed
        slots.append(Slot(item_id=entry.item.id, title=entry.item.title, start=start, end=end))
        taken.append((start, end + dt.timedelta(minutes=GAP)))
        taken.sort()
        day = start.astimezone(zone).date()
        per_day[day] = per_day.get(day, 0) + 1

    return slots


def _first_gap(
    *,
    length: int,
    zone: ZoneInfo,
    hours: Hours,
    earliest: dt.datetime,
    taken: list[tuple[dt.datetime, dt.datetime]],
    per_day: dict[dt.date, int],
    days: int,
) -> tuple[dt.datetime, dt.datetime] | None:
    today = earliest.astimezone(zone).date()

    for offset in range(days):
        day = today + dt.timedelta(days=offset)
        if day.weekday() not in hours.weekdays:
            continue
        if per_day.get(day, 0) >= hours.max_per_day:
            continue

        window_start = dt.datetime.combine(day, dt.time(hours.start_hour), tzinfo=zone)
        window_end = dt.datetime.combine(day, dt.time(hours.end_hour), tzinfo=zone)
        cursor = max(window_start, earliest)

        while cursor + dt.timedelta(minutes=length) <= window_end:
            candidate_end = cursor + dt.timedelta(minutes=length)
            clash = next(
                ((start, end) for start, end in taken if start < candidate_end and cursor < end),
                None,
            )
            if clash is None:
                return (cursor, candidate_end)
            cursor = clash[1]
    return None
