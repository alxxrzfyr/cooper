import datetime as dt

from cadence.adapters.intent_compiler import MAX_MODEL_CALLS, BoundedIntentCompiler
from cadence.adapters.rule_provider import RuleBasedProvider
from cadence.core.errors import ProviderError, QuotaExhaustedError
from cadence.core.intents import Clarify, CreateTask, Intent, IntentContext
from cadence.core.tasks import TaskDraft

CONTEXT = IntentContext(today=dt.date(2026, 8, 29), timezone="Asia/Singapore")


class CountingProvider:
    """Records every call so the ceiling can be asserted directly."""

    name = "counting"

    def __init__(
        self,
        *,
        compile_results: list[Intent | Exception],
        repair_results: list[Intent | Exception] | None = None,
    ) -> None:
        self.compile_results = compile_results
        self.repair_results = repair_results or []
        self.compile_calls = 0
        self.repair_calls = 0

    @property
    def total_calls(self) -> int:
        return self.compile_calls + self.repair_calls

    def _next(self, queue: list[Intent | Exception]) -> Intent:
        outcome = queue.pop(0) if queue else ProviderError("exhausted")
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def compile_intent(self, utterance: str, context: IntentContext) -> Intent:
        self.compile_calls += 1
        return self._next(self.compile_results)

    def repair_intent(self, utterance: str, context: IntentContext, error: str) -> Intent:
        self.repair_calls += 1
        return self._next(self.repair_results)


def build(primary: CountingProvider | None) -> BoundedIntentCompiler:
    return BoundedIntentCompiler(primary=primary, fallback=RuleBasedProvider())


def task_intent(title: str = "from the model") -> CreateTask:
    return CreateTask(draft=TaskDraft(title=title))


def test_a_valid_first_response_costs_one_call() -> None:
    provider = CountingProvider(compile_results=[task_intent()])

    result = build(provider).compile("write the report", CONTEXT)

    assert result.intent == task_intent()
    assert result.model_calls == 1
    assert result.repaired is False
    assert provider.total_calls == 1


def test_a_malformed_response_is_repaired_at_a_cost_of_two_calls() -> None:
    provider = CountingProvider(
        compile_results=[ProviderError("schema violation")],
        repair_results=[task_intent("repaired")],
    )

    result = build(provider).compile("write the report", CONTEXT)

    assert isinstance(result.intent, CreateTask)
    assert result.intent.draft.title == "repaired"
    assert result.model_calls == 2
    assert result.repaired is True


def test_two_failures_fall_back_to_the_offline_parser_without_a_third_call() -> None:
    provider = CountingProvider(
        compile_results=[ProviderError("first failure")],
        repair_results=[ProviderError("second failure")],
    )

    result = build(provider).compile("write the quarterly report, 3h", CONTEXT)

    assert provider.total_calls == MAX_MODEL_CALLS
    assert result.model_calls == MAX_MODEL_CALLS
    assert isinstance(result.intent, CreateTask)
    assert result.intent.draft.title == "write the quarterly report"
    assert result.provider_name == "rule_based"


def test_the_model_is_never_called_more_than_twice() -> None:
    provider = CountingProvider(
        compile_results=[ProviderError("a")],
        repair_results=[ProviderError("b")],
    )

    build(provider).compile("anything at all", CONTEXT)

    assert provider.total_calls <= MAX_MODEL_CALLS


def test_quota_exhaustion_skips_the_repair_attempt_entirely() -> None:
    # Retrying against an exhausted quota cannot succeed, so spending the call is waste.
    provider = CountingProvider(compile_results=[QuotaExhaustedError("out of quota")])

    result = build(provider).compile("write the report", CONTEXT)

    assert provider.compile_calls == 1
    assert provider.repair_calls == 0
    assert result.model_calls == 1
    assert result.degraded is True


def test_no_configured_model_uses_the_offline_parser_with_zero_calls() -> None:
    compiler = build(None)

    result = compiler.compile("write the quarterly report", CONTEXT)

    assert compiler.degraded is True
    assert result.model_calls == 0
    assert result.degraded is True
    assert isinstance(result.intent, CreateTask)


def test_a_zero_call_budget_forces_the_offline_parser() -> None:
    provider = CountingProvider(compile_results=[task_intent()])
    compiler = BoundedIntentCompiler(
        primary=provider,
        fallback=RuleBasedProvider(),
        max_model_calls=0,
    )

    result = compiler.compile("write the report", CONTEXT)

    assert provider.total_calls == 0
    assert result.provider_name == "rule_based"


def test_an_unparseable_utterance_ends_in_a_question_not_a_guess() -> None:
    provider = CountingProvider(
        compile_results=[ProviderError("a")],
        repair_results=[ProviderError("b")],
    )

    result = build(provider).compile("   ", CONTEXT)

    assert isinstance(result.intent, Clarify)
    assert result.is_clarification is True


def test_a_provider_without_repair_support_falls_straight_through() -> None:
    class NoRepair:
        name = "no-repair"

        def __init__(self) -> None:
            self.calls = 0

        def compile_intent(self, utterance: str, context: IntentContext) -> Intent:
            self.calls += 1
            raise ProviderError("bad output")

    provider = NoRepair()
    compiler = BoundedIntentCompiler(primary=provider, fallback=RuleBasedProvider())

    result = compiler.compile("write the report", CONTEXT)

    assert provider.calls == 1
    assert result.model_calls == 1
    assert result.provider_name == "rule_based"
