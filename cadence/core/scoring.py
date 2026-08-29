"""Deterministic prioritisation.

The formula from spec section 9, implemented as pure functions. This is the piece that
keeps working when the model is unavailable, so it takes no provider and performs no I/O.

Effort is deliberately absent from the formula. Penalising large tasks means large tasks
never get done; effort is a fit constraint at placement time instead.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from cadence.core.errors import DomainValidationError
from cadence.core.tasks import IMPORTANCE_MAX, IMPORTANCE_MIN, Task

SLIP_SATURATION = 3
UNBLOCKS_SATURATION = 3
AGE_SATURATION_DAYS = 30
WEIGHT_SUM_TOLERANCE = 1e-9


@dataclasses.dataclass(frozen=True, slots=True)
class ScoreWeights:
    deadline: float = 0.35
    importance: float = 0.25
    slip: float = 0.15
    unblocks: float = 0.15
    age: float = 0.10
    horizon_days: int = 14

    def __post_init__(self) -> None:
        total = self.deadline + self.importance + self.slip + self.unblocks + self.age
        if abs(total - 1.0) > WEIGHT_SUM_TOLERANCE:
            raise DomainValidationError(f"weights must sum to 1.0, got {total}")
        if self.horizon_days <= 0:
            raise DomainValidationError("horizon_days must be positive")


DEFAULT_WEIGHTS = ScoreWeights()


@dataclasses.dataclass(frozen=True, slots=True)
class ScoreBreakdown:
    """Normalised terms plus the weighted total, so the UI can explain a ranking."""

    deadline_pressure: float
    importance: float
    slip_pressure: float
    unblocks: float
    age: float
    total: float
    weights: ScoreWeights

    def contributions(self) -> dict[str, float]:
        """Each term's actual contribution to the total."""
        return {
            "deadline_pressure": self.deadline_pressure * self.weights.deadline,
            "importance": self.importance * self.weights.importance,
            "slip_pressure": self.slip_pressure * self.weights.slip,
            "unblocks": self.unblocks * self.weights.unblocks,
            "age": self.age * self.weights.age,
        }


def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, value))


def deadline_pressure(deadline: dt.date | None, today: dt.date, horizon_days: int) -> float:
    """Zero without a deadline, 1.0 once due or overdue, ramping in between."""
    if deadline is None:
        return 0.0
    days_until = (deadline - today).days
    if days_until <= 0:
        return 1.0
    return _clamp_unit(1.0 - days_until / horizon_days)


def importance_norm(importance: int) -> float:
    span = IMPORTANCE_MAX - IMPORTANCE_MIN
    return _clamp_unit((importance - IMPORTANCE_MIN) / span)


def slip_pressure(slip_count: int) -> float:
    return _clamp_unit(slip_count / SLIP_SATURATION)


def unblocks_pressure(dependent_count: int) -> float:
    return _clamp_unit(dependent_count / UNBLOCKS_SATURATION)


def age_pressure(created_at: dt.datetime, now: dt.datetime) -> float:
    elapsed_days = (now - created_at).total_seconds() / 86_400
    return _clamp_unit(elapsed_days / AGE_SATURATION_DAYS)


def score_task(
    task: Task,
    *,
    now: dt.datetime,
    unblocked_dependents: int = 0,
    weights: ScoreWeights = DEFAULT_WEIGHTS,
) -> ScoreBreakdown:
    """Score one task. Pure: same inputs always give the same result."""
    deadline = deadline_pressure(task.draft.deadline, now.date(), weights.horizon_days)
    importance = importance_norm(task.draft.importance)
    slip = slip_pressure(task.slip_count)
    unblocks = unblocks_pressure(unblocked_dependents)
    age = age_pressure(task.created_at, now)

    total = (
        deadline * weights.deadline
        + importance * weights.importance
        + slip * weights.slip
        + unblocks * weights.unblocks
        + age * weights.age
    )
    return ScoreBreakdown(
        deadline_pressure=deadline,
        importance=importance,
        slip_pressure=slip,
        unblocks=unblocks,
        age=age,
        total=total,
        weights=weights,
    )
