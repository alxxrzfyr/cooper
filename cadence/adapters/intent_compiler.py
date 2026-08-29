"""The bounded compile pipeline.

Enforces the ceiling the free-tier quota makes necessary: at most two model calls per
utterance, then an offline parser, then a question. Every path terminates, and no path
loops.

The order matters. A repair attempt is worth one extra call because schema violations are
usually trivially fixable. A third call is not, because by then the model has failed twice
on the same input and the offline parser is both faster and free.
"""

from __future__ import annotations

import dataclasses

from cadence.core.errors import ProviderError, QuotaExhaustedError
from cadence.core.intents import Clarify, Intent, IntentContext
from cadence.core.protocols import LLMProvider

MAX_MODEL_CALLS = 2


@dataclasses.dataclass(frozen=True, slots=True)
class CompileResult:
    """What was produced, by whom, and at what cost."""

    intent: Intent
    provider_name: str
    model_calls: int
    repaired: bool = False
    degraded: bool = False

    @property
    def is_clarification(self) -> bool:
        return isinstance(self.intent, Clarify)


# Repair is an optional capability, detected at runtime rather than declared as a second
# Protocol. A provider that cannot repair simply falls through to the offline parser.
REPAIR_METHOD = "repair_intent"


class BoundedIntentCompiler:
    """Compiles one utterance into one intent, with a hard call ceiling."""

    def __init__(
        self,
        *,
        primary: LLMProvider | None,
        fallback: LLMProvider,
        max_model_calls: int = MAX_MODEL_CALLS,
    ) -> None:
        if max_model_calls < 0:
            raise ValueError("max_model_calls must not be negative")
        self._primary = primary
        self._fallback = fallback
        self._max_model_calls = max_model_calls

    @property
    def degraded(self) -> bool:
        """True when no model is configured, so only the offline parser is available."""
        return self._primary is None

    def compile(self, utterance: str, context: IntentContext) -> CompileResult:
        if self._primary is None or self._max_model_calls == 0:
            return self._offline(utterance, context, model_calls=0, degraded=True)

        calls = 0
        first_error: str | None = None
        quota_exhausted = False

        try:
            calls += 1
            intent = self._primary.compile_intent(utterance, context)
            return CompileResult(
                intent=intent,
                provider_name=self._primary.name,
                model_calls=calls,
                degraded=False,
            )
        except QuotaExhaustedError:
            quota_exhausted = True
        except ProviderError as error:
            first_error = str(error)

        if not quota_exhausted and calls < self._max_model_calls:
            repair = getattr(self._primary, REPAIR_METHOD, None)
            if callable(repair):
                try:
                    calls += 1
                    intent = repair(utterance, context, first_error or "invalid output")
                    return CompileResult(
                        intent=intent,
                        provider_name=self._primary.name,
                        model_calls=calls,
                        repaired=True,
                        degraded=False,
                    )
                except ProviderError:
                    pass

        return self._offline(utterance, context, model_calls=calls, degraded=quota_exhausted)

    def _offline(
        self,
        utterance: str,
        context: IntentContext,
        *,
        model_calls: int,
        degraded: bool,
    ) -> CompileResult:
        try:
            intent = self._fallback.compile_intent(utterance, context)
        except ProviderError:
            # Last resort. A question is always a safe answer; a guess is not.
            return CompileResult(
                intent=Clarify(question="I could not read that. Could you rephrase it?"),
                provider_name=self._fallback.name,
                model_calls=model_calls,
                degraded=degraded,
            )
        return CompileResult(
            intent=intent,
            provider_name=self._fallback.name,
            model_calls=model_calls,
            degraded=degraded,
        )
