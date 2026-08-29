"""Repositories for scheduling: windows, blocks, the outbox, and the calendar cache.

Grouped because they change together and are all thin row-to-value mappings. Each is small
enough to read in one sitting, and none of them contains a decision: policy lives in
`core` and orchestration in `services`.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from typing import Any, cast

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from cadence.adapters.models import (
    CalendarEventCacheModel,
    FocusWindowModel,
    OutboxModel,
    ScheduledBlockModel,
    SyncStateModel,
)
from cadence.core.windows import FocusWindow, Interval

BlockState = str


def _aware(moment: dt.datetime) -> dt.datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=dt.UTC)


# --------------------------------------------------------------------------- windows


class WindowRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, window: FocusWindow) -> None:
        self._session.add(
            FocusWindowModel(
                id=window.id,
                weekday=window.weekday,
                start_local=window.start_local,
                end_local=window.end_local,
                timezone=window.timezone,
                daily_block_cap=window.daily_block_cap,
                active=window.active,
            )
        )
        self._session.flush()

    def get(self, window_id: str) -> FocusWindow | None:
        row = self._session.get(FocusWindowModel, window_id)
        return None if row is None else self._to_domain(row)

    def update(self, window: FocusWindow) -> None:
        row = self._session.get(FocusWindowModel, window.id)
        if row is None:
            raise KeyError(window.id)
        row.weekday = window.weekday
        row.start_local = window.start_local
        row.end_local = window.end_local
        row.timezone = window.timezone
        row.daily_block_cap = window.daily_block_cap
        row.active = window.active
        self._session.flush()

    def delete(self, window_id: str) -> None:
        row = self._session.get(FocusWindowModel, window_id)
        if row is not None:
            self._session.delete(row)
            self._session.flush()

    def list(self, *, active_only: bool = False) -> tuple[FocusWindow, ...]:
        statement = select(FocusWindowModel)
        if active_only:
            statement = statement.where(FocusWindowModel.active.is_(True))
        statement = statement.order_by(FocusWindowModel.weekday, FocusWindowModel.start_local)
        return tuple(self._to_domain(row) for row in self._session.scalars(statement))

    @staticmethod
    def _to_domain(row: FocusWindowModel) -> FocusWindow:
        return FocusWindow(
            id=row.id,
            weekday=row.weekday,
            start_local=row.start_local,
            end_local=row.end_local,
            timezone=row.timezone,
            daily_block_cap=row.daily_block_cap,
            active=row.active,
        )


# ---------------------------------------------------------------------------- blocks


@dataclasses.dataclass(frozen=True, slots=True)
class ScheduledBlock:
    id: str
    task_id: str
    interval: Interval
    state: BlockState = "planned"
    google_event_id: str | None = None

    @property
    def is_live(self) -> bool:
        """Whether this block still represents time the user is expected to work."""
        return self.state in ("planned", "pushed")


class BlockRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, block: ScheduledBlock) -> None:
        self._session.add(
            ScheduledBlockModel(
                id=block.id,
                task_id=block.task_id,
                start_utc=block.interval.start_utc,
                end_utc=block.interval.end_utc,
                google_event_id=block.google_event_id,
                state=block.state,
            )
        )
        self._session.flush()

    def get(self, block_id: str) -> ScheduledBlock | None:
        row = self._session.get(ScheduledBlockModel, block_id)
        return None if row is None else self._to_domain(row)

    def update(self, block: ScheduledBlock) -> None:
        row = self._session.get(ScheduledBlockModel, block.id)
        if row is None:
            raise KeyError(block.id)
        row.task_id = block.task_id
        row.start_utc = block.interval.start_utc
        row.end_utc = block.interval.end_utc
        row.google_event_id = block.google_event_id
        row.state = block.state
        self._session.flush()

    def delete(self, block_id: str) -> None:
        row = self._session.get(ScheduledBlockModel, block_id)
        if row is not None:
            self._session.delete(row)
            self._session.flush()

    def list(
        self,
        *,
        states: tuple[str, ...] | None = None,
        since: dt.datetime | None = None,
        until: dt.datetime | None = None,
    ) -> tuple[ScheduledBlock, ...]:
        statement = select(ScheduledBlockModel)
        if states is not None:
            statement = statement.where(ScheduledBlockModel.state.in_(states))
        if since is not None:
            statement = statement.where(ScheduledBlockModel.end_utc > since)
        if until is not None:
            statement = statement.where(ScheduledBlockModel.start_utc < until)
        statement = statement.order_by(ScheduledBlockModel.start_utc, ScheduledBlockModel.id)
        return tuple(self._to_domain(row) for row in self._session.scalars(statement))

    def find_by_google_event(self, google_event_id: str) -> ScheduledBlock | None:
        statement = select(ScheduledBlockModel).where(
            ScheduledBlockModel.google_event_id == google_event_id
        )
        row = self._session.scalars(statement).first()
        return None if row is None else self._to_domain(row)

    @staticmethod
    def _to_domain(row: ScheduledBlockModel) -> ScheduledBlock:
        return ScheduledBlock(
            id=row.id,
            task_id=row.task_id,
            interval=Interval(
                start_utc=_aware(row.start_utc),
                end_utc=_aware(row.end_utc),
            ),
            state=row.state,
            google_event_id=row.google_event_id,
        )


# ---------------------------------------------------------------------------- outbox


@dataclasses.dataclass(frozen=True, slots=True)
class OutboxEntry:
    id: str
    mutation_id: str
    operation: str
    payload: dict[str, Any]
    attempts: int = 0
    next_attempt_at: dt.datetime | None = None
    state: str = "pending"


class OutboxRepository:
    """Durable queue of calendar writes.

    Exists so a calendar write never shares a transaction with a database write. A Google
    outage delays projection; it does not corrupt state.
    """

    def __init__(self, session: Session) -> None:
        self._session = session

    def enqueue(self, entry: OutboxEntry) -> None:
        self._session.add(
            OutboxModel(
                id=entry.id,
                mutation_id=entry.mutation_id,
                operation=entry.operation,
                payload_json=entry.payload,
                attempts=entry.attempts,
                next_attempt_at=entry.next_attempt_at,
                state=entry.state,
            )
        )
        self._session.flush()

    def due(self, *, now: dt.datetime, limit: int = 25) -> tuple[OutboxEntry, ...]:
        statement = (
            select(OutboxModel)
            .where(OutboxModel.state == "pending")
            .order_by(OutboxModel.id)
            .limit(limit)
        )
        entries = []
        for row in self._session.scalars(statement):
            scheduled = row.next_attempt_at
            if scheduled is not None and _aware(scheduled) > now:
                continue
            entries.append(self._to_domain(row))
        return tuple(entries)

    def mark_sent(self, entry_id: str) -> None:
        row = self._session.get(OutboxModel, entry_id)
        if row is not None:
            row.state = "sent"
            self._session.flush()

    def mark_failed(self, entry_id: str, *, retry_at: dt.datetime | None) -> None:
        """Record an attempt. With no retry time the entry is given up on."""
        row = self._session.get(OutboxModel, entry_id)
        if row is None:
            return
        row.attempts += 1
        if retry_at is None:
            row.state = "failed"
            row.next_attempt_at = None
        else:
            row.next_attempt_at = retry_at.astimezone(dt.UTC)
        self._session.flush()

    def count(self, *, state: str) -> int:
        statement = select(OutboxModel).where(OutboxModel.state == state)
        return len(list(self._session.scalars(statement)))

    @staticmethod
    def _to_domain(row: OutboxModel) -> OutboxEntry:
        return OutboxEntry(
            id=row.id,
            mutation_id=row.mutation_id,
            operation=row.operation,
            payload=cast(dict[str, Any], dict(row.payload_json or {})),
            attempts=row.attempts,
            next_attempt_at=(
                _aware(row.next_attempt_at) if row.next_attempt_at is not None else None
            ),
            state=row.state,
        )


# --------------------------------------------------------------------- calendar cache


class CalendarCacheRepository:
    """Busy-time awareness. Holds no sensitive fields because none are ever ingested."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def upsert(
        self,
        *,
        google_event_id: str,
        calendar_id: str,
        title: str,
        start_utc: dt.datetime,
        end_utc: dt.datetime,
        is_app_owned: bool,
        has_other_attendees: bool,
        updated_at: dt.datetime,
    ) -> None:
        row = self._session.get(CalendarEventCacheModel, google_event_id)
        if row is None:
            row = CalendarEventCacheModel(google_event_id=google_event_id)
            self._session.add(row)
        row.calendar_id = calendar_id
        row.title = title
        row.start_utc = start_utc
        row.end_utc = end_utc
        row.is_app_owned = is_app_owned
        row.has_other_attendees = has_other_attendees
        row.updated_at = updated_at
        self._session.flush()

    def remove(self, google_event_id: str) -> None:
        self._session.execute(
            delete(CalendarEventCacheModel).where(
                CalendarEventCacheModel.google_event_id == google_event_id
            )
        )
        self._session.flush()

    def busy_intervals(
        self,
        *,
        start: dt.datetime,
        end: dt.datetime,
        exclude_app_owned: bool = True,
    ) -> tuple[Interval, ...]:
        statement = select(CalendarEventCacheModel).where(
            CalendarEventCacheModel.end_utc > start,
            CalendarEventCacheModel.start_utc < end,
        )
        if exclude_app_owned:
            # App-owned blocks are tracked separately; counting them twice would make the
            # scheduler think its own plan was somebody else's meeting.
            statement = statement.where(CalendarEventCacheModel.is_app_owned.is_(False))
        intervals = []
        for row in self._session.scalars(statement):
            span = Interval(start_utc=_aware(row.start_utc), end_utc=_aware(row.end_utc))
            intervals.append(span)
        return tuple(sorted(intervals, key=lambda interval: interval.start_utc))

    def has_other_attendees(self, google_event_id: str) -> bool:
        row = self._session.get(CalendarEventCacheModel, google_event_id)
        return bool(row and row.has_other_attendees)

    def count(self) -> int:
        return len(list(self._session.scalars(select(CalendarEventCacheModel))))


# ------------------------------------------------------------------------ sync state


class SyncStateRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def token_for(self, calendar_id: str) -> str | None:
        row = self._session.get(SyncStateModel, calendar_id)
        return None if row is None else row.sync_token

    def save_token(
        self,
        calendar_id: str,
        token: str | None,
        *,
        at: dt.datetime,
    ) -> None:
        row = self._session.get(SyncStateModel, calendar_id)
        if row is None:
            row = SyncStateModel(calendar_id=calendar_id)
            self._session.add(row)
        row.sync_token = token
        row.last_synced_at = at.astimezone(dt.UTC)
        self._session.flush()

    def last_synced(self, calendar_id: str) -> dt.datetime | None:
        row = self._session.get(SyncStateModel, calendar_id)
        if row is None or row.last_synced_at is None:
            return None
        return _aware(row.last_synced_at)
