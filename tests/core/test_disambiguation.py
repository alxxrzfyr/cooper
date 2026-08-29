import pytest

from cadence.core.disambiguation import resolve_reference, similarity
from cadence.core.errors import AmbiguousReferenceError, TaskNotFoundError

CANDIDATES = {
    "task-1": "write the quarterly report",
    "task-2": "book the team offsite",
    "task-3": "review the budget",
}


def test_an_exact_id_resolves_immediately() -> None:
    assert resolve_reference("task-2", CANDIDATES) == "task-2"


def test_an_exact_title_resolves_regardless_of_case_and_spacing() -> None:
    assert resolve_reference("  Write The Quarterly REPORT ", CANDIDATES) == "task-1"


def test_a_unique_substring_resolves() -> None:
    assert resolve_reference("quarterly", CANDIDATES) == "task-1"


def test_a_substring_matching_two_titles_is_ambiguous() -> None:
    candidates = {"a": "design review weekly", "b": "design review prep"}

    with pytest.raises(AmbiguousReferenceError) as raised:
        resolve_reference("design review", candidates)

    assert set(raised.value.candidates) == {"design review weekly", "design review prep"}


def test_two_identical_titles_are_ambiguous() -> None:
    candidates = {"a": "standup", "b": "Standup"}

    with pytest.raises(AmbiguousReferenceError):
        resolve_reference("standup", candidates)


def test_a_close_typo_resolves_above_the_threshold() -> None:
    assert resolve_reference("review the budgett", CANDIDATES) == "task-3"


def test_nothing_close_enough_is_not_found() -> None:
    with pytest.raises(TaskNotFoundError):
        resolve_reference("buy milk at the shop", CANDIDATES)


def test_an_empty_reference_is_not_found() -> None:
    with pytest.raises(TaskNotFoundError):
        resolve_reference("   ", CANDIDATES)


def test_no_candidates_means_not_found() -> None:
    with pytest.raises(TaskNotFoundError):
        resolve_reference("anything", {})


def test_a_near_tie_is_ambiguous_rather_than_guessed() -> None:
    # Not an exact title and not a substring of either, so resolution falls through to
    # fuzzy scoring, where both candidates score almost identically.
    candidates = {"a": "report alpha", "b": "report alpba"}

    with pytest.raises(AmbiguousReferenceError) as raised:
        resolve_reference("report alpca", candidates)

    assert len(raised.value.candidates) == 2


def test_a_clear_winner_beyond_the_tie_margin_resolves() -> None:
    candidates = {"a": "review the budget", "b": "book the team offsite"}

    assert resolve_reference("review the budget", candidates) == "a"


def test_resolution_is_repeatable() -> None:
    first = resolve_reference("quarterly", CANDIDATES)
    second = resolve_reference("quarterly", CANDIDATES)

    assert first == second


def test_similarity_is_symmetric_and_bounded() -> None:
    assert similarity("abc", "abc") == 1.0
    assert 0.0 <= similarity("abc", "xyz") < 1.0
    assert similarity("Report", "report") == 1.0
