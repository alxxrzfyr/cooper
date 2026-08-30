"""Everywhere a commitment can come from, reduced to one thing: time already spoken for.

This is the pipe requirement 7 is built around. A meeting in Google, a meeting in Outlook, an
event RSVP'd to on Luma and read out of an email — to the scheduler these are all the same, a
`(start, end)` pair it must route around. `planner.place()` takes a list of those and does not
care who produced them.

Only Google exists today, plus the blocks Cooper placed itself. The second and third producers
(Microsoft, and events parsed from email) are named in PRD.md and are the reason this is a file
rather than a function inside app.py: when they arrive they add a `collect_*` here and append to
the same list, and nothing in the planner changes.

Two rules this file must keep:
  - It never writes. It reads commitments; it does not create, RSVP, or cancel anything.
  - A failed source never blocks the user. Each producer is wrapped, and a failure means less
    awareness of what is booked, never an empty plan or a raised error. Local is the source of
    truth; every remote is a mirror.
"""

from __future__ import annotations

import contextlib
import datetime as dt
from typing import TYPE_CHECKING, Protocol

from cooper.db import aware
from cooper.google import CalendarError

if TYPE_CHECKING:
    from cooper.db import Store
    from cooper.google import Calendar

Interval = tuple[dt.datetime, dt.datetime]


class _Blocks(Protocol):
    """The little that a remote calendar has to offer to be a source: busy intervals over N days.

    `calendar.busy()` already returns objects with `.start` and `.end`, so Google satisfies this
    as it stands. Microsoft will satisfy it the same way. Typed as a Protocol so a new source is
    a shape to match rather than a base class to inherit.
    """

    def busy(self, *, days: int) -> object: ...


def collect_google(calendar: Calendar, *, days: int) -> list[Interval]:
    """Busy intervals from Google Calendar, or nothing if it is off or unreachable."""
    if not calendar.connected:
        return []
    spans: list[Interval] = []
    # A calendar problem must not stop planning; it only means less awareness of what is booked.
    with contextlib.suppress(CalendarError):
        spans.extend((entry.start, entry.end) for entry in calendar.busy(days=days))
    return spans


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
    store: Store, calendar: Calendar, owner_id: str, *, at: dt.datetime, days: int = 14
) -> list[Interval]:
    """Every commitment, from every source, as one list of intervals the planner routes around.

    The one call the scheduler makes. Today it merges Google, local blocks and Gmail imports;
    when Microsoft lands it appends here and this signature does not change.
    """
    spans: list[Interval] = []
    spans.extend(collect_google(calendar, days=days))
    spans.extend(collect_gmail(store, owner_id, at=at))
    spans.extend(collect_local(store, owner_id, at=at))
    return spans
