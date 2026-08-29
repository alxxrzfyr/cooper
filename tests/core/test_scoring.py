import datetime as dt

import pytest

from cadence.core.errors import DomainValidationError
from cadence.core.scoring import DEFAULT_WEIGHTS, ScoreWeights, score_task
from cadence.core.tasks import Task, TaskDraft

UTC = dt.UTC
NOW = dt.datetime(2026, 8, 29, 9, 0, tzinfo=UTC)
TODAY = NOW.date()


def task(**fields: object) -> Task:
    draft_fields = {
        key: fields.pop(key)
        for key in ("title", "importance", "deadline", "effort_minutes")
        if key in fields
    }
    draft_fields.setdefault("title", "task")
    created_at = fields.pop("created_at", NOW)
    return Task(
        id=str(fields.pop("id", "task-1")),
        draft=TaskDraft(**draft_fields),  # type: ignore[arg-type]
        created_at=created_at,  # type: ignore[arg-type]
        **fields,  # type: ignore[arg-type]
    )


def test_weights_must_sum_to_one() -> None:
    with pytest.raises(DomainValidationError, match="sum"):
        ScoreWeights(deadline=0.9, importance=0.9, slip=0.1, unblocks=0.1, age=0.1)


def test_default_weights_match_the_specification() -> None:
    assert (
        DEFAULT_WEIGHTS.deadline,
        DEFAULT_WEIGHTS.importance,
        DEFAULT_WEIGHTS.slip,
        DEFAULT_WEIGHTS.unblocks,
        DEFAULT_WEIGHTS.age,
    ) == (0.35, 0.25, 0.15, 0.15, 0.10)


def test_a_task_with_no_deadline_has_no_deadline_pressure() -> None:
    assert score_task(task(), now=NOW).deadline_pressure == 0.0


@pytest.mark.parametrize("offset_days", [0, -1, -30])
def test_overdue_or_due_today_saturates_deadline_pressure(offset_days: int) -> None:
    deadline = TODAY + dt.timedelta(days=offset_days)

    assert score_task(task(deadline=deadline), now=NOW).deadline_pressure == 1.0


def test_deadline_pressure_ramps_towards_the_deadline() -> None:
    near = score_task(task(deadline=TODAY + dt.timedelta(days=2)), now=NOW).deadline_pressure
    far = score_task(task(deadline=TODAY + dt.timedelta(days=10)), now=NOW).deadline_pressure

    assert 0.0 < far < near < 1.0


def test_a_deadline_beyond_the_horizon_has_no_pressure() -> None:
    beyond = TODAY + dt.timedelta(days=DEFAULT_WEIGHTS.horizon_days + 5)

    assert score_task(task(deadline=beyond), now=NOW).deadline_pressure == 0.0


@pytest.mark.parametrize(
    ("importance", "expected"),
    [(1, 0.0), (2, 0.25), (3, 0.5), (4, 0.75), (5, 1.0)],
)
def test_importance_is_normalised_across_its_whole_range(importance: int, expected: float) -> None:
    assert score_task(task(importance=importance), now=NOW).importance == expected


@pytest.mark.parametrize(("slips", "expected"), [(0, 0.0), (1, 1 / 3), (3, 1.0), (9, 1.0)])
def test_slip_pressure_saturates_at_three(slips: int, expected: float) -> None:
    assert score_task(task(slip_count=slips), now=NOW).slip_pressure == pytest.approx(expected)


@pytest.mark.parametrize(("dependents", "expected"), [(0, 0.0), (1, 1 / 3), (3, 1.0), (7, 1.0)])
def test_unblocks_saturates_at_three(dependents: int, expected: float) -> None:
    breakdown = score_task(task(), now=NOW, unblocked_dependents=dependents)

    assert breakdown.unblocks == pytest.approx(expected)


@pytest.mark.parametrize(("age_days", "expected"), [(0, 0.0), (15, 0.5), (30, 1.0), (90, 1.0)])
def test_age_saturates_at_thirty_days(age_days: int, expected: float) -> None:
    created = NOW - dt.timedelta(days=age_days)

    assert score_task(task(created_at=created), now=NOW).age == pytest.approx(expected)


def test_total_is_the_exact_weighted_sum() -> None:
    breakdown = score_task(
        task(importance=5, deadline=TODAY, created_at=NOW - dt.timedelta(days=30), slip_count=3),
        now=NOW,
        unblocked_dependents=3,
    )

    assert breakdown.total == pytest.approx(1.0)


def test_a_brand_new_unimportant_task_scores_zero() -> None:
    breakdown = score_task(task(importance=1), now=NOW)

    assert breakdown.total == pytest.approx(0.0)


def test_raising_importance_never_lowers_the_score() -> None:
    lower = score_task(task(importance=2), now=NOW).total
    higher = score_task(task(importance=4), now=NOW).total

    assert higher > lower


def test_an_overdue_task_outranks_an_identical_task_due_next_week() -> None:
    overdue = score_task(task(deadline=TODAY - dt.timedelta(days=1)), now=NOW).total
    later = score_task(task(deadline=TODAY + dt.timedelta(days=7)), now=NOW).total

    assert overdue > later


def test_a_repeatedly_slipped_task_outranks_an_identical_never_slipped_task() -> None:
    slipped = score_task(task(slip_count=3), now=NOW).total
    fresh = score_task(task(slip_count=0), now=NOW).total

    assert slipped > fresh


def test_effort_does_not_influence_the_score() -> None:
    small = score_task(task(effort_minutes=15), now=NOW).total
    large = score_task(task(effort_minutes=480), now=NOW).total

    assert small == large


def test_breakdown_reports_every_term_for_display() -> None:
    breakdown = score_task(task(importance=4), now=NOW)

    assert set(breakdown.contributions()) == {
        "deadline_pressure",
        "importance",
        "slip_pressure",
        "unblocks",
        "age",
    }
    assert breakdown.contributions()["importance"] == pytest.approx(0.75 * 0.25)
