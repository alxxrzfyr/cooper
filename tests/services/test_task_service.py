import datetime as dt

import pytest

from cadence.core.errors import DomainValidationError, TaskNotFoundError
from cadence.core.tasks import TaskDraft
from cadence.services.task_service import TaskService
from tests.fakes import FakeClock, InMemoryTaskRepository, SequentialIds

UTC = dt.UTC
NOW = dt.datetime(2026, 8, 29, 9, 0, tzinfo=UTC)


def build_service() -> tuple[TaskService, InMemoryTaskRepository, FakeClock]:
    repository = InMemoryTaskRepository()
    clock = FakeClock(NOW)
    service = TaskService(repository=repository, clock=clock, new_id=SequentialIds("task"))
    return service, repository, clock


def test_create_stores_an_active_task_with_the_clock_time() -> None:
    service, repository, _ = build_service()

    task = service.create(TaskDraft(title="write the report", effort_minutes=180))

    assert task.id == "task-1"
    assert task.status == "active"
    assert task.created_at == NOW
    assert repository.get("task-1") == task


def test_create_rejects_an_invalid_draft_without_storing_anything() -> None:
    service, repository, _ = build_service()

    with pytest.raises(DomainValidationError):
        service.create(TaskDraft(title="valid").replace(importance=9))

    assert repository.list() == ()


def test_update_revalidates_and_persists_changes() -> None:
    service, repository, _ = build_service()
    service.create(TaskDraft(title="report"))

    updated = service.update("task-1", importance=5, effort_minutes=90)

    assert updated.draft.importance == 5
    assert updated.draft.effort_minutes == 90
    assert repository.get("task-1") == updated


def test_update_rejects_a_change_that_breaks_a_domain_rule() -> None:
    service, repository, _ = build_service()
    service.create(TaskDraft(title="report", importance=3))

    with pytest.raises(DomainValidationError, match="importance"):
        service.update("task-1", importance=0)

    assert repository.get("task-1").draft.importance == 3  # type: ignore[union-attr]


def test_update_rejects_an_unknown_field() -> None:
    service, _, _ = build_service()
    service.create(TaskDraft(title="report"))

    with pytest.raises(DomainValidationError, match="unknown"):
        service.update("task-1", nonexistent=1)


def test_complete_records_the_time_from_the_clock() -> None:
    service, _, clock = build_service()
    service.create(TaskDraft(title="report"))
    clock.advance(dt.timedelta(hours=3))

    completed = service.complete("task-1")

    assert completed.status == "done"
    assert completed.completed_at == NOW + dt.timedelta(hours=3)


def test_drop_closes_the_task_without_a_completion_time() -> None:
    service, _, _ = build_service()
    service.create(TaskDraft(title="report"))

    dropped = service.drop("task-1")

    assert dropped.status == "dropped"
    assert dropped.completed_at is None


def test_pin_and_unpin_round_trip() -> None:
    service, _, _ = build_service()
    service.create(TaskDraft(title="report"))
    day = dt.date(2026, 8, 29)

    assert service.pin("task-1", for_date=day).pinned_for_date == day
    assert service.pin("task-1", for_date=None).pinned_for_date is None


@pytest.mark.parametrize(
    "operation",
    ["complete", "drop", "get_or_raise"],
)
def test_operations_on_a_missing_task_raise_not_found(operation: str) -> None:
    service, _, _ = build_service()

    with pytest.raises(TaskNotFoundError):
        getattr(service, operation)("task-does-not-exist")


def test_list_filters_by_status_and_orders_by_creation() -> None:
    service, _, clock = build_service()
    service.create(TaskDraft(title="first"))
    clock.advance(dt.timedelta(minutes=1))
    service.create(TaskDraft(title="second"))
    service.complete("task-1")

    active = service.list(statuses=("active",))

    assert [task.title for task in active] == ["second"]
    assert [task.title for task in service.list()] == ["first", "second"]
