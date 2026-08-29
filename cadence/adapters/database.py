from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    """Declarative base shared by persisted Cadence models."""


def build_engine(database_url: str) -> Engine:
    if database_url.startswith("sqlite"):
        # An in-memory database lives in its connection, so every session must share one.
        # Without StaticPool each session would see an empty, separate database.
        if ":memory:" in database_url:
            return create_engine(
                database_url,
                connect_args={"check_same_thread": False},
                poolclass=StaticPool,
            )
        return create_engine(database_url, connect_args={"check_same_thread": False})
    return create_engine(database_url)


def build_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False)
