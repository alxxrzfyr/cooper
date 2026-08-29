"""Capture orchestration: sentence in, change out.

Builds the narrow context the compiler is allowed to see, runs the bounded pipeline, and
executes whatever validated intent comes back. The context is assembled here from the
user's own tasks only, which is the single place invariant 4 could be violated and
therefore the place worth reading carefully.
"""

from __future__ import annotations

import dataclasses

from cadence.adapters.intent_compiler import BoundedIntentCompiler
from cadence.core.intents import IntentContext
from cadence.core.protocols import Clock
from cadence.services.intent_executor import CaptureOutcome, IntentExecutor
from cadence.services.task_service import TaskService

RECENT_REFERENCE_LIMIT = 5


@dataclasses.dataclass(frozen=True, slots=True)
class CaptureView:
    """What happened, and what it cost."""

    outcome: CaptureOutcome
    provider_name: str
    model_calls: int
    degraded: bool


class CaptureService:
    def __init__(
        self,
        *,
        compiler: BoundedIntentCompiler,
        executor: IntentExecutor,
        tasks: TaskService,
        clock: Clock,
        timezone: str,
    ) -> None:
        self._compiler = compiler
        self._executor = executor
        self._tasks = tasks
        self._clock = clock
        self._timezone = timezone

    def _context(self) -> IntentContext:
        active = self._tasks.list(statuses=("active",))
        recent = active[-RECENT_REFERENCE_LIMIT:]
        return IntentContext(
            today=self._clock.now().astimezone().date(),
            timezone=self._timezone,
            recent_task_ids=tuple(task.id for task in recent),
            recent_task_titles=tuple(task.title for task in recent),
        )

    def capture(self, utterance: str) -> CaptureView:
        result = self._compiler.compile(utterance, self._context())
        outcome = self._executor.execute(result.intent)
        return CaptureView(
            outcome=outcome,
            provider_name=result.provider_name,
            model_calls=result.model_calls,
            degraded=result.degraded,
        )

    def undo(self, mutation_id: str) -> CaptureView:
        return CaptureView(
            outcome=self._executor.undo(mutation_id),
            provider_name="none",
            model_calls=0,
            degraded=self._compiler.degraded,
        )

    def status(self) -> tuple[str, bool]:
        """Provider name and whether only the offline parser is available."""
        degraded = self._compiler.degraded
        return ("rule_based" if degraded else "gemini", degraded)
