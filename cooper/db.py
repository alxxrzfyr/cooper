"""Everything Cooper stores.

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
from contextvars import ContextVar
from typing import Any, Literal

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    create_engine,
    inspect,
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
            # SQLite may return a naive value. Treat it as UTC.
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
        Index("ix_item_owner_id", "owner_id"),
    )

    id: Mapped[str] = mapped_column(String(12), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(String(128), nullable=False, default="local")
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="me")
    source_ref: Mapped[str | None] = mapped_column(String(255), default=None)
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

    # Validate categories in brain.py so existing databases remain compatible.
    category: Mapped[str] = mapped_column(String(16), default="personal")

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
            "owner_id": self.owner_id,
            "source": self.source,
            "source_ref": self.source_ref,
            "kind": self.kind,
            "title": self.title,
            "notes": self.notes,
            "minutes": self.minutes,
            "importance": self.importance,
            "category": self.category,
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
    __table_args__ = (Index("ix_setting_owner_id", "owner_id"),)

    owner_id: Mapped[str] = mapped_column(String(128), primary_key=True, default="local")
    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)


class Change(Base):
    """Just enough history to undo the last thing. Not an audit log."""

    __tablename__ = "change"
    __table_args__ = (Index("ix_change_owner_id", "owner_id"),)

    id: Mapped[str] = mapped_column(String(12), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(String(128), nullable=False, default="local")
    at: Mapped[dt.datetime] = mapped_column(Utc, default=now)
    label: Mapped[str] = mapped_column(String(120))
    item_id: Mapped[str | None] = mapped_column(String(12), default=None)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    undone: Mapped[int] = mapped_column(Integer, default=0)


class AiAllowance(Base):
    """An operator-provisioned owner's allowance for one UTC calendar month."""

    __tablename__ = "ai_allowance"
    __table_args__ = (
        CheckConstraint("tier IN ('free', 'pilot_plus')", name="ck_ai_allowance_tier"),
        CheckConstraint(
            "limit_units >= 0 AND reserved_units >= 0 AND consumed_units >= 0 "
            "AND reserved_units + consumed_units <= limit_units",
            name="ck_ai_allowance_counts",
        ),
    )
    owner_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    period: Mapped[str] = mapped_column(String(7), primary_key=True)
    tier: Mapped[str] = mapped_column(String(16), default="free")
    limit_units: Mapped[int] = mapped_column(Integer)
    reserved_units: Mapped[int] = mapped_column(Integer, default=0)
    consumed_units: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(Utc, default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(Utc, default=now, onupdate=now)


class AiSpendEnvelope(Base):
    """Service-owned, explicitly funded aggregate or provider spending envelope."""

    __tablename__ = "ai_spend_envelope"
    __table_args__ = (
        CheckConstraint("scope IN ('aggregate', 'gemini', 'groq')", name="ck_ai_envelope_scope"),
        CheckConstraint(
            "limit_microusd >= 0 AND reserved_microusd >= 0 AND spent_microusd >= 0 "
            "AND reserved_microusd + spent_microusd <= limit_microusd",
            name="ck_ai_envelope_counts",
        ),
    )
    owner_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    period: Mapped[str] = mapped_column(String(7), primary_key=True)
    scope: Mapped[str] = mapped_column(String(16), primary_key=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    limit_microusd: Mapped[int] = mapped_column(BigInteger)
    reserved_microusd: Mapped[int] = mapped_column(BigInteger, default=0)
    spent_microusd: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(Utc, default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(Utc, default=now, onupdate=now)


class AiRequest(Base):
    """One owner-scoped logical request and its replayable final receipt."""

    __tablename__ = "ai_request"
    __table_args__ = (
        UniqueConstraint("owner_id", "logical_request_id", name="uq_ai_request_logical"),
        UniqueConstraint("id", "owner_id", name="uq_ai_request_owner"),
        ForeignKeyConstraint(
            ["owner_id", "period"], ["ai_allowance.owner_id", "ai_allowance.period"]
        ),
        CheckConstraint(
            "state IN ('admitted', 'running', 'applying', 'completed', 'failed', 'uncertain')",
            name="ck_ai_request_state",
        ),
        CheckConstraint(
            "allowance_state IN ('reserved', 'consumed', 'released')",
            name="ck_ai_request_allowance",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(128), nullable=False)
    logical_request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    payload_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    period: Mapped[str] = mapped_column(String(7), nullable=False)
    state: Mapped[str] = mapped_column(String(16), default="admitted")
    allowance_state: Mapped[str] = mapped_column(String(16), default="reserved")
    response: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    created_at: Mapped[dt.datetime] = mapped_column(Utc, default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(Utc, default=now, onupdate=now)


class AiAttempt(Base):
    """A single provider dispatch with conservative cost reservation."""

    __tablename__ = "ai_attempt"
    __table_args__ = (
        UniqueConstraint("request_id", "attempt_no", name="uq_ai_attempt_number"),
        ForeignKeyConstraint(["request_id", "owner_id"], ["ai_request.id", "ai_request.owner_id"]),
        CheckConstraint("attempt_no BETWEEN 1 AND 4", name="ck_ai_attempt_number"),
        CheckConstraint("provider IN ('gemini', 'groq')", name="ck_ai_attempt_provider"),
        CheckConstraint(
            "state IN ('reserved', 'dispatching', 'settled', 'uncertain', 'released')",
            name="ck_ai_attempt_state",
        ),
        CheckConstraint(
            "reserved_microusd >= 0 AND (actual_microusd IS NULL OR actual_microusd >= 0) "
            "AND (input_tokens IS NULL OR input_tokens >= 0) "
            "AND (output_tokens IS NULL OR output_tokens >= 0)",
            name="ck_ai_attempt_usage",
        ),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_id: Mapped[str] = mapped_column(String(128), nullable=False)
    request_id: Mapped[str] = mapped_column(String(36), nullable=False)
    attempt_no: Mapped[int] = mapped_column(Integer)
    provider: Mapped[str] = mapped_column(String(16))
    model: Mapped[str] = mapped_column(String(128))
    price_revision: Mapped[str] = mapped_column(String(64))
    input_rate_microusd: Mapped[int] = mapped_column(BigInteger)
    output_rate_microusd: Mapped[int] = mapped_column(BigInteger)
    state: Mapped[str] = mapped_column(String(16), default="reserved")
    reserved_microusd: Mapped[int] = mapped_column(BigInteger)
    actual_microusd: Mapped[int | None] = mapped_column(BigInteger, default=None)
    input_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    output_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[dt.datetime] = mapped_column(Utc, default=now)
    updated_at: Mapped[dt.datetime] = mapped_column(Utc, default=now, onupdate=now)


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
    """Owns database sessions and creates the latest schema for new local databases."""

    def __init__(self, url: str) -> None:
        connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
        self.engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)
        existing = set(inspect(self.engine).get_table_names())
        if not (existing - {"alembic_version"}):
            Base.metadata.create_all(self.engine)
        tables = set(inspect(self.engine).get_table_names())
        self.ai_schema_available = {
            "ai_allowance",
            "ai_spend_envelope",
            "ai_request",
            "ai_attempt",
        } <= tables
        self._factory = sessionmaker(bind=self.engine, expire_on_commit=False)
        self._joined: ContextVar[Session | None] = ContextVar("cooper_writer_session", default=None)

    @contextmanager
    def session(self) -> Iterator[Session]:
        joined = self._joined.get()
        if joined is not None:
            yield joined
            return
        session = self._factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    @contextmanager
    def join(self, session: Session) -> Iterator[None]:
        """Join existing writer helpers to one request-local atomic transaction."""
        token = self._joined.set(session)
        try:
            yield
        finally:
            self._joined.reset(token)

    def get_setting(self, owner_id: str, key: str, default: Any = None) -> Any:
        with self.session() as session:
            row = session.get(Setting, {"owner_id": owner_id, "key": key})
            return default if row is None else row.value

    def set_setting(self, owner_id: str, key: str, value: Any) -> None:
        with self.session() as session:
            row = session.get(Setting, {"owner_id": owner_id, "key": key})
            if row is None:
                session.add(Setting(owner_id=owner_id, key=key, value=value))
            else:
                row.value = value

    def open_items(self, session: Session, owner_id: str) -> list[Item]:
        statement = (
            select(Item)
            .where(Item.owner_id == owner_id, Item.status == "open")
            .order_by(Item.created_at, Item.id)
        )
        return list(session.scalars(statement))

    def get_item(self, session: Session, owner_id: str, item_id: str) -> Item | None:
        statement = select(Item).where(Item.owner_id == owner_id, Item.id == item_id).limit(1)
        return session.scalars(statement).first()

    def record(
        self,
        session: Session,
        owner_id: str,
        *,
        label: str,
        item: Item | None,
        before: dict[str, Any] | None,
    ) -> None:
        """Remember one change so it can be undone. Older entries are pruned."""
        session.add(
            Change(
                id=new_id(),
                owner_id=owner_id,
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
                select(Change)
                .where(Change.owner_id == owner_id)
                .order_by(Change.at.desc(), Change.id.desc())
                .limit(20)
            )
        ]
        for row in session.scalars(select(Change).where(Change.owner_id == owner_id)):
            if row.id not in keep:
                session.delete(row)

    def last_change(self, session: Session, owner_id: str) -> Change | None:
        statement = (
            select(Change)
            .where(Change.owner_id == owner_id, Change.undone == 0)
            .order_by(Change.at.desc(), Change.id.desc())
            .limit(1)
        )
        return session.scalars(statement).first()


def dumps(value: Any) -> str:
    return json.dumps(value, default=str)
