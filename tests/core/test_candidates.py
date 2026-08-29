import datetime as dt

from cadence.core.candidates import count_dependents, rank_tasks, select_candidates
from cadence.core.tasks import Task, TaskDraft

UTC = dt.UTC
NOW = dt.datetime(2026, 8, 29, 9, 0, tzinfo=UTC)
TODAY = NOW.date()


def task(task_id: str, *, created_offset_days: int = 0, **fields: object) -> Task:
    draft_keys = ("title", "importance", "deadline", "earliest_start", "effort_minutes")
    draft_fields = {key: fields.pop(key) for key in draft_keys if key in fields}
    draft_fields.setdefault("title", task_id)
    return Task(
        id=task_id,
        draft=TaskDraft(**draft_fields),  # type: ignore[arg-type]
        created_at=NOW - dt.timedelta(days=created_offset_days),
        **fields,  # type: ignore[arg-type]
    )


def test_closed_tasks_are_not_candidates() -> None:
    tasks = [task("a"), task("b", status="done"), task("c", status="dropped")]

    assert [t.id for t in select_candidates(tasks, now=NOW)] == ["a"]


def test_blocked_tasks_are_excluded_entirely_not_merely_ranked_low() -> None:
    tasks = [task("a"), task("blocked")]

    ranked = rank_tasks(tasks, now=NOW, blocked_ids=frozenset({"blocked"}))

    assert [entry.id for entry in ranked] == ["a"]


def test_a_task_that_cannot_start_within_the_horizon_is_excluded() -> None:
    far_future = NOW + dt.timedelta(days=90)
    tasks = [task("a"), task("later", earliest_start=far_future)]

    assert [t.id for t in select_candidates(tasks, now=NOW)] == ["a"]


def test_a_task_startable_inside_the_horizon_is_included() -> None:
    soon = NOW + dt.timedelta(days=2)

    assert [t.id for t in select_candidates([task("a", earliest_start=soon)], now=NOW)] == ["a"]


def test_ranking_orders_by_score_descending() -> None:
    urgent = task("urgent", deadline=TODAY, importance=5)
    ordinary = task("ordinary", importance=2)

    ranked = rank_tasks([ordinary, urgent], now=NOW)

    assert [entry.id for entry in ranked] == ["urgent", "ordinary"]
    assert [entry.rank for entry in ranked] == [1, 2]


def test_a_task_pinned_for_today_bypasses_scoring() -> None:
    urgent = task("urgent", deadline=TODAY, importance=5)
    pinned = task("pinned", importance=1, pinned_for_date=TODAY)

    ranked = rank_tasks([urgent, pinned], now=NOW)

    assert [entry.id for entry in ranked] == ["pinned", "urgent"]
    assert ranked[0].is_pinned is True
    assert ranked[1].is_pinned is False


def test_a_task_pinned_for_another_day_does_not_jump_the_queue() -> None:
    urgent = task("urgent", deadline=TODAY, importance=5)
    pinned_tomorrow = task("tomorrow", importance=1, pinned_for_date=TODAY + dt.timedelta(days=1))

    ranked = rank_tasks([urgent, pinned_tomorrow], now=NOW)

    assert [entry.id for entry in ranked] == ["urgent", "tomorrow"]


def test_ties_break_deterministically_by_creation_then_id() -> None:
    older = task("z-older", created_offset_days=2)
    newer_a = task("a-newer")
    newer_b = task("b-newer")

    ranked = rank_tasks([newer_b, newer_a, older], now=NOW)

    # The older task has more age pressure, so it leads; the two identical newer tasks
    # fall back to id order.
    assert [entry.id for entry in ranked] == ["z-older", "a-newer", "b-newer"]


def test_ranking_is_stable_across_repeated_calls() -> None:
    tasks = [task("a", importance=3), task("b", importance=3), task("c", importance=3)]

    first = [entry.id for entry in rank_tasks(tasks, now=NOW)]
    second = [entry.id for entry in rank_tasks(tasks, now=NOW)]

    assert first == second


def test_unblocking_more_tasks_raises_a_score() -> None:
    blocker = task("blocker")

    alone = rank_tasks([blocker], now=NOW)[0].breakdown.total
    unblocking = rank_tasks([blocker], now=NOW, dependents={"blocker": 3})[0].breakdown.total

    assert unblocking > alone


def test_count_dependents_counts_edges_per_blocker() -> None:
    edges = [("api", "export"), ("api", "report"), ("hr", "onboard")]

    assert count_dependents(edges) == {"api": 2, "hr": 1}


def test_ranking_exposes_the_breakdown_for_display() -> None:
    ranked = rank_tasks([task("a", importance=4)], now=NOW)

    assert ranked[0].breakdown.contributions()["importance"] > 0
    assert ranked[0].title == "a"
