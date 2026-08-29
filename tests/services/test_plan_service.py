import datetime as dt

from cadence.core.tasks import TaskDraft
from cadence.services.plan_service import PlanService
from cadence.services.task_service import TaskService
from tests.fakes import ExplodingProvider, FakeClock, InMemoryTaskRepository, SequentialIds

UTC = dt.UTC
NOW = dt.datetime(2026, 8, 29, 9, 0, tzinfo=UTC)
TODAY = NOW.date()


def build() -> tuple[PlanService, TaskService, InMemoryTaskRepository]:
    repository = InMemoryTaskRepository()
    clock = FakeClock(NOW)
    tasks = TaskService(repository=repository, clock=clock, new_id=SequentialIds("task"))
    plan = PlanService(repository=repository, clock=clock)
    return plan, tasks, repository


def test_shortlist_is_ranked_and_limited() -> None:
    plan, tasks, _ = build()
    tasks.create(TaskDraft(title="ordinary", importance=2))
    tasks.create(TaskDraft(title="urgent", importance=5, deadline=TODAY))
    tasks.create(TaskDraft(title="middling", importance=3))

    shortlist = plan.today(limit=2)

    assert [entry.title for entry in shortlist] == ["urgent", "middling"]
    assert [entry.rank for entry in shortlist] == [1, 2]


def test_ranking_makes_no_model_calls() -> None:
    # ExplodingProvider raises if touched. PlanService never receives it, and this test
    # documents that the Phase 2 path has no seam where a model could be introduced.
    plan, tasks, _ = build()
    tasks.create(TaskDraft(title="a task", importance=4))
    provider = ExplodingProvider()

    shortlist = plan.today()

    assert len(shortlist) == 1
    assert provider.name == "exploding"


def test_completed_tasks_leave_the_plan() -> None:
    plan, tasks, _ = build()
    tasks.create(TaskDraft(title="first"))
    tasks.create(TaskDraft(title="second"))

    tasks.complete("task-1")

    assert [entry.title for entry in plan.backlog()] == ["second"]


def test_blocked_tasks_are_reported_separately_and_never_ranked() -> None:
    plan, tasks, _ = build()
    tasks.create(TaskDraft(title="api access"))
    tasks.create(TaskDraft(title="data export"))
    tasks.add_dependency(blocker_id="task-1", blocked_id="task-2")

    assert [entry.title for entry in plan.backlog()] == ["api access"]
    assert [task.title for task in plan.blocked()] == ["data export"]


def test_completing_a_blocker_releases_the_blocked_task() -> None:
    plan, tasks, _ = build()
    tasks.create(TaskDraft(title="api access"))
    tasks.create(TaskDraft(title="data export"))
    tasks.add_dependency(blocker_id="task-1", blocked_id="task-2")

    tasks.complete("task-1")

    assert [entry.title for entry in plan.backlog()] == ["data export"]
    assert plan.blocked() == ()


def test_a_blocker_outranks_an_otherwise_identical_task() -> None:
    plan, tasks, _ = build()
    tasks.create(TaskDraft(title="blocker", importance=3))
    tasks.create(TaskDraft(title="dependent", importance=3))
    tasks.create(TaskDraft(title="unrelated", importance=3))
    tasks.add_dependency(blocker_id="task-1", blocked_id="task-2")

    assert [entry.title for entry in plan.backlog()] == ["blocker", "unrelated"]


def test_pinning_puts_a_task_first_regardless_of_score() -> None:
    plan, tasks, _ = build()
    tasks.create(TaskDraft(title="urgent", importance=5, deadline=TODAY))
    tasks.create(TaskDraft(title="trivial", importance=1))
    tasks.pin("task-2", for_date=TODAY)

    shortlist = plan.today()

    assert [entry.title for entry in shortlist] == ["trivial", "urgent"]
    assert shortlist[0].is_pinned is True


def test_plan_bundles_shortlist_backlog_and_blocked() -> None:
    plan, tasks, _ = build()
    for index in range(7):
        tasks.create(TaskDraft(title=f"task {index}", importance=3))

    result = plan.plan(limit=5)

    assert result.generated_at == NOW
    assert len(result.shortlist) == 5
    assert len(result.backlog) == 7
    assert result.blocked == ()
    assert result.degraded is False


def test_an_empty_database_produces_an_empty_plan() -> None:
    plan, _, _ = build()

    result = plan.plan()

    assert result.shortlist == ()
    assert result.backlog == ()
    assert result.blocked == ()
