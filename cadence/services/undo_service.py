"""Batch undo.

Given full autonomy, this is where the user's oversight actually lives. A re-plan touches many
blocks, so the unit of reversal is the batch, not the individual change.

Inverses are applied newest-first, which matters when one batch touched the same entity twice:
replaying in reverse order restores the state that preceded the batch rather than an
intermediate one.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from cadence.adapters.mutation_repository import MutationBatch, MutationRecord, MutationRepository
from cadence.adapters.schedule_repositories import (
    BlockRepository,
    OutboxEntry,
    OutboxRepository,
    ScheduledBlock,
)
from cadence.core.errors import TaskNotFoundError
from cadence.core.protocols import Clock, IdFactory
from cadence.core.windows import Interval
from cadence.services.snapshots import snapshot_to_task
from cadence.services.task_service import TaskService


@dataclasses.dataclass(frozen=True, slots=True)
class UndoOutcome:
    batch_id: str
    reversed_count: int
    already_undone: bool = False
    calendar_corrections: int = 0


class UndoService:
    def __init__(
        self,
        *,
        mutations: MutationRepository,
        tasks: TaskService,
        blocks: BlockRepository,
        outbox: OutboxRepository,
        clock: Clock,
        new_id: IdFactory,
        write_calendar_id: str,
    ) -> None:
        self._mutations = mutations
        self._tasks = tasks
        self._blocks = blocks
        self._outbox = outbox
        self._clock = clock
        self._new_id = new_id
        self._write_calendar_id = write_calendar_id

    def undo_batch(self, batch_id: str) -> UndoOutcome:
        batch = self._mutations.batch(batch_id)
        if batch is None:
            raise TaskNotFoundError(f"no batch with id {batch_id!r}")
        if batch.is_undone:
            # Undoing twice is a no-op rather than an error, so a double click is harmless.
            return UndoOutcome(batch_id=batch_id, reversed_count=0, already_undone=True)

        now = self._clock.now()
        reversed_count = 0
        corrections = 0

        for mutation in self._newest_first(batch):
            if mutation.is_undone:
                continue
            corrections += self._reverse(mutation, now=now)
            self._mutations.mark_undone(mutation.id, at=now)
            reversed_count += 1

        return UndoOutcome(
            batch_id=batch_id,
            reversed_count=reversed_count,
            calendar_corrections=corrections,
        )

    @staticmethod
    def _newest_first(batch: MutationBatch) -> tuple[MutationRecord, ...]:
        return tuple(sorted(batch.mutations, key=lambda m: (m.ts, m.id), reverse=True))

    def _reverse(self, mutation: MutationRecord, *, now: dt.datetime) -> int:
        if mutation.entity_type == "task":
            self._reverse_task(mutation)
            return 0
        if mutation.entity_type == "block":
            return self._reverse_block(mutation, now=now)
        return 0

    def _reverse_task(self, mutation: MutationRecord) -> None:
        if mutation.before is None:
            # The mutation created the task, so its inverse is to drop it.
            existing = self._tasks.get_or_raise(mutation.entity_id)
            self._tasks.drop(existing.id)
            return
        self._tasks.replace(snapshot_to_task(mutation.before))

    def _reverse_block(self, mutation: MutationRecord, *, now: dt.datetime) -> int:
        if mutation.before is None:
            # The mutation created the block, so remove it and retract the calendar event.
            block = self._blocks.get(mutation.entity_id)
            if block is None:
                return 0
            self._blocks.update(dataclasses.replace(block, state="orphaned"))
            if block.google_event_id:
                self._enqueue_delete(block, mutation_id=mutation.id, now=now)
                return 1
            return 0

        restored = _block_from_snapshot(mutation.before)
        current = self._blocks.get(restored.id)
        if current is None:
            self._blocks.add(restored)
        else:
            self._blocks.update(restored)
        if restored.google_event_id:
            self._enqueue_insert(restored, mutation_id=mutation.id, now=now)
            return 1
        return 0

    def _enqueue_delete(self, block: ScheduledBlock, *, mutation_id: str, now: dt.datetime) -> None:
        self._enqueue(block, mutation_id=mutation_id, operation="delete", now=now)

    def _enqueue_insert(self, block: ScheduledBlock, *, mutation_id: str, now: dt.datetime) -> None:
        self._enqueue(block, mutation_id=mutation_id, operation="insert", now=now)

    def _enqueue(
        self,
        block: ScheduledBlock,
        *,
        mutation_id: str,
        operation: str,
        now: dt.datetime,
    ) -> None:
        """The reference is the mutation being reversed, which is a real mutation_log row."""
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


def _block_from_snapshot(snapshot: dict[str, object]) -> ScheduledBlock:
    return ScheduledBlock(
        id=str(snapshot["id"]),
        task_id=str(snapshot["task_id"]),
        interval=Interval(
            start_utc=dt.datetime.fromisoformat(str(snapshot["start_utc"])),
            end_utc=dt.datetime.fromisoformat(str(snapshot["end_utc"])),
        ),
        state=str(snapshot.get("state", "planned")),
        google_event_id=(
            str(snapshot["google_event_id"]) if snapshot.get("google_event_id") else None
        ),
    )
