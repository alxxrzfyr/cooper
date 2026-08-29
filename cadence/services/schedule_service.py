"""Scheduling orchestration.

Turns the ranked shortlist into stored blocks and queued calendar writes. The rules live in
`core.placement`; this layer only sequences persistence.

Two boundaries it is responsible for holding:
  - **Nothing outside a declared window.** It passes only expanded window instances to
    placement, so the invariant is structural rather than checked afterwards.
  - **No calendar write inside a database transaction.** Blocks and their outbox entries commit
    together; the actual Google call happens later, in the drain.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from cadence.adapters.mutation_repository import Actor, MutationRecord, MutationRepository
from cadence.adapters.schedule_repositories import (
    BlockRepository,
    CalendarCacheRepository,
    OutboxEntry,
    OutboxRepository,
    ScheduledBlock,
    WindowRepository,
)
from cadence.core.candidates import RankedTask
from cadence.core.placement import DEFAULT_RULES, Placeable, PlacementResult, PlacementRules, place
from cadence.core.protocols import Clock, IdFactory
from cadence.core.windows import Interval, expand_windows

DEFAULT_HORIZON_DAYS = 14


@dataclasses.dataclass(frozen=True, slots=True)
class ScheduleOutcome:
    """What a scheduling run decided."""

    batch_id: str
    placed: tuple[ScheduledBlock, ...]
    released: tuple[ScheduledBlock, ...]
    result: PlacementResult

    @property
    def scheduled_minutes(self) -> int:
        return sum(block.interval.duration_minutes for block in self.placed)


class ScheduleService:
    def __init__(
        self,
        *,
        windows: WindowRepository,
        blocks: BlockRepository,
        outbox: OutboxRepository,
        cache: CalendarCacheRepository,
        mutations: MutationRepository,
        clock: Clock,
        new_id: IdFactory,
        write_calendar_id: str,
        rules: PlacementRules = DEFAULT_RULES,
        horizon_days: int = DEFAULT_HORIZON_DAYS,
        actor: Actor = "ai",
    ) -> None:
        self._windows = windows
        self._blocks = blocks
        self._outbox = outbox
        self._cache = cache
        self._mutations = mutations
        self._clock = clock
        self._new_id = new_id
        self._write_calendar_id = write_calendar_id
        self._rules = rules
        self._horizon_days = horizon_days
        self._actor = actor

    # ------------------------------------------------------------------ planning

    def plan_blocks(
        self,
        shortlist: tuple[RankedTask, ...],
        *,
        horizon_days: int | None = None,
    ) -> PlacementResult:
        """Compute a placement without persisting anything. Pure preview."""
        now = self._clock.now()
        horizon = horizon_days or self._horizon_days
        instances = expand_windows(
            self._windows.list(active_only=True),
            start=now.date(),
            days=horizon,
        )
        return place(
            [
                Placeable(
                    task_id=entry.task.id,
                    title=entry.task.title,
                    effort_minutes=entry.task.draft.effort_minutes,
                    allow_split=entry.task.draft.allow_split,
                )
                for entry in shortlist
            ],
            instances,
            now=now,
            busy=self._busy(now, horizon),
            rules=self._rules,
        )

    def _busy(self, now: dt.datetime, horizon_days: int) -> tuple[Interval, ...]:
        """Time already taken: other people's events plus blocks we already committed to."""
        end = now + dt.timedelta(days=horizon_days)
        external = self._cache.busy_intervals(start=now, end=end)
        existing = tuple(
            block.interval
            for block in self._blocks.list(states=("planned", "pushed", "user_moved"))
            if block.interval.end_utc > now
        )
        return external + existing

    # ------------------------------------------------------------------ applying

    def apply(
        self,
        shortlist: tuple[RankedTask, ...],
        *,
        horizon_days: int | None = None,
    ) -> ScheduleOutcome:
        """Place the shortlist and persist the result as one undoable batch."""
        batch_id = self._new_id()
        now = self._clock.now()

        released = self._release_future_planned(batch_id=batch_id, now=now)
        result = self.plan_blocks(shortlist, horizon_days=horizon_days)

        placed: list[ScheduledBlock] = []
        for proposal in result.blocks:
            block = ScheduledBlock(
                id=self._new_id(),
                task_id=proposal.task_id,
                interval=proposal.interval,
                state="planned",
            )
            self._blocks.add(block)
            mutation_id = self._record(
                batch_id=batch_id,
                op="schedule",
                block=block,
                before=None,
                after=_snapshot(block),
                now=now,
            )
            self._enqueue_write(
                block=block,
                mutation_id=mutation_id,
                operation="insert",
                now=now,
            )
            placed.append(block)

        return ScheduleOutcome(
            batch_id=batch_id,
            placed=tuple(placed),
            released=released,
            result=result,
        )

    def _release_future_planned(
        self,
        *,
        batch_id: str,
        now: dt.datetime,
    ) -> tuple[ScheduledBlock, ...]:
        """Clear future blocks the app owns so re-planning starts from a clean slate.

        Blocks the user moved by hand are left alone: a manual edit is a signal, not noise.
        Blocks already under way are also left alone, because rewriting the present is
        disorienting rather than helpful.
        """
        released: list[ScheduledBlock] = []
        for block in self._blocks.list(states=("planned", "pushed")):
            if block.interval.start_utc <= now:
                continue
            updated = dataclasses.replace(block, state="orphaned")
            self._blocks.update(updated)
            mutation_id = self._record(
                batch_id=batch_id,
                op="release",
                block=block,
                before=_snapshot(block),
                after=_snapshot(updated),
                now=now,
            )
            if block.google_event_id:
                self._enqueue_write(
                    block=block,
                    mutation_id=mutation_id,
                    operation="delete",
                    now=now,
                )
            released.append(block)
        return tuple(released)

    # ------------------------------------------------------------------ plumbing

    def _record(
        self,
        *,
        batch_id: str,
        op: str,
        block: ScheduledBlock,
        before: dict[str, object] | None,
        after: dict[str, object] | None,
        now: dt.datetime,
    ) -> str:
        mutation_id = self._new_id()
        self._mutations.record(
            MutationRecord(
                id=mutation_id,
                batch_id=batch_id,
                ts=now,
                actor=self._actor,
                intent_kind="Schedule",
                entity_type="block",
                entity_id=block.id,
                op=op,
                before=before,
                after=after,
            )
        )
        return mutation_id

    def _enqueue_write(
        self,
        *,
        block: ScheduledBlock,
        mutation_id: str,
        operation: str,
        now: dt.datetime,
    ) -> None:
        """Queue a calendar write against the mutation that caused it.

        The reference must be a real mutation_log row: the column carries a foreign key, and
        storing a batch id here left a dangling reference.
        """
        self._outbox.enqueue(
            OutboxEntry(
                id=self._new_id(),
                mutation_id=mutation_id,
                operation=operation,
                payload={
                    "block_id": block.id,
                    "task_id": block.task_id,
                    "calendar_id": self._write_calendar_id,
                    "google_event_id": block.google_event_id,
                    "start_utc": block.interval.start_utc.isoformat(),
                    "end_utc": block.interval.end_utc.isoformat(),
                },
                next_attempt_at=now,
            )
        )


def _snapshot(block: ScheduledBlock) -> dict[str, object]:
    return {
        "id": block.id,
        "task_id": block.task_id,
        "start_utc": block.interval.start_utc.isoformat(),
        "end_utc": block.interval.end_utc.isoformat(),
        "state": block.state,
        "google_event_id": block.google_event_id,
    }
