"""Prioritisation orchestration.

Reads tasks, counts what each one unblocks, and hands both to the pure ranking functions.
Takes no LLM provider, because Phase 2 ranking must work with the model unavailable.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from cadence.core.candidates import RankedTask, count_dependents, rank_tasks
from cadence.core.protocols import Clock, TaskRepository
from cadence.core.scoring import DEFAULT_WEIGHTS, ScoreWeights
from cadence.core.tasks import Task

DEFAULT_SHORTLIST_SIZE = 5


@dataclasses.dataclass(frozen=True, slots=True)
class Plan:
    """One rendering of the current priorities."""

    generated_at: dt.datetime
    shortlist: tuple[RankedTask, ...]
    backlog: tuple[RankedTask, ...]
    blocked: tuple[Task, ...]
    degraded: bool = False


class PlanService:
    def __init__(
        self,
        *,
        repository: TaskRepository,
        clock: Clock,
        weights: ScoreWeights = DEFAULT_WEIGHTS,
    ) -> None:
        self._repository = repository
        self._clock = clock
        self._weights = weights

    def _ranked(self, now: dt.datetime) -> tuple[RankedTask, ...]:
        active = self._repository.list(statuses=("active",))
        return rank_tasks(
            active,
            now=now,
            blocked_ids=self._repository.blocked_task_ids(),
            dependents=count_dependents(self._repository.dependency_edges()),
            weights=self._weights,
        )

    def today(self, *, limit: int = DEFAULT_SHORTLIST_SIZE) -> tuple[RankedTask, ...]:
        return self._ranked(self._clock.now())[:limit]

    def backlog(self) -> tuple[RankedTask, ...]:
        return self._ranked(self._clock.now())

    def blocked(self) -> tuple[Task, ...]:
        blocked_ids = self._repository.blocked_task_ids()
        return tuple(
            task for task in self._repository.list(statuses=("active",)) if task.id in blocked_ids
        )

    def plan(self, *, limit: int = DEFAULT_SHORTLIST_SIZE) -> Plan:
        now = self._clock.now()
        ranked = self._ranked(now)
        return Plan(
            generated_at=now,
            shortlist=ranked[:limit],
            backlog=ranked,
            blocked=self.blocked(),
        )
