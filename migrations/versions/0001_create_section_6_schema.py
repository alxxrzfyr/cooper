"""Create complete Section 6 schema.

Revision ID: 0001
Revises:
Create Date: 2026-08-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Enumerated values are spelled out here rather than imported from the ORM. A migration
# describes the schema at one point in history and must not drift when the models change.
TASK_STATUS_CHECK = "status IN ('active', 'done', 'dropped')"
BLOCK_STATE_CHECK = "state IN ('planned', 'pushed', 'user_moved', 'orphaned', 'completed')"
MUTATION_ACTOR_CHECK = "actor IN ('user', 'ai')"
AI_DECISION_KIND_CHECK = "kind IN ('parse', 'rerank')"
OUTBOX_STATE_CHECK = "state IN ('pending', 'sent', 'failed')"


def upgrade() -> None:
    op.create_table(
        "task",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("effort_minutes", sa.Integer(), nullable=True),
        sa.Column("importance", sa.Integer(), nullable=False),
        sa.Column("deadline", sa.Date(), nullable=True),
        sa.Column("earliest_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("slip_count", sa.Integer(), nullable=False),
        sa.Column("pinned_for_date", sa.Date(), nullable=True),
        sa.Column("allow_split", sa.Boolean(), nullable=False),
        sa.Column("tags", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("importance BETWEEN 1 AND 5", name="ck_task_importance"),
        sa.CheckConstraint("effort_minutes IS NULL OR effort_minutes > 0", name="ck_task_effort"),
        sa.CheckConstraint(TASK_STATUS_CHECK, name="ck_task_status"),
    )
    op.create_table(
        "task_dependency",
        sa.Column(
            "blocker_id",
            sa.String(36),
            sa.ForeignKey("task.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "blocked_id",
            sa.String(36),
            sa.ForeignKey("task.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_table(
        "focus_window",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("weekday", sa.Integer(), nullable=False),
        sa.Column("start_local", sa.Time(), nullable=False),
        sa.Column("end_local", sa.Time(), nullable=False),
        sa.Column("timezone", sa.String(100), nullable=False),
        sa.Column("daily_block_cap", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.CheckConstraint("weekday BETWEEN 0 AND 6", name="ck_focus_window_weekday"),
        sa.CheckConstraint("daily_block_cap > 0", name="ck_focus_window_daily_cap"),
    )
    op.create_table(
        "scheduled_block",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("task_id", sa.String(36), sa.ForeignKey("task.id"), nullable=False),
        sa.Column("start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("google_event_id", sa.String(1024), nullable=True, unique=True),
        sa.Column("state", sa.String(24), nullable=False),
        sa.CheckConstraint(BLOCK_STATE_CHECK, name="ck_scheduled_block_state"),
    )
    op.create_index("ix_scheduled_block_task_id", "scheduled_block", ["task_id"])
    op.create_table(
        "calendar_event_cache",
        sa.Column("google_event_id", sa.String(1024), primary_key=True),
        sa.Column("calendar_id", sa.String(1024), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("start_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_app_owned", sa.Boolean(), nullable=False),
        sa.Column("has_other_attendees", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_calendar_event_cache_start_utc", "calendar_event_cache", ["start_utc"])
    op.create_table(
        "mutation_log",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("batch_id", sa.String(36), nullable=False),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("actor", sa.String(8), nullable=False),
        sa.Column("intent_kind", sa.String(80), nullable=False),
        sa.Column("entity_type", sa.String(80), nullable=False),
        sa.Column("entity_id", sa.String(36), nullable=False),
        sa.Column("op", sa.String(40), nullable=False),
        sa.Column("before_json", sa.JSON(), nullable=True),
        sa.Column("after_json", sa.JSON(), nullable=True),
        sa.Column("inverse_applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(MUTATION_ACTOR_CHECK, name="ck_mutation_log_actor"),
    )
    op.create_index("ix_mutation_log_batch_id", "mutation_log", ["batch_id"])
    op.create_table(
        "ai_decision",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("ts", sa.DateTime(timezone=True), nullable=False),
        sa.Column("model_id", sa.String(200), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("input_digest", sa.String(128), nullable=False),
        sa.Column("output_json", sa.JSON(), nullable=False),
        sa.Column("reason_text", sa.String(200), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=False),
        sa.Column("token_estimate", sa.Integer(), nullable=True),
        sa.CheckConstraint(AI_DECISION_KIND_CHECK, name="ck_ai_decision_kind"),
    )
    op.create_table(
        "outbox",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("mutation_id", sa.String(36), sa.ForeignKey("mutation_log.id"), nullable=False),
        sa.Column("operation", sa.String(80), nullable=False),
        sa.Column("payload_json", sa.JSON(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("state", sa.String(16), nullable=False),
        sa.CheckConstraint(OUTBOX_STATE_CHECK, name="ck_outbox_state"),
    )
    op.create_index("ix_outbox_mutation_id", "outbox", ["mutation_id"])
    op.create_table(
        "job_run",
        sa.Column("job_name", sa.String(100), primary_key=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.String(40), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("job_run")
    op.drop_index("ix_outbox_mutation_id", table_name="outbox")
    op.drop_table("outbox")
    op.drop_table("ai_decision")
    op.drop_index("ix_mutation_log_batch_id", table_name="mutation_log")
    op.drop_table("mutation_log")
    op.drop_index("ix_calendar_event_cache_start_utc", table_name="calendar_event_cache")
    op.drop_table("calendar_event_cache")
    op.drop_index("ix_scheduled_block_task_id", table_name="scheduled_block")
    op.drop_table("scheduled_block")
    op.drop_table("focus_window")
    op.drop_table("task_dependency")
    op.drop_table("task")
