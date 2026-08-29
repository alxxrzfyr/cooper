import datetime as dt

import pytest

from cadence.adapters.rule_provider import RuleBasedProvider
from cadence.core.intents import (
    Clarify,
    CompleteTask,
    CreateEvent,
    CreateTask,
    DropTask,
    Intent,
    IntentContext,
    PinTask,
    Query,
    Undo,
)

TODAY = dt.date(2026, 8, 29)  # a Saturday
CONTEXT = IntentContext(today=TODAY, timezone="Asia/Singapore")


def parse(utterance: str) -> Intent:
    return RuleBasedProvider().compile_intent(utterance, CONTEXT)


def test_provider_is_named_for_logging() -> None:
    assert RuleBasedProvider().name == "rule_based"


def test_a_bare_sentence_becomes_a_task() -> None:
    intent = parse("write the quarterly report")

    assert isinstance(intent, CreateTask)
    assert intent.draft.title == "write the quarterly report"
    assert intent.draft.importance == 3
    assert intent.draft.effort_minutes is None


@pytest.mark.parametrize(
    ("phrase", "expected_minutes"),
    [("3h", 180), ("90m", 90), ("2 hours", 120), ("45 mins", 45), ("1.5h", 90)],
)
def test_effort_is_parsed_in_hours_and_minutes(phrase: str, expected_minutes: int) -> None:
    intent = parse(f"write the report, {phrase}")

    assert isinstance(intent, CreateTask)
    assert intent.draft.effort_minutes == expected_minutes


@pytest.mark.parametrize(
    ("word", "expected"),
    [("critical", 5), ("important", 4), ("minor", 2), ("someday", 1)],
)
def test_importance_words_map_to_levels(word: str, expected: int) -> None:
    intent = parse(f"write the report, {word}")

    assert isinstance(intent, CreateTask)
    assert intent.draft.importance == expected


def test_a_full_task_sentence_parses_every_field() -> None:
    intent = parse("write the quarterly report, 3h, important, due friday")

    assert isinstance(intent, CreateTask)
    assert intent.draft.title == "write the quarterly report"
    assert intent.draft.effort_minutes == 180
    assert intent.draft.importance == 4
    assert intent.draft.deadline == dt.date(2026, 9, 4)


@pytest.mark.parametrize(
    ("phrase", "expected"),
    [
        ("today", TODAY),
        ("tomorrow", dt.date(2026, 8, 30)),
        ("monday", dt.date(2026, 8, 31)),
        ("next week", dt.date(2026, 9, 5)),
        ("2026-09-10", dt.date(2026, 9, 10)),
    ],
)
def test_deadline_phrases_resolve_to_dates(phrase: str, expected: dt.date) -> None:
    intent = parse(f"write the report, due {phrase}")

    assert isinstance(intent, CreateTask)
    assert intent.draft.deadline == expected


def test_a_date_and_a_clock_time_make_a_fixed_event() -> None:
    intent = parse("dentist thursday 3pm")

    assert isinstance(intent, CreateEvent)
    assert intent.title == "dentist"
    assert intent.start.date() == dt.date(2026, 9, 3)
    assert intent.start.hour == 15
    assert intent.end - intent.start == dt.timedelta(hours=1)


def test_twenty_four_hour_times_are_understood() -> None:
    intent = parse("standup tomorrow 09:30")

    assert isinstance(intent, CreateEvent)
    assert (intent.start.hour, intent.start.minute) == (9, 30)


def test_an_event_carries_the_configured_timezone() -> None:
    intent = parse("dentist thursday 3pm")

    assert isinstance(intent, CreateEvent)
    assert intent.start.tzinfo is not None
    assert intent.start.utcoffset() == dt.timedelta(hours=8)


def test_an_event_duration_can_be_given() -> None:
    intent = parse("workshop monday 10am 2h")

    assert isinstance(intent, CreateEvent)
    assert intent.end - intent.start == dt.timedelta(hours=2)


def test_a_sentence_without_a_clock_time_is_a_task_not_an_event() -> None:
    assert isinstance(parse("call the dentist on thursday"), CreateTask)


@pytest.mark.parametrize("phrase", ["done write the report", "completed write the report"])
def test_completion_phrases_produce_complete_intents(phrase: str) -> None:
    intent = parse(phrase)

    assert isinstance(intent, CompleteTask)
    assert intent.task_ref == "write the report"


def test_completion_without_a_reference_asks() -> None:
    assert isinstance(parse("done"), Clarify)


def test_drop_phrases_produce_drop_intents() -> None:
    intent = parse("drop the team offsite")

    assert isinstance(intent, DropTask)
    assert intent.task_ref == "the team offsite"


def test_pin_sets_today() -> None:
    intent = parse("pin the quarterly report")

    assert isinstance(intent, PinTask)
    assert intent.task_ref == "the quarterly report"
    assert intent.date == TODAY


def test_undo_is_recognised() -> None:
    assert isinstance(parse("undo"), Undo)


@pytest.mark.parametrize(
    "phrase",
    ["what should i do", "what's next", "today", "what should i work on"],
)
def test_shortlist_questions_become_today_queries(phrase: str) -> None:
    intent = parse(phrase)

    assert isinstance(intent, Query)
    assert intent.kind == "today"


def test_backlog_questions_become_backlog_queries() -> None:
    intent = parse("show the backlog")

    assert isinstance(intent, Query)
    assert intent.kind == "backlog"


def test_an_empty_utterance_asks_rather_than_guessing() -> None:
    assert isinstance(parse("   "), Clarify)


def test_parsing_is_deterministic() -> None:
    first = parse("write the quarterly report, 3h, important, due friday")
    second = parse("write the quarterly report, 3h, important, due friday")

    assert first == second


def test_provider_never_touches_the_network() -> None:
    # Constructed and exercised with no transport of any kind; if this ever needed a
    # client, this test would have to change, which is the point.
    provider = RuleBasedProvider()

    assert isinstance(provider.compile_intent("write the report", CONTEXT), CreateTask)
