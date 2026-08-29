"""Candidate selection and ranking.

Blocked tasks are excluded outright rather than ranked low: a task you cannot start is
not a choice, and showing it as a low-priority option is noise.

Pinned tasks bypass scoring entirely. That override exists so the tool never argues with
its user.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections.abc import Iterable, Mapping

from cadence.core.scoring import DEFAULT_WEIGHTS, ScoreBreakdown, ScoreWeights, score_task
from cadence.core.tasks import Task


@dataclasses.dataclass(frozen=True, slots=True)
class RankedTask:
    rank: int
    task: Task
    breakdown: ScoreBreakdown
    is_pinned: bool

    @property
    def id(self) -> str:
        return self.task.id

    @property
    def title(self) -> str:
        return self.task.title


def select_candidates(
    tasks: Iterable[Task],
    *,
    now: dt.datetime,
    blocked_ids: frozenset[str] = frozenset(),
    weights: ScoreWeights = DEFAULT_WEIGHTS,
) -> tuple[Task, ...]:
    """Active, unblocked tasks that could be started within the horizon."""
    horizon_end = now + dt.timedelta(days=weights.horizon_days)
    candidates = []
    for task in tasks:
        if not task.is_actionable or task.id in blocked_ids:
            continue
        earliest_start = task.draft.earliest_start
        if earliest_start is not None and earliest_start > horizon_end:
            continue
        candidates.append(task)
    return tuple(candidates)


def rank_tasks(
    tasks: Iterable[Task],
    *,
    now: dt.datetime,
    blocked_ids: frozenset[str] = frozenset(),
    dependents: Mapping[str, int] | None = None,
    weights: ScoreWeights = DEFAULT_WEIGHTS,
    today: dt.date | None = None,
) -> tuple[RankedTask, ...]:
    """Rank candidates highest-first. Deterministic, and makes no model calls."""
    dependent_counts = dependents or {}
    effective_today = today or now.date()

    scored = [
        (
            task,
            score_task(
                task,
                now=now,
                unblocked_dependents=dependent_counts.get(task.id, 0),
                weights=weights,
            ),
            task.pinned_for_date == effective_today,
        )
        for task in select_candidates(tasks, now=now, blocked_ids=blocked_ids, weights=weights)
    ]

    # Pinned first, then score descending. Creation time and id break ties so the same
    # inputs always produce the same order.
    scored.sort(
        key=lambda entry: (
            not entry[2],
            -entry[1].total,
            entry[0].created_at,
            entry[0].id,
        )
    )
    return tuple(
        RankedTask(rank=position, task=task, breakdown=breakdown, is_pinned=is_pinned)
        for position, (task, breakdown, is_pinned) in enumerate(scored, start=1)
    )


def count_dependents(dependency_edges: Iterable[tuple[str, str]]) -> dict[str, int]:
    """Count how many tasks each blocker is holding up."""
    counts: dict[str, int] = {}
    for blocker_id, _blocked_id in dependency_edges:
        counts[blocker_id] = counts.get(blocker_id, 0) + 1
    return counts
