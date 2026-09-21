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

import dataclasses
import datetime as dt
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, Literal, Protocol

from cooper.db import Item, aware
from cooper.google import Busy

if TYPE_CHECKING:
    from cooper.db import Store
    from cooper.google import Calendar

Interval = tuple[dt.datetime, dt.datetime]


@dataclasses.dataclass(frozen=True, slots=True)
class Commitment:
    """One occupied span, regardless of where it was first recorded."""

    id: str
    source: str
    source_id: str | None
    aliases: tuple[str, ...]
    title: str
    kind: Literal["task", "event"]
    start: dt.datetime
    end: dt.datetime
    all_day: bool
    category: str
    editable: bool
    local_item_id: str | None = None
    description: str | None = None


def normalize_local_commitment(item: Item) -> Commitment | None:
    """Turn a scheduled database item into the read-only commitment shape."""
    start, end = aware(item.start_at), aware(item.end_at)
    if start is None or end is None or end <= start:
        return None

    item_source = item.source or "me"
    source = "cooper" if item_source == "me" else item_source
    source_id = item.id if source == "cooper" else item.source_ref
    aliases = {f"cooper:{item.id}"}
    if item_source != "me" and item.source_ref:
        aliases.add(f"{item_source}:{item.source_ref}")
    return Commitment(
        id=f"cooper:{item.id}",
        source=source,
        source_id=source_id,
        aliases=tuple(sorted(aliases)),
        title=item.title,
        kind="task" if item.kind == "task" else "event",
        start=start.astimezone(dt.UTC),
        end=end.astimezone(dt.UTC),
        all_day=False,
        category=item.category or "personal",
        editable=item_source == "me",
        local_item_id=item.id,
        description=item.notes,
    )


def normalize_provider_commitment(event: dict[str, Any]) -> Commitment:
    """Normalize an existing provider-display record without retaining private detail fields."""
    source = str(event.get("source") or "external")
    source_id = str(event["event_id"]) if event.get("event_id") else None
    identity = f"{source}:{source_id}" if source_id else _fallback_identity(source, event)
    start = _utc_moment(event.get("start_at"))
    end = _utc_moment(event.get("end_at"))
    if end <= start:
        raise ValueError("A commitment must end after it starts.")
    return Commitment(
        id=identity,
        source=source,
        source_id=source_id,
        aliases=(identity,),
        title=str(event.get("title") or "Busy"),
        kind="task" if event.get("kind") == "task" else "event",
        start=start,
        end=end,
        all_day=bool(event.get("all_day", False)),
        category=str(event.get("category") or "personal"),
        editable=False,
        description=event.get("description"),
    )


def deduplicate_commitments(commitments: Sequence[Commitment]) -> list[Commitment]:
    """Collapse only explicit identities or exact cross-source signatures."""
    unique: list[Commitment] = []
    for commitment in commitments:
        match = next(
            (
                existing
                for existing in unique
                if set(existing.aliases).intersection(commitment.aliases)
                or (
                    existing.source != commitment.source
                    and _signature(existing) == _signature(commitment)
                )
            ),
            None,
        )
        if match is None:
            unique.append(commitment)
            continue
        index = unique.index(match)
        primary = commitment if commitment.editable and not match.editable else match
        unique[index] = dataclasses.replace(
            primary,
            aliases=tuple(sorted(set(match.aliases).union(commitment.aliases))),
        )
    return sorted(unique, key=lambda entry: (entry.start, entry.end, entry.id))


def commitment_intervals(commitments: Sequence[Commitment]) -> list[Interval]:
    """Return each deduplicated commitment once for availability calculations."""
    return [(entry.start, entry.end) for entry in sorted(commitments, key=lambda item: item.start)]


def _utc_moment(value: object) -> dt.datetime:
    if isinstance(value, dt.datetime):
        moment = value
    elif isinstance(value, str):
        moment = dt.datetime.fromisoformat(value)
    else:
        raise ValueError("A commitment needs a start and end time.")
    return (moment if moment.tzinfo else moment.replace(tzinfo=dt.UTC)).astimezone(dt.UTC)


def _fallback_identity(source: str, event: dict[str, Any]) -> str:
    title = " ".join(str(event.get("title") or "Busy").casefold().split())
    return f"{source}:{title}:{event.get('start_at')}:{event.get('end_at')}"


def _signature(commitment: Commitment) -> tuple[object, ...]:
    return (
        " ".join(commitment.title.casefold().split()),
        commitment.start,
        commitment.end,
        commitment.all_day,
        commitment.description or "",
    )


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
