"""Add Google credential and sync state tables.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "google_credential",
        sa.Column("id", sa.String(16), primary_key=True),
        # Encrypted at rest. The database file alone does not grant calendar access.
        sa.Column("refresh_token_encrypted", sa.Text(), nullable=False),
        sa.Column("scope", sa.String(500), nullable=False),
        sa.Column("account_email", sa.String(320), nullable=True),
        sa.Column("obtained_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_refreshed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
    )
    op.create_table(
        "sync_state",
        sa.Column("calendar_id", sa.String(1024), primary_key=True),
        sa.Column("sync_token", sa.Text(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("sync_state")
    op.drop_table("google_credential")
