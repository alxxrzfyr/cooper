"""Gemini structured-output provider.

The transport is injected, so this adapter is testable without credentials and the SDK
choice stays replaceable. The model ID arrives from configuration and never appears here
as a literal: the Gemini lineup changes often enough that a rename must be a config edit.

The prompt is built from the user's own utterance plus a narrow context header. Nothing
else is in scope. Passing calendar text through here would break invariant 4.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Any

from cadence.adapters.intent_codec import INTENT_JSON_SCHEMA, decode_intent
from cadence.core.errors import ProviderError, QuotaExhaustedError
from cadence.core.intents import Intent, IntentContext

# (model_id, prompt, schema) -> decoded JSON object.
JsonTransport = Callable[[str, str, Mapping[str, Any]], Mapping[str, Any]]

SYSTEM_RULES = """\
You translate one sentence into exactly one intent object matching the given schema.
Rules:
- Emit one intent only. Never prose, never multiple objects.
- If the sentence is ambiguous or you cannot resolve which task it refers to, emit Clarify.
- Never invent a task reference. Prefer Clarify over a guess.
- Dates are ISO. Datetimes include a timezone offset.
- Effort is whole minutes. Importance is 1 to 5, where 5 is most important.
"""


def build_prompt(utterance: str, context: IntentContext) -> str:
    """Compose the prompt. Only user-authored text and a narrow context header."""
    lines = [
        SYSTEM_RULES,
        f"Today is {context.today.isoformat()} in timezone {context.timezone}.",
    ]
    if context.recent_task_titles:
        listed = "; ".join(context.recent_task_titles)
        lines.append(f"Recently referenced tasks, for resolving references only: {listed}")
    lines.append(f"Sentence: {utterance}")
    return "\n".join(lines)


def build_repair_prompt(utterance: str, context: IntentContext, error: str) -> str:
    return "\n".join(
        [
            build_prompt(utterance, context),
            f"Your previous answer was rejected: {error}",
            "Return one corrected intent object that satisfies the schema.",
        ]
    )


class GeminiProvider:
    """Compiles intents with a structured-output model."""

    name = "gemini"

    def __init__(self, *, model_id: str, transport: JsonTransport) -> None:
        if not model_id:
            raise ValueError("model_id must be configured, never hardcoded")
        self._model_id = model_id
        self._transport = transport

    @property
    def model_id(self) -> str:
        return self._model_id

    def _call(self, prompt: str) -> Intent:
        try:
            payload = self._transport(self._model_id, prompt, INTENT_JSON_SCHEMA)
        except QuotaExhaustedError:
            raise
        except ProviderError:
            raise
        except Exception as error:  # transport failures are provider failures
            raise ProviderError(f"transport failed: {error}") from error

        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError as error:
                raise ProviderError("model did not return JSON") from error
        if not isinstance(payload, Mapping):
            raise ProviderError("model did not return a JSON object")
        return decode_intent(payload)

    def compile_intent(self, utterance: str, context: IntentContext) -> Intent:
        return self._call(build_prompt(utterance, context))

    def repair_intent(self, utterance: str, context: IntentContext, error: str) -> Intent:
        return self._call(build_repair_prompt(utterance, context, error))
