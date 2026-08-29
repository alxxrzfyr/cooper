"""Deterministic reference resolution.

Model self-reported confidence is uncalibrated and is never consulted. A reference
resolves only when the evidence is unambiguous by a fixed rule; otherwise the caller is
expected to ask. Guessing here would silently mutate the wrong task.
"""

from __future__ import annotations

import dataclasses
from collections.abc import Mapping
from difflib import SequenceMatcher

from cadence.core.errors import AmbiguousReferenceError, TaskNotFoundError

SIMILARITY_THRESHOLD = 0.75
TIE_MARGIN = 0.05


@dataclasses.dataclass(frozen=True, slots=True)
class Candidate:
    id: str
    title: str


def _normalise(text: str) -> str:
    return " ".join(text.strip().lower().split())


def similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, _normalise(left), _normalise(right)).ratio()


def resolve_reference(
    reference: str,
    candidates: Mapping[str, str],
    *,
    threshold: float = SIMILARITY_THRESHOLD,
    tie_margin: float = TIE_MARGIN,
) -> str:
    """Resolve a reference to exactly one candidate id.

    `candidates` maps id to title. Raises `TaskNotFoundError` when nothing is close
    enough and `AmbiguousReferenceError` when two candidates are too close to separate.
    """
    cleaned = _normalise(reference)
    if not cleaned:
        raise TaskNotFoundError("an empty reference cannot be resolved")

    if reference in candidates:
        return reference

    exact = [task_id for task_id, title in candidates.items() if _normalise(title) == cleaned]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise AmbiguousReferenceError(
            f"{len(exact)} tasks share the title {reference!r}",
            tuple(candidates[task_id] for task_id in exact),
        )

    contains = [task_id for task_id, title in candidates.items() if cleaned in _normalise(title)]
    if len(contains) == 1:
        return contains[0]
    if len(contains) > 1:
        raise AmbiguousReferenceError(
            f"{reference!r} matches more than one task",
            tuple(candidates[task_id] for task_id in contains),
        )

    scored = sorted(
        ((similarity(reference, title), task_id) for task_id, title in candidates.items()),
        key=lambda entry: (-entry[0], entry[1]),
    )
    if not scored or scored[0][0] < threshold:
        raise TaskNotFoundError(f"nothing matches {reference!r} closely enough")

    best_score, best_id = scored[0]
    if len(scored) > 1 and best_score - scored[1][0] <= tie_margin:
        near = tuple(
            candidates[task_id] for score, task_id in scored if best_score - score <= tie_margin
        )
        raise AmbiguousReferenceError(f"{reference!r} is too close to call", near)
    return best_id
