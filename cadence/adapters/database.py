"""Database engine and session factory.

Configures SQLite for the one concurrency situation this app genuinely has: the request path
and the background job loop both writing to a single file. Without WAL and a busy timeout, a
job tick that coincides with a request fails with "database is locked", which showed up in
practice as a spurious job error at startup.
"""

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

# How long a writer waits for a competing write before giving up.
BUSY_TIMEOUT_SECONDS = 30


class Base(DeclarativeBase):
    """Declarative base shared by persisted Cadence models."""


def _configure_sqlite(engine: Engine, *, in_memory: bool) -> None:
    """Apply pragmas on every new connection.

    WAL lets one writer and many readers proceed together, which is exactly the request path
    against the job loop. It is not available for an in-memory database, so that case keeps the
    default journal and relies on the shared connection instead.
    """

    @event.listens_for(engine, "connect")
    def set_pragmas(connection: object, _record: object) -> None:
        cursor = connection.cursor()  # type: ignore[attr-defined]
        try:
            if not in_memory:
                cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.execute(f"PRAGMA busy_timeout={BUSY_TIMEOUT_SECONDS * 1000}")
        finally:
            cursor.close()


def build_engine(database_url: str) -> Engine:
    if not database_url.startswith("sqlite"):
        return create_engine(database_url)

    in_memory = ":memory:" in database_url
    if in_memory:
        # An in-memory database lives in its connection, so every session must share one.
        # Without StaticPool each session would see an empty, separate database.
        engine = create_engine(
            database_url,
            connect_args={"check_same_thread": False, "timeout": BUSY_TIMEOUT_SECONDS},
            poolclass=StaticPool,
        )
    else:
        engine = create_engine(
            database_url,
            connect_args={"check_same_thread": False, "timeout": BUSY_TIMEOUT_SECONDS},
        )
    _configure_sqlite(engine, in_memory=in_memory)
    return engine


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)
