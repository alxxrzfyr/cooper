"""The reranker: the only component that reads third-party text.

Calendar events created by other people put text Cadence did not author into the system. That
text reaches this component and no other, and its output is validated as a permutation of the
IDs Cadence itself supplied.

The consequence is the containment this design depends on: **a fully hijacked reranker can do
exactly one thing, which is order ten of the user's own tasks wrongly.** It cannot create,
complete, schedule, move, or delete anything. Filtering injection attempts out of event titles
is not attempted, because filters lose. The capability boundary holds regardless of what a
title says.
"""

from __future__ import annotations

import dataclasses

from cadence.core.errors import ProviderError

REASON_MAX_LENGTH = 200
DEFAULT_CANDIDATE_COUNT = 10


@dataclasses.dataclass(frozen=True, slots=True)
class RerankCandidate:
    """What the model is told about one candidate. Numbers and the user's own title."""

    task_id: str
    title: str
    score: float
    effort_minutes: int | None
    deadline: str | None
    slip_count: int


@dataclasses.dataclass(frozen=True, slots=True)
class RerankResult:
    """A validated reordering plus the reason the model must supply."""

    order: tuple[str, ...]
    reason: str

    def __post_init__(self) -> None:
        if not self.order:
            raise ProviderError("a rerank must return an order")
        if not self.reason.strip():
            raise ProviderError("a rerank must state a reason")
        if len(self.reason) > REASON_MAX_LENGTH:
            raise ProviderError(f"reason exceeds {REASON_MAX_LENGTH} characters")


def validate_permutation(
    supplied: tuple[str, ...],
    returned: object,
) -> tuple[str, ...]:
    """Accept a reordering only if it is exactly the supplied set, rearranged.

    Every rejection path matters. An unknown id would let the model point at a task it was
    never shown; a missing id would let it silently drop work; a duplicate would corrupt the
    ordering. All three are refused rather than repaired.
    """
    if not isinstance(returned, (list, tuple)):
        raise ProviderError("rerank order must be an array of task ids")

    order = tuple(str(item) for item in returned)
    supplied_set = set(supplied)

    unknown = [task_id for task_id in order if task_id not in supplied_set]
    if unknown:
        raise ProviderError(f"rerank named ids that were not supplied: {unknown}")

    if len(set(order)) != len(order):
        raise ProviderError("rerank repeated a task id")

    missing = supplied_set - set(order)
    if missing:
        raise ProviderError(f"rerank omitted supplied ids: {sorted(missing)}")

    return order


def apply_rerank(
    candidates: tuple[RerankCandidate, ...],
    result: RerankResult,
) -> tuple[RerankCandidate, ...]:
    """Reorder candidates by a validated result. Never adds or removes anything."""
    by_id = {candidate.task_id: candidate for candidate in candidates}
    order = validate_permutation(tuple(by_id), result.order)
    return tuple(by_id[task_id] for task_id in order)
