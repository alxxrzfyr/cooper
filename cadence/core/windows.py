"""Focus windows: the only calendar territory the scheduler may write into.

Windows are stored as local wall-clock times plus an IANA zone, so expanding them crosses
daylight-saving transitions. That is the whole reason this module exists as pure, separately
tested code: a naive implementation silently double-books one day a year, and one wrong day
is enough to stop trusting the calendar entirely.

Rules, matching spec section 10:
  - A local time that does not exist (spring-forward gap) shifts forward to the first valid
    instant.
  - An ambiguous local time (fall-back repeat) resolves to the first occurrence.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections.abc import Iterable, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cadence.core.errors import DomainValidationError

MINUTES_PER_DAY = 24 * 60


@dataclasses.dataclass(frozen=True, slots=True, order=True)
class Interval:
    """A half-open span of real time, [start, end), always in UTC."""

    start_utc: dt.datetime
    end_utc: dt.datetime

    def __post_init__(self) -> None:
        if self.start_utc.tzinfo is None or self.end_utc.tzinfo is None:
            raise DomainValidationError("interval bounds must carry a timezone")
        if self.end_utc <= self.start_utc:
            raise DomainValidationError("an interval must end after it starts")

    @property
    def duration_minutes(self) -> int:
        return int((self.end_utc - self.start_utc).total_seconds() // 60)

    def overlaps(self, other: Interval) -> bool:
        """True when the two spans share real time. Touching endpoints do not overlap."""
        return self.start_utc < other.end_utc and other.start_utc < self.end_utc

    def contains(self, other: Interval) -> bool:
        return self.start_utc <= other.start_utc and other.end_utc <= self.end_utc

    def subtract(self, busy: Iterable[Interval]) -> tuple[Interval, ...]:
        """Remove busy spans, returning whatever free pieces remain."""
        pieces = [self]
        for taken in merge_intervals(busy):
            next_pieces: list[Interval] = []
            for piece in pieces:
                if not piece.overlaps(taken):
                    next_pieces.append(piece)
                    continue
                if piece.start_utc < taken.start_utc:
                    next_pieces.append(Interval(piece.start_utc, taken.start_utc))
                if taken.end_utc < piece.end_utc:
                    next_pieces.append(Interval(taken.end_utc, piece.end_utc))
            pieces = next_pieces
        return tuple(pieces)


def merge_intervals(intervals: Iterable[Interval]) -> tuple[Interval, ...]:
    """Combine overlapping or touching spans into the smallest equivalent set."""
    ordered = sorted(intervals, key=lambda interval: interval.start_utc)
    merged: list[Interval] = []
    for interval in ordered:
        if merged and interval.start_utc <= merged[-1].end_utc:
            last = merged[-1]
            if interval.end_utc > last.end_utc:
                merged[-1] = Interval(last.start_utc, interval.end_utc)
        else:
            merged.append(interval)
    return tuple(merged)


@dataclasses.dataclass(frozen=True, slots=True)
class FocusWindow:
    """A recurring weekly span the user has donated to automatic scheduling."""

    id: str
    weekday: int
    start_local: dt.time
    end_local: dt.time
    timezone: str
    daily_block_cap: int = 3
    active: bool = True

    def __post_init__(self) -> None:
        if not 0 <= self.weekday <= 6:
            raise DomainValidationError("weekday must be 0 (Monday) through 6 (Sunday)")
        if self.end_local <= self.start_local:
            raise DomainValidationError("a window must end after it starts")
        if self.daily_block_cap <= 0:
            raise DomainValidationError("daily_block_cap must be positive")
        try:
            ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise DomainValidationError(f"unknown timezone {self.timezone!r}") from error

    @property
    def zone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone)


@dataclasses.dataclass(frozen=True, slots=True)
class WindowInstance:
    """One window on one concrete date, resolved to real time."""

    window: FocusWindow
    date: dt.date
    interval: Interval

    @property
    def cap(self) -> int:
        return self.window.daily_block_cap


def _resolve_local(day: dt.date, clock: dt.time, zone: ZoneInfo) -> dt.datetime:
    """Turn a local wall-clock time into a real instant, handling DST edge cases.

    A gap time (spring forward) is walked forward a minute at a time until it exists. An
    ambiguous time (fall back) takes the first occurrence, which is what `fold=0` means.
    """
    candidate = dt.datetime.combine(day, clock, tzinfo=zone).replace(fold=0)

    # A nonexistent local time does not survive a round trip through UTC.
    for _ in range(MINUTES_PER_DAY):
        if candidate.astimezone(dt.UTC).astimezone(zone).replace(tzinfo=zone) == candidate:
            return candidate
        candidate += dt.timedelta(minutes=1)
    return candidate


def expand_windows(
    windows: Sequence[FocusWindow],
    *,
    start: dt.date,
    days: int,
) -> tuple[WindowInstance, ...]:
    """Turn recurring windows into concrete UTC intervals over a date range."""
    if days < 0:
        raise DomainValidationError("days must not be negative")

    instances: list[WindowInstance] = []
    for offset in range(days):
        day = start + dt.timedelta(days=offset)
        for window in windows:
            if not window.active or window.weekday != day.weekday():
                continue
            zone = window.zone
            start_local = _resolve_local(day, window.start_local, zone)
            end_local = _resolve_local(day, window.end_local, zone)
            start_utc = start_local.astimezone(dt.UTC)
            end_utc = end_local.astimezone(dt.UTC)
            if end_utc <= start_utc:
                # A transition swallowed the whole window. Skip rather than invent time.
                continue
            instances.append(
                WindowInstance(
                    window=window,
                    date=day,
                    interval=Interval(start_utc=start_utc, end_utc=end_utc),
                )
            )

    instances.sort(key=lambda instance: (instance.interval.start_utc, instance.window.id))
    return tuple(instances)
