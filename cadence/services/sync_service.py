"""Calendar synchronisation: draining the outbox and reading changes back.

The outbox drain is the only place a Google write happens. It runs after the database has
already committed, so a Google outage delays projection rather than corrupting state.

Reading back treats the user as the authority. A block moved by hand becomes `user_moved` and
is never re-placed automatically; a block deleted by hand becomes `orphaned` and its task
returns to the backlog. Fighting the user's own edit would be the fastest way to lose trust.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from cadence.adapters.google_calendar import (
    CalendarAuthError,
    CalendarSyncTokenExpired,
    GoogleCalendarClient,
    ScrubbedEvent,
)
from cadence.adapters.schedule_repositories import (
    BlockRepository,
    CalendarCacheRepository,
    OutboxRepository,
    SyncStateRepository,
)
from cadence.core.errors import ProviderError, QuotaExhaustedError
from cadence.core.protocols import Clock
from cadence.core.windows import Interval

MAX_ATTEMPTS = 5
BACKOFF_BASE_SECONDS = 30
FULL_READ_WINDOW_DAYS = 30


@dataclasses.dataclass(frozen=True, slots=True)
class DrainReport:
    sent: int = 0
    failed: int = 0
    deferred: int = 0

    @property
    def attempted(self) -> int:
        return self.sent + self.failed + self.deferred


@dataclasses.dataclass(frozen=True, slots=True)
class PullReport:
    ingested: int = 0
    user_moved: int = 0
    orphaned: int = 0
    removed: int = 0
    full_resync: bool = False


class SyncService:
    def __init__(
        self,
        *,
        client: GoogleCalendarClient,
        blocks: BlockRepository,
        outbox: OutboxRepository,
        cache: CalendarCacheRepository,
        sync_state: SyncStateRepository,
        clock: Clock,
        write_calendar_id: str,
        busy_calendar_ids: tuple[str, ...],
    ) -> None:
        self._client = client
        self._blocks = blocks
        self._outbox = outbox
        self._cache = cache
        self._sync_state = sync_state
        self._clock = clock
        self._write_calendar_id = write_calendar_id
        self._busy_calendar_ids = busy_calendar_ids

    # -------------------------------------------------------------------- writing

    def drain_outbox(self, *, limit: int = 25) -> DrainReport:
        now = self._clock.now()
        sent = failed = deferred = 0

        for entry in self._outbox.due(now=now, limit=limit):
            block_id = str(entry.payload.get("block_id", ""))
            block = self._blocks.get(block_id)
            calendar_id = str(entry.payload.get("calendar_id") or self._write_calendar_id)

            try:
                if entry.operation == "insert":
                    if block is None or not block.is_live:
                        # The block was released before we got here; nothing to project.
                        self._outbox.mark_sent(entry.id)
                        sent += 1
                        continue
                    event_id = _event_id_for(block_id)
                    returned = self._client.insert_block(
                        calendar_id=calendar_id,
                        event_id=event_id,
                        block_id=block_id,
                        title=str(entry.payload.get("title") or f"Focus: {block.task_id}"),
                        start_utc=block.interval.start_utc,
                        end_utc=block.interval.end_utc,
                    )
                    self._blocks.update(
                        dataclasses.replace(block, google_event_id=returned, state="pushed")
                    )
                elif entry.operation == "delete":
                    event_id = str(entry.payload.get("google_event_id") or "") or _event_id_for(
                        block_id
                    )
                    self._client.delete_block(calendar_id=calendar_id, event_id=event_id)
                else:
                    raise ProviderError(f"unknown outbox operation {entry.operation!r}")

                self._outbox.mark_sent(entry.id)
                sent += 1

            except (QuotaExhaustedError, ProviderError, CalendarAuthError) as error:
                attempts = entry.attempts + 1
                if attempts >= MAX_ATTEMPTS:
                    self._outbox.mark_failed(entry.id, retry_at=None)
                    failed += 1
                else:
                    # Exponential backoff, so a transient outage is not hammered.
                    delay = BACKOFF_BASE_SECONDS * (2 ** (attempts - 1))
                    self._outbox.mark_failed(
                        entry.id,
                        retry_at=now + dt.timedelta(seconds=delay),
                    )
                    deferred += 1
                _ = error

        return DrainReport(sent=sent, failed=failed, deferred=deferred)

    # -------------------------------------------------------------------- reading

    def pull(self, *, calendar_id: str | None = None) -> PullReport:
        """Ingest changes for one calendar, incrementally when possible."""
        target = calendar_id or self._write_calendar_id
        now = self._clock.now()
        token = self._sync_state.token_for(target)
        full_resync = False

        try:
            page = self._client.list_events(calendar_id=target, sync_token=token)
        except CalendarSyncTokenExpired:
            # Documented recovery: discard the token and read the window afresh.
            full_resync = True
            page = self._client.list_events(
                calendar_id=target,
                sync_token=None,
                time_min=now - dt.timedelta(days=1),
                time_max=now + dt.timedelta(days=FULL_READ_WINDOW_DAYS),
            )

        ingested = user_moved = orphaned = removed = 0

        for event in page.events:
            if event.cancelled:
                self._cache.remove(event.google_event_id)
                removed += 1
                if self._mark_orphaned(event):
                    orphaned += 1
                continue

            self._cache.upsert(
                google_event_id=event.google_event_id,
                calendar_id=event.calendar_id,
                title=event.title,
                start_utc=event.start_utc,
                end_utc=event.end_utc,
                is_app_owned=event.is_app_owned,
                has_other_attendees=event.has_other_attendees,
                updated_at=event.updated_at,
            )
            ingested += 1

            if self._mark_user_moved(event):
                user_moved += 1

        self._sync_state.save_token(target, page.next_sync_token, at=now)
        return PullReport(
            ingested=ingested,
            user_moved=user_moved,
            orphaned=orphaned,
            removed=removed,
            full_resync=full_resync,
        )

    def _mark_user_moved(self, event: ScrubbedEvent) -> bool:
        """If the user dragged one of our blocks, adopt their time and stop re-placing it."""
        if not event.is_app_owned or event.cadence_block_id is None:
            return False
        block = self._blocks.get(event.cadence_block_id)
        if block is None or block.state not in ("planned", "pushed"):
            return False
        if block.interval.start_utc == event.start_utc and block.interval.end_utc == event.end_utc:
            return False
        self._blocks.update(
            dataclasses.replace(
                block,
                interval=Interval(start_utc=event.start_utc, end_utc=event.end_utc),
                state="user_moved",
                google_event_id=event.google_event_id,
            )
        )
        return True

    def _mark_orphaned(self, event: ScrubbedEvent) -> bool:
        """A deleted app block returns its task to the backlog."""
        block = None
        if event.cadence_block_id:
            block = self._blocks.get(event.cadence_block_id)
        if block is None:
            block = self._blocks.find_by_google_event(event.google_event_id)
        if block is None or block.state == "orphaned":
            return False
        self._blocks.update(dataclasses.replace(block, state="orphaned"))
        return True


def _event_id_for(block_id: str) -> str:
    """Derive a Google-legal event id from a block id.

    Google requires base32hex characters, so the UUID's hyphens are removed. Deriving rather
    than storing keeps insert idempotent: the same block always maps to the same event.
    """
    return f"cadence{block_id.replace('-', '').lower()}"
