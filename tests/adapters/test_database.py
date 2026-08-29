import datetime as dt
from pathlib import Path

from sqlalchemy import text

from cadence.adapters.database import (
    BUSY_TIMEOUT_SECONDS,
    Base,
    build_engine,
    build_session_factory,
)
from cadence.adapters.task_repository import SqlAlchemyTaskRepository
from cadence.core.tasks import Task, TaskDraft

UTC = dt.UTC


def test_a_file_database_uses_write_ahead_logging(tmp_path: Path) -> None:
    # WAL is what lets the request path and the job loop write without colliding. Without it
    # a job tick coinciding with a request fails as "database is locked".
    engine = build_engine(f"sqlite:///{tmp_path / 'wal.db'}")

    with engine.connect() as connection:
        mode = connection.execute(text("PRAGMA journal_mode")).scalar_one()

    assert str(mode).lower() == "wal"


def test_a_busy_timeout_is_configured(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'busy.db'}")

    with engine.connect() as connection:
        timeout = connection.execute(text("PRAGMA busy_timeout")).scalar_one()

    assert int(timeout) == BUSY_TIMEOUT_SECONDS * 1000


def test_foreign_keys_are_enforced(tmp_path: Path) -> None:
    engine = build_engine(f"sqlite:///{tmp_path / 'fk.db'}")

    with engine.connect() as connection:
        assert int(connection.execute(text("PRAGMA foreign_keys")).scalar_one()) == 1


def test_two_sessions_can_write_to_the_same_file(tmp_path: Path) -> None:
    """The situation that actually failed: concurrent writers on one file."""
    engine = build_engine(f"sqlite:///{tmp_path / 'concurrent.db'}")
    Base.metadata.create_all(engine)
    factory = build_session_factory(engine)

    created = dt.datetime(2026, 8, 29, 9, 0, tzinfo=UTC)

    first = factory()
    second = factory()
    try:
        SqlAlchemyTaskRepository(first).add(
            Task(id="task-a", draft=TaskDraft(title="from first"), created_at=created)
        )
        first.commit()

        SqlAlchemyTaskRepository(second).add(
            Task(id="task-b", draft=TaskDraft(title="from second"), created_at=created)
        )
        second.commit()
    finally:
        first.close()
        second.close()

    with factory() as reader:
        assert len(SqlAlchemyTaskRepository(reader).list()) == 2


def test_an_in_memory_database_is_shared_across_sessions() -> None:
    engine = build_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = build_session_factory(engine)
    created = dt.datetime(2026, 8, 29, 9, 0, tzinfo=UTC)

    with factory() as writer:
        SqlAlchemyTaskRepository(writer).add(
            Task(id="task-1", draft=TaskDraft(title="shared"), created_at=created)
        )
        writer.commit()

    with factory() as reader:
        assert len(SqlAlchemyTaskRepository(reader).list()) == 1
