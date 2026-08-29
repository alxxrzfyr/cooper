"""Executes one validated intent.

The only component that turns an intent into a state change. Every mutation it applies is
recorded with the state it replaced, so the parsed chip can offer a one-click undo instead
of the confirmation dialog the design deliberately rejects.

A clarification or a query changes nothing and records nothing.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from cadence.adapters.mutation_repository import Actor, MutationRecord, MutationRepository
from cadence.core.disambiguation import resolve_reference
from cadence.core.errors import CadenceError, DomainValidationError, TaskNotFoundError
from cadence.core.intents import (
    Clarify,
    CompleteTask,
    CreateEvent,
    CreateTask,
    DropTask,
    Intent,
    PinTask,
    Query,
    Undo,
    UpdateTask,
    intent_kind,
)
from cadence.core.protocols import Clock, IdFactory
from cadence.core.tasks import Task
from cadence.services.snapshots import snapshot_to_task, task_to_snapshot
from cadence.services.task_service import TaskService


@dataclasses.dataclass(frozen=True, slots=True)
class ChipField:
    label: str
    value: str


@dataclasses.dataclass(frozen=True, slots=True)
class ParsedChip:
    """The compact echo shown after capture. The correction path, not a confirmation."""

    kind: str
    summary: str
    fields: tuple[ChipField, ...]


@dataclasses.dataclass(frozen=True, slots=True)
class CaptureOutcome:
    intent_kind: str
    chip: ParsedChip | None = None
    task: Task | None = None
    clarification: Clarify | None = None
    query: Query | None = None
    mutation_id: str | None = None
    undone_mutation_id: str | None = None
    event: CreateEvent | None = None

    @property
    def needs_clarification(self) -> bool:
        return self.clarification is not None


def _task_chip(kind: str, task: Task) -> ParsedChip:
    draft = task.draft
    fields = [ChipField(label="task", value=draft.title)]
    if draft.effort_minutes is not None:
        fields.append(ChipField(label="effort", value=f"{draft.effort_minutes}m"))
    if draft.deadline is not None:
        fields.append(ChipField(label="due", value=draft.deadline.isoformat()))
    fields.append(ChipField(label="importance", value=str(draft.importance)))
    if task.pinned_for_date is not None:
        fields.append(ChipField(label="pinned", value=task.pinned_for_date.isoformat()))
    summary = " · ".join(field.value for field in fields)
    return ParsedChip(kind=kind, summary=summary, fields=tuple(fields))


class IntentExecutor:
    def __init__(
        self,
        *,
        tasks: TaskService,
        mutations: MutationRepository,
        clock: Clock,
        new_id: IdFactory,
        actor: Actor = "user",
    ) -> None:
        self._tasks = tasks
        self._mutations = mutations
        self._clock = clock
        self._new_id = new_id
        self._actor = actor

    def _candidates(self) -> dict[str, str]:
        return {task.id: task.title for task in self._tasks.list(statuses=("active",))}

    def _resolve(self, reference: str) -> Task:
        return self._tasks.get_or_raise(resolve_reference(reference, self._candidates()))

    def _record(
        self,
        *,
        intent: Intent,
        op: str,
        entity_id: str,
        before: dict[str, object] | None,
        after: dict[str, object] | None,
    ) -> str:
        mutation_id = self._new_id()
        self._mutations.record(
            MutationRecord(
                id=mutation_id,
                batch_id=mutation_id,
                ts=self._clock.now(),
                actor=self._actor,
                intent_kind=intent_kind(intent),
                entity_type="task",
                entity_id=entity_id,
                op=op,
                before=before,
                after=after,
            )
        )
        return mutation_id

    def execute(self, intent: Intent) -> CaptureOutcome:
        kind = intent_kind(intent)

        if isinstance(intent, Clarify):
            return CaptureOutcome(intent_kind=kind, clarification=intent)
        if isinstance(intent, Query):
            return CaptureOutcome(intent_kind=kind, query=intent)
        if isinstance(intent, Undo):
            return self._undo(intent)
        if isinstance(intent, CreateEvent):
            # Phase 1 parses and echoes a fixed commitment. Projecting it into Google
            # Calendar is Phase 3 work and is deliberately not done here.
            chip = ParsedChip(
                kind=kind,
                summary=f"{intent.title} · {intent.start.isoformat(timespec='minutes')}",
                fields=(
                    ChipField(label="event", value=intent.title),
                    ChipField(label="start", value=intent.start.isoformat(timespec="minutes")),
                    ChipField(label="end", value=intent.end.isoformat(timespec="minutes")),
                ),
            )
            return CaptureOutcome(intent_kind=kind, chip=chip, event=intent)

        if isinstance(intent, CreateTask):
            task = self._tasks.create(intent.draft)
            mutation_id = self._record(
                intent=intent,
                op="insert",
                entity_id=task.id,
                before=None,
                after=task_to_snapshot(task),
            )
            return CaptureOutcome(
                intent_kind=kind,
                chip=_task_chip(kind, task),
                task=task,
                mutation_id=mutation_id,
            )

        return self._mutate_existing(intent)

    def _mutate_existing(self, intent: Intent) -> CaptureOutcome:
        kind = intent_kind(intent)
        reference = getattr(intent, "task_ref", None)
        if not isinstance(reference, str):
            raise DomainValidationError(f"{kind} carries no task reference")

        task = self._resolve(reference)
        before = task_to_snapshot(task)

        if isinstance(intent, UpdateTask):
            updated = self._tasks.update(task.id, **dict(intent.changes))
            op = "update"
        elif isinstance(intent, CompleteTask):
            updated = self._tasks.complete(task.id)
            op = "complete"
        elif isinstance(intent, DropTask):
            updated = self._tasks.drop(task.id)
            op = "drop"
        elif isinstance(intent, PinTask):
            updated = self._tasks.pin(task.id, for_date=intent.date)
            op = "pin"
        else:  # pragma: no cover - the intent union is exhausted above
            raise DomainValidationError(f"{kind} cannot be executed")

        mutation_id = self._record(
            intent=intent,
            op=op,
            entity_id=task.id,
            before=before,
            after=task_to_snapshot(updated),
        )
        return CaptureOutcome(
            intent_kind=kind,
            chip=_task_chip(kind, updated),
            task=updated,
            mutation_id=mutation_id,
        )

    def _undo(self, intent: Undo) -> CaptureOutcome:
        record = (
            self._mutations.get(intent.mutation_id)
            if intent.mutation_id
            else self._mutations.latest()
        )
        if record is None:
            raise TaskNotFoundError("there is nothing to undo")
        return self.undo(record.id)

    def undo(self, mutation_id: str) -> CaptureOutcome:
        """Restore the state a mutation replaced. Undoing twice is a no-op, not an error."""
        record = self._mutations.get(mutation_id)
        if record is None:
            raise TaskNotFoundError(f"no mutation with id {mutation_id!r}")
        if record.is_undone:
            return CaptureOutcome(intent_kind="Undo", undone_mutation_id=mutation_id)

        if record.before is None:
            # The mutation created the entity, so its inverse is to drop it.
            existing = self._tasks.get_or_raise(record.entity_id)
            restored = self._tasks.drop(existing.id)
        else:
            restored = self._restore(snapshot_to_task(record.before))

        self._mutations.mark_undone(mutation_id, at=self._clock.now())
        return CaptureOutcome(
            intent_kind="Undo",
            task=restored,
            undone_mutation_id=mutation_id,
            chip=_task_chip("Undo", restored),
        )

    def _restore(self, task: Task) -> Task:
        try:
            self._tasks.get_or_raise(task.id)
        except CadenceError:
            raise
        return self._tasks.replace(task)


def utc_now() -> dt.datetime:
    return dt.datetime.now(tz=dt.UTC)
