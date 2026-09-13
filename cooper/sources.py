"""Everywhere a commitment can come from, reduced to one thing: time already spoken for.

This is the pipe requirement 7 is built around. A meeting in Google, a meeting in Outlook, an
event RSVP'd to on Luma and read out of an email — to the scheduler these are all the same, a
`(start, end)` pair it must route around. `planner.place()` takes a list of those and does not
care who produced them.

Google, iCloud, Cooper blocks, and supported Gmail confirmations exist today. Future Teams and
Classroom inputs are named in PRD.md; adding them should not change the planner.

Two rules this file must keep:
  - It never writes. It reads commitments; it does not create, RSVP, or cancel anything.
  - A failed connected calendar read must be reported to the scheduling caller. The item can be
    saved locally, but cannot be placed against an incomplete busy-time picture.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence
from typing import TYPE_CHECKING, Protocol

from cooper.db import aware
from cooper.google import Busy

if TYPE_CHECKING:
    from cooper.db import Store
    from cooper.google import Calendar

Interval = tuple[dt.datetime, dt.datetime]


class CalendarProvider(Protocol):
    @property
    def connected(self) -> bool: ...

    def busy(self, *, days: int) -> list[Busy]: ...


def collect_google(calendar: CalendarProvider | None, *, days: int) -> list[Interval]:
    """Busy intervals from a connected calendar, or nothing when it is disconnected."""
    if calendar is None or not calendar.connected:
        return []
    return [(entry.start, entry.end) for entry in calendar.busy(days=days)]


def collect_local(store: Store, owner_id: str, *, at: dt.datetime) -> list[Interval]:  # noqa: ARG001
    """Local blocks, leaving Gmail rows to their own collector exactly once."""
    spans: list[Interval] = []
    with store.session() as session:
        for item in store.open_items(session, owner_id):
            if item.source == "gmail":
                continue
            start, end = aware(item.start_at), aware(item.end_at)
            if start and end:
                spans.append((start, end))
    return spans


def collect_gmail(store: Store, owner_id: str, *, at: dt.datetime) -> list[Interval]:  # noqa: ARG001
    """Open commitments parsed from Gmail, which never reach a Calendar writer."""
    spans: list[Interval] = []
    with store.session() as session:
        for item in store.open_items(session, owner_id):
            if item.source != "gmail":
                continue
            start, end = aware(item.start_at), aware(item.end_at)
            if start and end:
                spans.append((start, end))
    return spans


def busy_windows(
    store: Store,
    owner_id: str,
    calendar: Calendar | None,
    *,
    at: dt.datetime,
    days: int = 14,
    providers: Sequence[CalendarProvider] = (),
) -> list[Interval]:
    """Every commitment, from every source, as one list of intervals the planner routes around.

    Today it merges Google, iCloud, local blocks, and Gmail imports. Connected calendar errors
    propagate to the caller, which leaves new tasks waiting rather than guessing at free time.
    """
    spans: list[Interval] = []
    spans.extend(collect_google(calendar, days=days))
    for provider in providers:
        spans.extend(collect_google(provider, days=days))
    spans.extend(collect_gmail(store, owner_id, at=at))
    spans.extend(collect_local(store, owner_id, at=at))
    return spans


def merge_intervals(spans: list[Interval]) -> list[Interval]:
    merged: list[Interval] = []
    for start, end in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    return merged
