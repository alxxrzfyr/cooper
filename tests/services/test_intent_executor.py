import datetime as dt

import pytest

from cadence.adapters.mutation_repository import MutationRecord, MutationRepository
from cadence.core.errors import AmbiguousReferenceError, TaskNotFoundError
from cadence.core.intents import (
    Clarify,
    CompleteTask,
    CreateEvent,
    CreateTask,
    DropTask,
    PinTask,
    Query,
    Undo,
    UpdateTask,
)
from cadence.core.tasks import TaskDraft
from cadence.services.intent_executor import IntentExecutor
from cadence.services.task_service import TaskService
from tests.fakes import FakeClock, InMemoryTaskRepository, SequentialIds

UTC = dt.UTC
NOW = dt.datetime(2026, 8, 29, 9, 0, tzinfo=UTC)
TODAY = NOW.date()


class InMemoryMutationRepository(MutationRepository):
    def __init__(self) -> None:
        self.records: list[MutationRecord] = []

    def record(self, mutation: MutationRecord) -> None:
        self.records.append(mutation)

    def get(self, mutation_id: str) -> MutationRecord | None:
        for record in self.records:
            if record.id == mutation_id:
                return record
        return None

    def latest(self) -> MutationRecord | None:
        for record in reversed(self.records):
            if not record.is_undone:
                return record
        return None

    def mark_undone(self, mutation_id: str, *, at: dt.datetime) -> None:
        for index, record in enumerate(self.records):
            if record.id == mutation_id:
                self.records[index] = dataclasses_replace(record, at)
                return
        raise KeyError(mutation_id)


def dataclasses_replace(record: MutationRecord, at: dt.datetime) -> MutationRecord:
    import dataclasses

    return dataclasses.replace(record, inverse_applied_at=at)


def build() -> tuple[IntentExecutor, TaskService, InMemoryMutationRepository]:
    repository = InMemoryTaskRepository()
    clock = FakeClock(NOW)
    tasks = TaskService(repository=repository, clock=clock, new_id=SequentialIds("task"))
    mutations = InMemoryMutationRepository()
    executor = IntentExecutor(
        tasks=tasks,
        mutations=mutations,
        clock=clock,
        new_id=SequentialIds("mut"),
    )
    return executor, tasks, mutations


def test_create_task_stores_the_task_and_returns_a_chip() -> None:
    executor, tasks, mutations = build()

    outcome = executor.execute(
        CreateTask(draft=TaskDraft(title="write the report", effort_minutes=180, importance=4))
    )

    assert outcome.task is not None
    assert outcome.task.title == "write the report"
    assert outcome.chip is not None
    assert "write the report" in outcome.chip.summary
    assert "180m" in outcome.chip.summary
    assert len(mutations.records) == 1
    assert mutations.records[0].before is None
    assert mutations.records[0].op == "insert"


def test_a_clarification_changes_nothing() -> None:
    executor, tasks, mutations = build()

    outcome = executor.execute(Clarify(question="which one?"))

    assert outcome.needs_clarification is True
    assert outcome.chip is None
    assert tasks.list() == ()
    assert mutations.records == []


def test_a_query_changes_nothing() -> None:
    executor, tasks, mutations = build()

    outcome = executor.execute(Query(kind="today"))

    assert outcome.query is not None
    assert mutations.records == []
    assert tasks.list() == ()


def test_complete_resolves_a_title_reference() -> None:
    executor, tasks, _ = build()
    executor.execute(CreateTask(draft=TaskDraft(title="write the quarterly report")))

    outcome = executor.execute(CompleteTask(task_ref="quarterly"))

    assert outcome.task is not None
    assert outcome.task.status == "done"


def test_an_ambiguous_reference_raises_rather_than_guessing() -> None:
    executor, _, mutations = build()
    executor.execute(CreateTask(draft=TaskDraft(title="design review weekly")))
    executor.execute(CreateTask(draft=TaskDraft(title="design review prep")))
    before = len(mutations.records)

    with pytest.raises(AmbiguousReferenceError) as raised:
        executor.execute(CompleteTask(task_ref="design review"))

    assert len(raised.value.candidates) == 2
    assert len(mutations.records) == before


