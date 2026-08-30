"""Add durable owner-scoped persistence.

Revision ID: 0001_public_ownership
Revises:
Create Date: 2026-08-31
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection

revision = "0001_public_ownership"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "item" not in tables:
        _create_item()
    else:
        _upgrade_item(bind)

    if "setting" not in tables:
        _create_setting()
    else:
        _upgrade_setting(bind)

    if "change" not in tables:
        _create_change()
    else:
        _upgrade_change(bind)

    _create_missing_indexes(bind)


def downgrade() -> None:
    bind = op.get_bind()
    indexes = _index_names(bind)
    for table, name in (
        ("change", "ix_change_owner_id"),
        ("setting", "ix_setting_owner_id"),
        ("item", "ix_item_owner_id"),
    ):
        if name in indexes.get(table, set()):
            op.drop_index(name, table_name=table)

    tables = set(sa.inspect(bind).get_table_names())
    if "change" in tables and "owner_id" in _columns(bind, "change"):
        with op.batch_alter_table("change") as batch:
            batch.drop_column("owner_id")
    if "item" in tables:
        item_columns = _columns(bind, "item")
        with op.batch_alter_table("item") as batch:
            for column in ("source_ref", "source", "owner_id"):
                if column in item_columns:
                    batch.drop_column(column)


def _create_item() -> None:
    op.create_table(
        "item",
        sa.Column("id", sa.String(length=12), primary_key=True),
        sa.Column("owner_id", sa.String(length=128), nullable=False, server_default="local"),
        sa.Column("source", sa.String(length=16), nullable=False, server_default="me"),
        sa.Column("source_ref", sa.String(length=255), nullable=True),
        sa.Column("kind", sa.String(length=8), nullable=False, server_default="task"),
        sa.Column("title", sa.String(length=300), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("minutes", sa.Integer(), nullable=True),
        sa.Column("importance", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("due", sa.DateTime(), nullable=True),
        sa.Column("start_at", sa.DateTime(), nullable=True),
        sa.Column("end_at", sa.DateTime(), nullable=True),
        sa.Column("google_event_id", sa.String(length=255), nullable=True),
        sa.Column("category", sa.String(length=16), nullable=False, server_default="personal"),
        sa.Column("status", sa.String(length=8), nullable=False, server_default="open"),
        sa.Column("pinned", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("done_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint("kind IN ('task', 'event')", name="ck_item_kind"),
        sa.CheckConstraint("status IN ('open', 'done', 'dropped')", name="ck_item_status"),
        sa.CheckConstraint("importance BETWEEN 1 AND 5", name="ck_item_importance"),
    )


def _create_setting() -> None:
    op.create_table(
        "setting",
        sa.Column("owner_id", sa.String(length=128), primary_key=True),
        sa.Column("key", sa.String(length=60), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
    )


def _create_change() -> None:
    op.create_table(
        "change",
        sa.Column("id", sa.String(length=12), primary_key=True),
        sa.Column("owner_id", sa.String(length=128), nullable=False, server_default="local"),
        sa.Column("at", sa.DateTime(), nullable=True),
        sa.Column("label", sa.String(length=120), nullable=False),
        sa.Column("item_id", sa.String(length=12), nullable=True),
        sa.Column("before", sa.JSON(), nullable=True),
        sa.Column("undone", sa.Integer(), nullable=False, server_default="0"),
    )


def _upgrade_item(bind: Connection) -> None:
    columns = _columns(bind, "item")
    with op.batch_alter_table("item") as batch:
        if "owner_id" not in columns:
            batch.add_column(
                sa.Column("owner_id", sa.String(length=128), nullable=False, server_default="local")
            )
        else:
            batch.alter_column(
                "owner_id",
                existing_type=sa.String(length=60),
                type_=sa.String(length=128),
                nullable=False,
                server_default="local",
            )
        if "source" not in columns:
            batch.add_column(
                sa.Column("source", sa.String(length=16), nullable=False, server_default="me")
            )
        else:
            batch.alter_column(
                "source",
                existing_type=sa.String(length=16),
                nullable=False,
                server_default="me",
            )
        if "source_ref" not in columns:
            batch.add_column(sa.Column("source_ref", sa.String(length=255), nullable=True))
        if "category" not in columns:
            batch.add_column(
                sa.Column(
                    "category",
                    sa.String(length=16),
                    nullable=False,
                    server_default="personal",
                )
            )


def _upgrade_setting(bind: Connection) -> None:
    pk_columns = sa.inspect(bind).get_pk_constraint("setting").get("constrained_columns") or []
    if pk_columns == ["owner_id", "key"]:
        return

    metadata = sa.MetaData()
    old = sa.Table("setting", metadata, autoload_with=bind)
    replacement = op.create_table(
        "setting_owner",
        sa.Column("owner_id", sa.String(length=128), primary_key=True),
        sa.Column("key", sa.String(length=60), primary_key=True),
        sa.Column("value", sa.JSON(), nullable=False),
    )
    bind.execute(
        replacement.insert().from_select(
            ["owner_id", "key", "value"],
            sa.select(sa.literal("local"), old.c.key, old.c.value),
        )
    )
    op.drop_table("setting")
    op.rename_table("setting_owner", "setting")


def _upgrade_change(bind: Connection) -> None:
    columns = _columns(bind, "change")
    with op.batch_alter_table("change") as batch:
        if "owner_id" not in columns:
            batch.add_column(
                sa.Column("owner_id", sa.String(length=128), nullable=False, server_default="local")
            )
        else:
            batch.alter_column(
                "owner_id",
                existing_type=sa.String(length=60),
                type_=sa.String(length=128),
                nullable=False,
                server_default="local",
            )


def _create_missing_indexes(bind: Connection) -> None:
    indexes = _index_names(bind)
    for table, name, columns in (
        ("item", "ix_item_owner_id", ["owner_id"]),
        ("setting", "ix_setting_owner_id", ["owner_id"]),
        ("change", "ix_change_owner_id", ["owner_id"]),
    ):
        if name not in indexes.get(table, set()):
            op.create_index(name, table, columns)


def _columns(bind: Connection, table: str) -> set[str]:
    return {column["name"] for column in sa.inspect(bind).get_columns(table)}


def _index_names(bind: Connection) -> dict[str, set[str]]:
    inspector = sa.inspect(bind)
    return {
        table: {index["name"] for index in inspector.get_indexes(table)}
        for table in inspector.get_table_names()
    }
