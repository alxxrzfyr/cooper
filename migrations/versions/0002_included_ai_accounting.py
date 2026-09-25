"""Add approved included-AI accounting; frozen schema revision 0002."""

import sqlalchemy as sa
from alembic import op

from cooper.db import Utc

revision = "0002_included_ai_accounting"
down_revision = "0001_public_ownership"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "ai_allowance" not in existing:
        op.create_table(
            "ai_allowance",
            sa.Column("owner_id", sa.String(128), primary_key=True, nullable=False),
            sa.Column("period", sa.String(7), primary_key=True, nullable=False),
            sa.Column("tier", sa.String(16), primary_key=False, nullable=False),
            sa.Column("limit_units", sa.Integer(), primary_key=False, nullable=False),
            sa.Column("reserved_units", sa.Integer(), primary_key=False, nullable=False),
            sa.Column("consumed_units", sa.Integer(), primary_key=False, nullable=False),
            sa.Column("created_at", Utc(), primary_key=False, nullable=False),
            sa.Column("updated_at", Utc(), primary_key=False, nullable=False),
            sa.CheckConstraint(
                "limit_units >= 0 AND reserved_units >= 0 AND consumed_units >= 0 AND "
                "reserved_units + consumed_units <= limit_units",
                name="ck_ai_allowance_counts",
            ),
            sa.CheckConstraint("tier IN ('free', 'pilot_plus')", name="ck_ai_allowance_tier"),
        )
    if "ai_spend_envelope" not in existing:
        op.create_table(
            "ai_spend_envelope",
            sa.Column("owner_id", sa.String(128), primary_key=True, nullable=False),
            sa.Column("period", sa.String(7), primary_key=True, nullable=False),
            sa.Column("scope", sa.String(16), primary_key=True, nullable=False),
            sa.Column("enabled", sa.Boolean(), primary_key=False, nullable=False),
            sa.Column("limit_microusd", sa.BigInteger(), primary_key=False, nullable=False),
            sa.Column("reserved_microusd", sa.BigInteger(), primary_key=False, nullable=False),
            sa.Column("spent_microusd", sa.BigInteger(), primary_key=False, nullable=False),
            sa.Column("created_at", Utc(), primary_key=False, nullable=False),
            sa.Column("updated_at", Utc(), primary_key=False, nullable=False),
            sa.CheckConstraint(
                "limit_microusd >= 0 AND reserved_microusd >= 0 AND spent_microusd >= "
                "0 AND reserved_microusd + spent_microusd <= limit_microusd",
                name="ck_ai_envelope_counts",
            ),
            sa.CheckConstraint(
                "scope IN ('aggregate', 'gemini', 'groq')", name="ck_ai_envelope_scope"
            ),
        )
    if "ai_request" not in existing:
        op.create_table(
            "ai_request",
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("owner_id", sa.String(128), primary_key=False, nullable=False),
            sa.Column("logical_request_id", sa.String(36), primary_key=False, nullable=False),
            sa.Column("payload_digest", sa.String(64), primary_key=False, nullable=False),
            sa.Column("period", sa.String(7), primary_key=False, nullable=False),
            sa.Column("state", sa.String(16), primary_key=False, nullable=False),
            sa.Column("allowance_state", sa.String(16), primary_key=False, nullable=False),
            sa.Column("response", sa.JSON(), primary_key=False, nullable=True),
            sa.Column("created_at", Utc(), primary_key=False, nullable=False),
            sa.Column("updated_at", Utc(), primary_key=False, nullable=False),
            sa.ForeignKeyConstraint(
                ["owner_id", "period"], ["ai_allowance.owner_id", "ai_allowance.period"]
            ),
            sa.CheckConstraint(
                "allowance_state IN ('reserved', 'consumed', 'released')",
                name="ck_ai_request_allowance",
            ),
            sa.CheckConstraint(
                "state IN ('admitted', 'running', 'applying', 'completed', 'failed', 'uncertain')",
                name="ck_ai_request_state",
            ),
            sa.UniqueConstraint("owner_id", "logical_request_id", name="uq_ai_request_logical"),
            sa.UniqueConstraint("id", "owner_id", name="uq_ai_request_owner"),
        )
    if "ai_attempt" not in existing:
        op.create_table(
            "ai_attempt",
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column("owner_id", sa.String(128), primary_key=False, nullable=False),
            sa.Column("request_id", sa.String(36), primary_key=False, nullable=False),
            sa.Column("attempt_no", sa.Integer(), primary_key=False, nullable=False),
            sa.Column("provider", sa.String(16), primary_key=False, nullable=False),
            sa.Column("model", sa.String(128), primary_key=False, nullable=False),
            sa.Column("price_revision", sa.String(64), primary_key=False, nullable=False),
            sa.Column("input_rate_microusd", sa.BigInteger(), primary_key=False, nullable=False),
            sa.Column("output_rate_microusd", sa.BigInteger(), primary_key=False, nullable=False),
            sa.Column("state", sa.String(16), primary_key=False, nullable=False),
            sa.Column("reserved_microusd", sa.BigInteger(), primary_key=False, nullable=False),
            sa.Column("actual_microusd", sa.BigInteger(), primary_key=False, nullable=True),
            sa.Column("input_tokens", sa.Integer(), primary_key=False, nullable=True),
            sa.Column("output_tokens", sa.Integer(), primary_key=False, nullable=True),
            sa.Column("created_at", Utc(), primary_key=False, nullable=False),
            sa.Column("updated_at", Utc(), primary_key=False, nullable=False),
            sa.ForeignKeyConstraint(
                ["request_id", "owner_id"], ["ai_request.id", "ai_request.owner_id"]
            ),
            sa.CheckConstraint("attempt_no BETWEEN 1 AND 4", name="ck_ai_attempt_number"),
            sa.CheckConstraint("provider IN ('gemini', 'groq')", name="ck_ai_attempt_provider"),
            sa.CheckConstraint(
                "state IN ('reserved', 'dispatching', 'settled', 'uncertain', 'released')",
                name="ck_ai_attempt_state",
            ),
            sa.CheckConstraint(
                "reserved_microusd >= 0 AND (actual_microusd IS NULL OR "
                "actual_microusd >= 0) AND (input_tokens IS NULL OR input_tokens >= 0) "
                "AND (output_tokens IS NULL OR output_tokens >= 0)",
                name="ck_ai_attempt_usage",
            ),
            sa.UniqueConstraint("request_id", "attempt_no", name="uq_ai_attempt_number"),
        )


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "ai_attempt" in existing:
        op.drop_table("ai_attempt")
    if "ai_request" in existing:
        op.drop_table("ai_request")
    if "ai_spend_envelope" in existing:
        op.drop_table("ai_spend_envelope")
    if "ai_allowance" in existing:
        op.drop_table("ai_allowance")