def test_an_unknown_reference_is_not_found() -> None:
    executor, _, _ = build()
    executor.execute(CreateTask(draft=TaskDraft(title="write the report")))

    with pytest.raises(TaskNotFoundError):
        executor.execute(CompleteTask(task_ref="something else entirely"))


def test_update_applies_only_the_named_changes() -> None:
    executor, _, _ = build()
    executor.execute(CreateTask(draft=TaskDraft(title="report", effort_minutes=60, importance=2)))

    outcome = executor.execute(UpdateTask(task_ref="report", changes=(("importance", 5),)))

    assert outcome.task is not None
    assert outcome.task.draft.importance == 5
    assert outcome.task.draft.effort_minutes == 60


def test_drop_closes_the_task() -> None:
    executor, _, _ = build()
    executor.execute(CreateTask(draft=TaskDraft(title="report")))

    outcome = executor.execute(DropTask(task_ref="report"))

    assert outcome.task is not None
    assert outcome.task.status == "dropped"


def test_pin_records_the_date_in_the_chip() -> None:
    executor, _, _ = build()
    executor.execute(CreateTask(draft=TaskDraft(title="report")))

    outcome = executor.execute(PinTask(task_ref="report", date=TODAY))

    assert outcome.task is not None
    assert outcome.task.pinned_for_date == TODAY
    assert outcome.chip is not None
    assert TODAY.isoformat() in outcome.chip.summary


def test_create_event_is_echoed_but_not_projected_to_a_calendar() -> None:
    # Phase 1 scope: parse and confirm. Calendar projection is Phase 3.
    executor, tasks, mutations = build()
    start = dt.datetime(2026, 9, 3, 15, 0, tzinfo=UTC)

    outcome = executor.execute(
        CreateEvent(title="dentist", start=start, end=start + dt.timedelta(hours=1))
    )

    assert outcome.event is not None
    assert outcome.chip is not None
    assert "dentist" in outcome.chip.summary
    assert tasks.list() == ()
    assert mutations.records == []


def test_undo_restores_the_state_a_change_replaced() -> None:
    executor, tasks, _ = build()
    executor.execute(CreateTask(draft=TaskDraft(title="report", importance=2)))
    changed = executor.execute(UpdateTask(task_ref="report", changes=(("importance", 5),)))
    assert changed.mutation_id is not None

    executor.undo(changed.mutation_id)

    restored = tasks.get_or_raise("task-1")
    assert restored.draft.importance == 2


def test_undo_of_a_creation_drops_the_task() -> None:
    executor, tasks, _ = build()
    created = executor.execute(CreateTask(draft=TaskDraft(title="mistyped task")))
    assert created.mutation_id is not None

    executor.undo(created.mutation_id)

    assert tasks.get_or_raise("task-1").status == "dropped"


def test_undo_twice_is_a_no_op_rather_than_an_error() -> None:
    executor, tasks, _ = build()
    executor.execute(CreateTask(draft=TaskDraft(title="report", importance=3)))
    changed = executor.execute(UpdateTask(task_ref="report", changes=(("importance", 5),)))
    assert changed.mutation_id is not None

    executor.undo(changed.mutation_id)
    second = executor.undo(changed.mutation_id)

    assert second.undone_mutation_id == changed.mutation_id
    assert tasks.get_or_raise("task-1").draft.importance == 3


def test_undo_intent_without_an_id_reverses_the_most_recent_change() -> None:
    executor, tasks, _ = build()
    executor.execute(CreateTask(draft=TaskDraft(title="report", importance=2)))
    executor.execute(UpdateTask(task_ref="report", changes=(("importance", 5),)))

    executor.execute(Undo())

    assert tasks.get_or_raise("task-1").draft.importance == 2


def test_undo_with_nothing_to_undo_is_not_found() -> None:
    executor, _, _ = build()

    with pytest.raises(TaskNotFoundError):
        executor.execute(Undo())


def test_every_mutation_records_actor_and_intent_kind() -> None:
    executor, _, mutations = build()

    executor.execute(CreateTask(draft=TaskDraft(title="report")))

    record = mutations.records[0]
    assert record.actor == "user"
    assert record.intent_kind == "CreateTask"
    assert record.entity_type == "task"
    assert record.ts == NOW
