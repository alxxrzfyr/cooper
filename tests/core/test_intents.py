import datetime as dt

import pytest

from cadence.core.errors import DomainValidationError
from cadence.core.intents import (
    Clarify,
    CompleteTask,
    CreateEvent,
    CreateTask,
    IntentContext,
    Query,
    UpdateTask,
    intent_kind,
    is_mutating,
)
from cadence.core.tasks import TaskDraft

UTC = dt.UTC


def test_context_carries_at_most_five_recent_references() -> None:
    with pytest.raises(DomainValidationError, match="five"):
        IntentContext(
            today=dt.date(2026, 8, 29),
            timezone="Asia/Singapore",
            recent_task_ids=("1", "2", "3", "4", "5", "6"),
        )


def test_context_has_no_field_able_to_carry_calendar_text() -> None:
    # Invariant 4: third-party content must never reach the compiler's prompt.
    fields = set(IntentContext.__dataclass_fields__)

    assert fields == {"today", "timezone", "recent_task_ids", "recent_task_titles"}


def test_update_requires_at_least_one_change() -> None:
    with pytest.raises(DomainValidationError, match="at least one"):
        UpdateTask(task_ref="task-1", changes=())


def test_event_must_end_after_it_starts() -> None:
    start = dt.datetime(2026, 8, 29, 15, 0, tzinfo=UTC)

    with pytest.raises(DomainValidationError, match="end after"):
        CreateEvent(title="dentist", start=start, end=start)


def test_event_times_must_be_aware() -> None:
    with pytest.raises(DomainValidationError, match="timezone"):
        CreateEvent(
            title="dentist",
            start=dt.datetime(2026, 8, 29, 15, 0),
            end=dt.datetime(2026, 8, 29, 16, 0),
        )


def test_event_title_is_trimmed_and_required() -> None:
    event = CreateEvent(
        title="  dentist  ",
        start=dt.datetime(2026, 8, 29, 15, 0, tzinfo=UTC),
        end=dt.datetime(2026, 8, 29, 16, 0, tzinfo=UTC),
    )
    assert event.title == "dentist"

    with pytest.raises(DomainValidationError, match="blank"):
        CreateEvent(
            title="   ",
            start=dt.datetime(2026, 8, 29, 15, 0, tzinfo=UTC),
            end=dt.datetime(2026, 8, 29, 16, 0, tzinfo=UTC),
        )


def test_date_query_requires_a_date() -> None:
    with pytest.raises(DomainValidationError, match="date"):
        Query(kind="date")


def test_clarification_requires_a_question() -> None:
    with pytest.raises(DomainValidationError, match="question"):
        Clarify(question="  ")


def test_mutating_intents_are_distinguished_from_read_only_ones() -> None:
    assert is_mutating(CreateTask(draft=TaskDraft(title="task"))) is True
    assert is_mutating(CompleteTask(task_ref="task-1")) is True
    assert is_mutating(Query(kind="today")) is False
    assert is_mutating(Clarify(question="which one?")) is False


def test_intent_kind_is_the_type_name() -> None:
    assert intent_kind(CreateTask(draft=TaskDraft(title="task"))) == "CreateTask"
    assert intent_kind(Clarify(question="which one?")) == "Clarify"
