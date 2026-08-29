import datetime as dt
from collections.abc import Mapping
from typing import Any

import pytest

from cadence.adapters.gemini_provider import GeminiProvider, build_prompt, build_repair_prompt
from cadence.adapters.intent_codec import INTENT_JSON_SCHEMA, decode_intent
from cadence.core.errors import ProviderError, QuotaExhaustedError
from cadence.core.intents import (
    Clarify,
    CompleteTask,
    CreateEvent,
    CreateTask,
    IntentContext,
    PinTask,
    Query,
    UpdateTask,
)

CONTEXT = IntentContext(
    today=dt.date(2026, 8, 29),
    timezone="Asia/Singapore",
    recent_task_ids=("task-1",),
    recent_task_titles=("write the quarterly report",),
)
MODEL = "configured-flash-lite"


def provider(*responses: Mapping[str, Any] | Exception) -> tuple[GeminiProvider, list[str]]:
    prompts: list[str] = []
    queue = list(responses)

    def transport(model_id: str, prompt: str, schema: Mapping[str, Any]) -> Mapping[str, Any]:
        assert model_id == MODEL
        assert schema is INTENT_JSON_SCHEMA
        prompts.append(prompt)
        outcome = queue.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    return GeminiProvider(model_id=MODEL, transport=transport), prompts


def test_model_id_must_be_supplied() -> None:
    with pytest.raises(ValueError, match="configured"):
        GeminiProvider(model_id="", transport=lambda *_: {})


def test_a_valid_response_decodes_to_a_create_task() -> None:
    client, _ = provider(
        {
            "intent": "CreateTask",
            "title": "write the quarterly report",
            "effort_minutes": 180,
            "importance": 4,
            "deadline": "2026-09-04",
            "tags": ["Work", "work"],
        }
    )

    intent = client.compile_intent("write the quarterly report, 3h, important, due friday", CONTEXT)

    assert isinstance(intent, CreateTask)
    assert intent.draft.title == "write the quarterly report"
    assert intent.draft.effort_minutes == 180
    assert intent.draft.importance == 4
    assert intent.draft.deadline == dt.date(2026, 9, 4)
    assert intent.draft.tags == ("work",)


def test_the_prompt_contains_the_utterance_and_the_date() -> None:
    prompt = build_prompt("dentist thursday 3pm", CONTEXT)

    assert "dentist thursday 3pm" in prompt
    assert "2026-08-29" in prompt
    assert "Asia/Singapore" in prompt


def test_the_prompt_carries_no_calendar_text() -> None:
    # Invariant 4. IntentContext has no field for it, so there is nothing to leak, but the
    # assertion documents the requirement at the boundary that would violate it.
    prompt = build_prompt("write the report", CONTEXT)

    assert "attendee" not in prompt.lower()
    assert "@" not in prompt


def test_the_repair_prompt_includes_the_rejection_reason() -> None:
    prompt = build_repair_prompt("write the report", CONTEXT, "importance must be 1 to 5")

    assert "importance must be 1 to 5" in prompt
    assert "write the report" in prompt


def test_quota_exhaustion_propagates_unchanged() -> None:
    client, _ = provider(QuotaExhaustedError("daily quota reached"))

    with pytest.raises(QuotaExhaustedError):
        client.compile_intent("write the report", CONTEXT)


def test_a_transport_failure_becomes_a_provider_error() -> None:
    client, _ = provider(RuntimeError("connection reset"))

    with pytest.raises(ProviderError, match="transport failed"):
        client.compile_intent("write the report", CONTEXT)


def test_a_non_object_response_is_refused() -> None:
    client, _ = provider(["not", "an", "object"])  # type: ignore[list-item]

    with pytest.raises(ProviderError):
        client.compile_intent("write the report", CONTEXT)


def test_an_unknown_intent_name_is_refused() -> None:
    client, _ = provider({"intent": "DeleteEverything"})

    with pytest.raises(ProviderError, match="unknown intent"):
        client.compile_intent("nuke it", CONTEXT)


def test_a_domain_rule_violation_is_refused_rather_than_clamped() -> None:
    client, _ = provider({"intent": "CreateTask", "title": "task", "importance": 99})

    with pytest.raises(ProviderError, match="domain rule"):
        client.compile_intent("write the report", CONTEXT)


def test_a_naive_datetime_is_refused() -> None:
    client, _ = provider(
        {
            "intent": "CreateEvent",
            "title": "dentist",
            "start": "2026-09-03T15:00:00",
            "end": "2026-09-03T16:00:00",
        }
    )

    with pytest.raises(ProviderError, match="timezone offset"):
        client.compile_intent("dentist thursday 3pm", CONTEXT)


def test_an_aware_datetime_decodes() -> None:
    client, _ = provider(
        {
            "intent": "CreateEvent",
            "title": "dentist",
            "start": "2026-09-03T15:00:00+08:00",
            "end": "2026-09-03T16:00:00+08:00",
        }
    )

    intent = client.compile_intent("dentist thursday 3pm", CONTEXT)

    assert isinstance(intent, CreateEvent)
    assert intent.start.utcoffset() == dt.timedelta(hours=8)


def test_repair_is_a_second_transport_call() -> None:
    client, prompts = provider(
        ProviderError("schema violation"),
        {"intent": "CompleteTask", "task_ref": "the report"},
    )

    with pytest.raises(ProviderError):
        client.compile_intent("done the report", CONTEXT)
    intent = client.repair_intent("done the report", CONTEXT, "schema violation")

    assert isinstance(intent, CompleteTask)
    assert len(prompts) == 2


def test_update_drops_fields_that_are_not_part_of_a_draft() -> None:
    intent = decode_intent(
        {
            "intent": "UpdateTask",
            "task_ref": "the report",
            "changes": {"importance": 5, "status": "done", "id": "hacked"},
        }
    )

    assert isinstance(intent, UpdateTask)
    assert dict(intent.changes) == {"importance": 5}


def test_pin_without_a_date_clears_the_pin() -> None:
    intent = decode_intent({"intent": "PinTask", "task_ref": "the report"})

    assert isinstance(intent, PinTask)
    assert intent.date is None


def test_a_query_defaults_to_today() -> None:
    intent = decode_intent({"intent": "Query"})

    assert isinstance(intent, Query)
    assert intent.kind == "today"


def test_an_unknown_query_kind_is_refused() -> None:
    with pytest.raises(ProviderError, match="unknown query kind"):
        decode_intent({"intent": "Query", "kind": "everything"})


def test_clarify_carries_candidates() -> None:
    intent = decode_intent(
        {"intent": "Clarify", "question": "which one?", "candidates": ["a", "b"]}
    )

    assert isinstance(intent, Clarify)
    assert intent.candidates == ("a", "b")


def test_a_missing_required_field_is_refused() -> None:
    with pytest.raises(ProviderError, match="missing required field"):
        decode_intent({"intent": "CompleteTask"})
