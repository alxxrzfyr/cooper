"""Everything Cadence stores.

Three tables. An item is a task or an event; the difference is whether the time is fixed.
Settings hold your working hours and Google tokens. Changes exist only so the last action can
be undone.

Deliberately no separate blocks table: a task with a start time *is* scheduled. Splitting
those apart was the first thing that made the old version complicated.
"""

from __future__ import annotations

import datetime as dt
import json
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, Literal

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Integer,
    String,
    Text,
    create_engine,
    select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.types import TypeDecorator

Kind = Literal["task", "event"]
Status = Literal["open", "done", "dropped"]

KINDS = ("task", "event")
STATUSES = ("open", "done", "dropped")


class Base(DeclarativeBase):
    pass


class Utc(TypeDecorator[dt.datetime]):
    """A datetime column that is always UTC, in the database and out.

    SQLite has no timezone-aware type: it stores whatever string it is handed and returns a
    naive value. Storing a local time and then assuming UTC on the way out shifts every
    instant by the offset, which showed up as a 3pm appointment displaying at 11pm.

    Converting here rather than at each call site means no future query can forget.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value: dt.datetime | None, dialect: object) -> dt.datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            # A naive value can only sensibly mean UTC; nothing else is knowable here.
            return value
        return value.astimezone(dt.UTC).replace(tzinfo=None)

    def process_result_value(
        self, value: dt.datetime | None, dialect: object
    ) -> dt.datetime | None:
        if value is None:
            return None
        return value if value.tzinfo else value.replace(tzinfo=dt.UTC)


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now() -> dt.datetime:
    return dt.datetime.now(tz=dt.UTC)


class Item(Base):
    """A task or an event. One table, because they differ only in whether time is fixed."""

    __tablename__ = "item"
    __table_args__ = (
        CheckConstraint("kind IN ('task', 'event')", name="ck_item_kind"),
        CheckConstraint("status IN ('open', 'done', 'dropped')", name="ck_item_status"),
        CheckConstraint("importance BETWEEN 1 AND 5", name="ck_item_importance"),
    )

    id: Mapped[str] = mapped_column(String(12), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(8), default="task")
    title: Mapped[str] = mapped_column(String(300))
    notes: Mapped[str | None] = mapped_column(Text, default=None)

    minutes: Mapped[int | None] = mapped_column(Integer, default=None)
    importance: Mapped[int] = mapped_column(Integer, default=3)
    due: Mapped[dt.datetime | None] = mapped_column(Utc, default=None)

    # Set once scheduled, or from the start for a fixed event.
    start_at: Mapped[dt.datetime | None] = mapped_column(Utc, default=None)
    end_at: Mapped[dt.datetime | None] = mapped_column(Utc, default=None)
    google_event_id: Mapped[str | None] = mapped_column(String(255), default=None)

    status: Mapped[str] = mapped_column(String(8), default="open")
    pinned: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(Utc, default=now)
    done_at: Mapped[dt.datetime | None] = mapped_column(Utc, default=None)

    @property
    def scheduled(self) -> bool:
        return self.start_at is not None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "title": self.title,
            "notes": self.notes,
            "minutes": self.minutes,
            "importance": self.importance,
            "due": _iso(self.due),
            "start_at": _iso(self.start_at),
            "end_at": _iso(self.end_at),
            "google_event_id": self.google_event_id,
            "status": self.status,
            "pinned": bool(self.pinned),
            "created_at": _iso(self.created_at),
        }


class Setting(Base):
    """Key/value settings, including the encrypted Google refresh token."""

    __tablename__ = "setting"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Change(Base):
    """Just enough history to undo the last thing. Not an audit log."""

    __tablename__ = "change"

    id: Mapped[str] = mapped_column(String(12), primary_key=True, default=new_id)
    at: Mapped[dt.datetime] = mapped_column(Utc, default=now)
    label: Mapped[str] = mapped_column(String(120))
    item_id: Mapped[str | None] = mapped_column(String(12), default=None)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    undone: Mapped[int] = mapped_column(Integer, default=0)


def _iso(value: dt.datetime | None) -> str | None:
    if value is None:
        return None
    aware = value if value.tzinfo else value.replace(tzinfo=dt.UTC)
    return aware.isoformat()


def aware(value: dt.datetime | None) -> dt.datetime | None:
    """SQLite forgets timezones, so re-tag on the way out."""
    if value is None:
        return None
    return value if value.tzinfo else value.replace(tzinfo=dt.UTC)


class Store:
    """Owns the database. Creates its own schema, so there is no migration tool to run."""

    def __init__(self, url: str) -> None:
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine = create_engine(url, connect_args=connect_args)
        Base.metadata.create_all(self.engine)
        self._factory = sessionmaker(bind=self.engine, expire_on_commit=False)

    @contextmanager
    def session(self) -> Iterator[Session]:
        session = self._factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ---------------------------------------------------------------- settings

    def get_setting(self, key: str, default: Any = None) -> Any:
        with self.session() as session:
            row = session.get(Setting, key)
            return default if row is None else row.value

    def set_setting(self, key: str, value: Any) -> None:
        with self.session() as session:
            row = session.get(Setting, key)
            if row is None:
                session.add(Setting(key=key, value=value))
            else:
                row.value = value

    # ------------------------------------------------------------------ items

    def open_items(self, session: Session) -> list[Item]:
        statement = select(Item).where(Item.status == "open").order_by(Item.created_at, Item.id)
        return list(session.scalars(statement))

    def record(
        self,
        session: Session,
        *,
        label: str,
        item: Item | None,
        before: dict[str, Any] | None,
    ) -> None:
        """Remember one change so it can be undone. Older entries are pruned."""
        session.add(
            Change(
                id=new_id(),
                at=now(),
                label=label,
                item_id=item.id if item else None,
                before=before,
            )
        )
        session.flush()
        keep = [
            row.id
            for row in session.scalars(
                select(Change).order_by(Change.at.desc(), Change.id.desc()).limit(20)
            )
        ]
        for row in session.scalars(select(Change)):
            if row.id not in keep:
                session.delete(row)

    def last_change(self, session: Session) -> Change | None:
        statement = (
            select(Change)
            .where(Change.undone == 0)
            .order_by(Change.at.desc(), Change.id.desc())
            .limit(1)
        )
        return session.scalars(statement).first()


def dumps(value: Any) -> str:
    return json.dumps(value, default=str)
