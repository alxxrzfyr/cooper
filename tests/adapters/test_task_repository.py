import datetime as dt

import pytest
from sqlalchemy.orm import Session

from cadence.adapters.database import Base, build_engine, build_session_factory
from cadence.adapters.task_repository import SqlAlchemyTaskRepository
from cadence.core.tasks import Task, TaskDraft

UTC = dt.UTC
CREATED = dt.datetime(2026, 8, 29, 9, 0, tzinfo=UTC)


@pytest.fixture
def session() -> Session:
    engine = build_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with build_session_factory(engine)() as open_session:
        yield open_session


def make_task(task_id: str = "task-1", **draft_fields: object) -> Task:
    defaults: dict[str, object] = {"title": "write the report"}
    return Task(id=task_id, draft=TaskDraft(**(defaults | draft_fields)), created_at=CREATED)  # type: ignore[arg-type]


def test_round_trip_preserves_every_domain_field(session: Session) -> None:
    repository = SqlAlchemyTaskRepository(session)
    task = make_task(
        notes="  with notes  ",
        effort_minutes=180,
        importance=5,
        deadline=dt.date(2026, 9, 4),
        earliest_start=dt.datetime(2026, 8, 30, 8, 0, tzinfo=UTC),
        tags=("Work", "work", "focus"),
        allow_split=True,
    )

    repository.add(task)

    assert repository.get("task-1") == task


def test_round_trip_returns_timezone_aware_instants(session: Session) -> None:
    # SQLite stores no offset, so a naive value coming back would break domain validation.
    repository = SqlAlchemyTaskRepository(session)
    repository.add(make_task(earliest_start=dt.datetime(2026, 8, 30, 8, 0, tzinfo=UTC)))

    stored = repository.get("task-1")

    assert stored is not None
    assert stored.created_at.tzinfo is not None
    assert stored.draft.earliest_start is not None
    assert stored.draft.earliest_start.tzinfo is not None


def test_get_returns_none_for_a_missing_task(session: Session) -> None:
    assert SqlAlchemyTaskRepository(session).get("absent") is None


def test_update_persists_a_state_transition(session: Session) -> None:
    repository = SqlAlchemyTaskRepository(session)
    repository.add(make_task())

    finished = dt.datetime(2026, 8, 29, 17, 0, tzinfo=UTC)
    repository.update(make_task().completed(at=finished))

    stored = repository.get("task-1")
    assert stored is not None
    assert stored.status == "done"
    assert stored.completed_at == finished


def test_update_of_a_missing_task_raises(session: Session) -> None:
    with pytest.raises(KeyError):
        SqlAlchemyTaskRepository(session).update(make_task("absent"))


def test_list_filters_by_status_and_orders_by_creation_then_id(session: Session) -> None:
    repository = SqlAlchemyTaskRepository(session)
    repository.add(make_task("task-b", title="second"))
    repository.add(make_task("task-a", title="first"))
    repository.update(make_task("task-a", title="first").dropped())

    assert [task.id for task in repository.list()] == ["task-a", "task-b"]
    assert [task.id for task in repository.list(statuses=("active",))] == ["task-b"]


def test_blocked_ids_reflect_only_incomplete_blockers(session: Session) -> None:
    repository = SqlAlchemyTaskRepository(session)
    repository.add(make_task("blocker", title="api access"))
    repository.add(make_task("blocked", title="data export"))
    repository.add_dependency(blocker_id="blocker", blocked_id="blocked")

    assert repository.blocked_task_ids() == frozenset({"blocked"})

    repository.update(make_task("blocker", title="api access").completed(at=CREATED))

    assert repository.blocked_task_ids() == frozenset()


def test_invalid_status_is_refused_by_the_database(session: Session) -> None:
    # Proves the CHECK constraint is real, not only a domain-level convention.
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    SqlAlchemyTaskRepository(session).add(make_task())

    with pytest.raises(IntegrityError):
        session.execute(text("UPDATE task SET status = 'nonsense' WHERE id = 'task-1'"))
