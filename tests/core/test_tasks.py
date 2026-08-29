import datetime as dt

import pytest

from cadence.core.errors import DomainValidationError
from cadence.core.tasks import Task, TaskDraft, TaskStatus

UTC = dt.UTC


def test_title_is_trimmed() -> None:
    assert TaskDraft(title="  write the report  ").title == "write the report"


@pytest.mark.parametrize("title", ["", "   ", "\n\t"])
def test_blank_title_is_rejected(title: str) -> None:
    with pytest.raises(DomainValidationError, match="title"):
        TaskDraft(title=title)


def test_title_longer_than_the_column_is_rejected() -> None:
    with pytest.raises(DomainValidationError, match="title"):
        TaskDraft(title="x" * 501)


@pytest.mark.parametrize("importance", [0, 6, -1])
def test_importance_outside_one_to_five_is_rejected(importance: int) -> None:
    with pytest.raises(DomainValidationError, match="importance"):
        TaskDraft(title="task", importance=importance)


@pytest.mark.parametrize("importance", [1, 2, 3, 4, 5])
def test_every_importance_level_is_accepted(importance: int) -> None:
    assert TaskDraft(title="task", importance=importance).importance == importance


@pytest.mark.parametrize("effort", [0, -30])
def test_non_positive_effort_is_rejected(effort: int) -> None:
    with pytest.raises(DomainValidationError, match="effort"):
        TaskDraft(title="task", effort_minutes=effort)


def test_absent_effort_is_allowed() -> None:
    assert TaskDraft(title="task").effort_minutes is None


def test_naive_earliest_start_is_rejected() -> None:
    with pytest.raises(DomainValidationError, match="timezone"):
        TaskDraft(title="task", earliest_start=dt.datetime(2026, 8, 29, 9, 0))


def test_aware_earliest_start_is_accepted() -> None:
    moment = dt.datetime(2026, 8, 29, 9, 0, tzinfo=UTC)

    assert TaskDraft(title="task", earliest_start=moment).earliest_start == moment


def test_tags_are_normalised_and_deduplicated_preserving_order() -> None:
    draft = TaskDraft(title="task", tags=("Work", " work ", "", "health", "Work"))

    assert draft.tags == ("work", "health")


def test_draft_is_immutable() -> None:
    draft = TaskDraft(title="task")

    with pytest.raises(AttributeError):
        draft.title = "changed"  # type: ignore[misc]


def _task(**overrides: object) -> Task:
    defaults: dict[str, object] = {
        "id": "task-1",
        "draft": TaskDraft(title="task"),
        "status": "active",
        "slip_count": 0,
        "pinned_for_date": None,
        "created_at": dt.datetime(2026, 8, 29, 8, 0, tzinfo=UTC),
        "completed_at": None,
    }
    return Task(**(defaults | overrides))  # type: ignore[arg-type]


def test_active_task_is_actionable() -> None:
    assert _task().is_actionable is True


@pytest.mark.parametrize("status", ["done", "dropped"])
def test_closed_task_is_not_actionable(status: TaskStatus) -> None:
    assert _task(status=status).is_actionable is False


def test_completing_a_task_records_the_time_and_leaves_the_original_untouched() -> None:
    original = _task()
    finished_at = dt.datetime(2026, 8, 29, 12, 0, tzinfo=UTC)

    completed = original.completed(at=finished_at)

    assert completed.status == "done"
    assert completed.completed_at == finished_at
    assert original.status == "active"
    assert original.completed_at is None


def test_completing_an_already_completed_task_is_rejected() -> None:
    completed = _task().completed(at=dt.datetime(2026, 8, 29, 12, 0, tzinfo=UTC))

    with pytest.raises(DomainValidationError, match="already"):
        completed.completed(at=dt.datetime(2026, 8, 29, 13, 0, tzinfo=UTC))


def test_dropping_a_task_closes_it_without_a_completion_time() -> None:
    dropped = _task().dropped()

    assert dropped.status == "dropped"
    assert dropped.completed_at is None


def test_pinning_sets_the_date_and_unpinning_clears_it() -> None:
    day = dt.date(2026, 8, 29)

    pinned = _task().pinned(for_date=day)
    assert pinned.pinned_for_date == day

    assert pinned.pinned(for_date=None).pinned_for_date is None


def test_slipping_increments_the_count() -> None:
    assert _task(slip_count=2).slipped().slip_count == 3
