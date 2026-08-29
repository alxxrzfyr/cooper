import datetime as dt

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    String,
    Text,
    Time,
)
from sqlalchemy.orm import Mapped, mapped_column

from cadence.adapters.database import Base

# Enumerated column values from spec section 6. The database enforces these so a bug in
# any service layer cannot persist a state the domain has no meaning for.
TASK_STATUSES = ("active", "done", "dropped")
BLOCK_STATES = ("planned", "pushed", "user_moved", "orphaned", "completed")
MUTATION_ACTORS = ("user", "ai")
AI_DECISION_KINDS = ("parse", "rerank")
OUTBOX_STATES = ("pending", "sent", "failed")


def _one_of(column: str, allowed: tuple[str, ...], *, name: str) -> CheckConstraint:
    """Build a CHECK constraint restricting a column to an enumerated set."""
    quoted = ", ".join(f"'{value}'" for value in allowed)
    return CheckConstraint(f"{column} IN ({quoted})", name=name)


class TaskModel(Base):
    __tablename__ = "task"
    __table_args__ = (
        CheckConstraint("importance BETWEEN 1 AND 5", name="ck_task_importance"),
        CheckConstraint("effort_minutes IS NULL OR effort_minutes > 0", name="ck_task_effort"),
        _one_of("status", TASK_STATUSES, name="ck_task_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    effort_minutes: Mapped[int | None]
    importance: Mapped[int] = mapped_column(default=3)
    deadline: Mapped[dt.date | None] = mapped_column(Date)
    earliest_start: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="active")
    slip_count: Mapped[int] = mapped_column(default=0)
    pinned_for_date: Mapped[dt.date | None] = mapped_column(Date)
    allow_split: Mapped[bool] = mapped_column(Boolean, default=False)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class TaskDependencyModel(Base):
    __tablename__ = "task_dependency"

    blocker_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task.id", ondelete="CASCADE"), primary_key=True
    )
    blocked_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("task.id", ondelete="CASCADE"), primary_key=True
    )


class FocusWindowModel(Base):
    __tablename__ = "focus_window"
    __table_args__ = (
        CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_focus_window_weekday"),
        CheckConstraint("daily_block_cap > 0", name="ck_focus_window_daily_cap"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    weekday: Mapped[int]
    start_local: Mapped[dt.time] = mapped_column(Time)
    end_local: Mapped[dt.time] = mapped_column(Time)
    timezone: Mapped[str] = mapped_column(String(100))
    daily_block_cap: Mapped[int] = mapped_column(default=3)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ScheduledBlockModel(Base):
    __tablename__ = "scheduled_block"
    __table_args__ = (_one_of("state", BLOCK_STATES, name="ck_scheduled_block_state"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("task.id"), index=True)
    start_utc: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    end_utc: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    google_event_id: Mapped[str | None] = mapped_column(String(1024), unique=True)
    state: Mapped[str] = mapped_column(String(24), default="planned")


class CalendarEventCacheModel(Base):
    """Busy-time awareness only.

    Descriptions, locations, meeting links, and attendee addresses are stripped at
    ingestion and therefore have no column here. A field that never enters the
    database cannot later leak from it.
    """

    __tablename__ = "calendar_event_cache"

    google_event_id: Mapped[str] = mapped_column(String(1024), primary_key=True)
    calendar_id: Mapped[str] = mapped_column(String(1024))
    title: Mapped[str] = mapped_column(String(500))
    start_utc: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    end_utc: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    is_app_owned: Mapped[bool] = mapped_column(Boolean)
    has_other_attendees: Mapped[bool] = mapped_column(Boolean)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))


class MutationLogModel(Base):
    __tablename__ = "mutation_log"
    __table_args__ = (_one_of("actor", MUTATION_ACTORS, name="ck_mutation_log_actor"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), index=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    actor: Mapped[str] = mapped_column(String(8))
    intent_kind: Mapped[str] = mapped_column(String(80))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str] = mapped_column(String(36))
    op: Mapped[str] = mapped_column(String(40))
    before_json: Mapped[dict[str, object] | None] = mapped_column(JSON)
    after_json: Mapped[dict[str, object] | None] = mapped_column(JSON)
    inverse_applied_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class AiDecisionModel(Base):
    """Stores a digest of model input, never the raw prompt text."""

    __tablename__ = "ai_decision"
    __table_args__ = (_one_of("kind", AI_DECISION_KINDS, name="ck_ai_decision_kind"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    model_id: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16))
    input_digest: Mapped[str] = mapped_column(String(128))
    output_json: Mapped[dict[str, object]] = mapped_column(JSON)
    reason_text: Mapped[str | None] = mapped_column(String(200))
    latency_ms: Mapped[int]
    token_estimate: Mapped[int | None]


class OutboxModel(Base):
    __tablename__ = "outbox"
    __table_args__ = (_one_of("state", OUTBOX_STATES, name="ck_outbox_state"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    mutation_id: Mapped[str] = mapped_column(String(36), ForeignKey("mutation_log.id"), index=True)
    operation: Mapped[str] = mapped_column(String(80))
    payload_json: Mapped[dict[str, object]] = mapped_column(JSON)
    attempts: Mapped[int] = mapped_column(default=0)
    next_attempt_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    state: Mapped[str] = mapped_column(String(16), default="pending")


class JobRunModel(Base):
    __tablename__ = "job_run"

    job_name: Mapped[str] = mapped_column(String(100), primary_key=True)
    last_run_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    last_status: Mapped[str | None] = mapped_column(String(40))
