"""Database ownership and migration contract."""

from __future__ import annotations

import os
import pathlib
import subprocess
import sys
from collections.abc import Iterator

import pytest
from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    create_engine,
    inspect,
    select,
)

from cooper.db import Change, Item, Setting, Store, new_id


@pytest.fixture
def store(tmp_path: pathlib.Path) -> Iterator[Store]:
    yield Store(f"sqlite:///{tmp_path / 'test.db'}")


def test_setting_keys_are_scoped_by_owner(store: Store) -> None:
    store.set_setting("u1", "hours", {"start": 9})
    store.set_setting("u2", "hours", {"start": 11})

    assert store.get_setting("u1", "hours") == {"start": 9}
    assert store.get_setting("u2", "hours") == {"start": 11}


def test_open_items_are_scoped_by_owner(store: Store) -> None:
    with store.session() as session:
        session.add(Item(id=new_id(), owner_id="u1", title="mine"))
        session.add(Item(id=new_id(), owner_id="u2", title="theirs"))
        session.add(Item(id=new_id(), owner_id="u1", title="done", status="done"))

    with store.session() as session:
        assert [item.title for item in store.open_items(session, "u1")] == ["mine"]
        assert [item.title for item in store.open_items(session, "u2")] == ["theirs"]


def test_get_item_is_scoped_by_owner(store: Store) -> None:
    item_id = new_id()
    with store.session() as session:
        session.add(Item(id=item_id, owner_id="u1", title="mine"))

    with store.session() as session:
        assert store.get_item(session, "u1", item_id) is not None
        assert store.get_item(session, "u2", item_id) is None


def test_last_change_is_scoped_by_owner(store: Store) -> None:
    with store.session() as session:
        mine = Item(id=new_id(), owner_id="u1", title="mine")
        theirs = Item(id=new_id(), owner_id="u2", title="theirs")
        session.add_all([mine, theirs])
        session.flush()
        store.record(session, "u1", label="Added mine", item=mine, before=None)
        store.record(session, "u2", label="Added theirs", item=theirs, before=None)

    with store.session() as session:
        mine_change = store.last_change(session, "u1")
        their_change = store.last_change(session, "u2")

    assert mine_change is not None
    assert their_change is not None
    assert mine_change.label == "Added mine"
    assert their_change.label == "Added theirs"


def test_item_serialization_includes_owner_source_and_source_ref(store: Store) -> None:
    with store.session() as session:
        session.add(
            Item(
                id=new_id(),
                owner_id="u1",
                kind="event",
                title="meetup",
                source="gmail",
                source_ref="message-1",
            )
        )
        session.flush()
        payload = store.open_items(session, "u1")[0].to_dict()

    assert payload["owner_id"] == "u1"
    assert payload["source"] == "gmail"
    assert payload["source_ref"] == "message-1"


def test_alembic_upgrade_head_creates_owner_schema(tmp_path: pathlib.Path) -> None:
    db_path = tmp_path / "fresh.db"

    _run_alembic(db_path)

    engine = create_engine(f"sqlite:///{db_path}")
    inspector = inspect(engine)
    assert inspector.get_pk_constraint("setting")["constrained_columns"] == ["owner_id", "key"]
    assert _column_names(inspector, "item") >= {"owner_id", "source", "source_ref"}
    assert "owner_id" in _column_names(inspector, "change")

    with engine.begin() as connection:
        connection.execute(
            Setting.__table__.insert(),
            [
                {"owner_id": "u1", "key": "hours", "value": {"start": 9}},
                {"owner_id": "u2", "key": "hours", "value": {"start": 11}},
            ],
        )
        rows = connection.execute(
            select(Setting.owner_id, Setting.key, Setting.value).order_by(Setting.owner_id)
        ).all()

    assert rows == [("u1", "hours", {"start": 9}), ("u2", "hours", {"start": 11})]


def test_alembic_upgrade_head_preserves_legacy_local_rows(tmp_path: pathlib.Path) -> None:
    db_path = tmp_path / "legacy.db"
    _create_legacy_database(db_path)

    _run_alembic(db_path)

    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as connection:
        item = connection.execute(
            select(Item.owner_id, Item.source, Item.source_ref).where(Item.id == "legacy-item")
        ).one()
        setting = connection.execute(select(Setting.owner_id, Setting.key, Setting.value)).one()
        change = connection.execute(
            select(Change.owner_id, Change.label).where(Change.id == "legacy-change")
        ).one()

    assert item == ("local", "me", None)
    assert setting == ("local", "hours", {"start_hour": 8})
    assert change == ("local", "Added legacy")


def _column_names(inspector, table: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table)}


def _run_alembic(db_path: pathlib.Path) -> None:
    env = os.environ.copy()
    env["COOPER_DATABASE_URL"] = f"sqlite:///{db_path}"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        check=False,
        cwd=pathlib.Path(__file__).resolve().parents[1],
        env=env,
        text=True,
        capture_output=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def _create_legacy_database(db_path: pathlib.Path) -> None:
    engine = create_engine(f"sqlite:///{db_path}")
    metadata = MetaData()
    Table(
        "item",
        metadata,
        Column("id", String(12), primary_key=True),
        Column("kind", String(8)),
        Column("title", String(300)),
        Column("notes", Text),
        Column("minutes", Integer),
        Column("importance", Integer),
        Column("due", DateTime),
        Column("start_at", DateTime),
        Column("end_at", DateTime),
        Column("google_event_id", String(255)),
        Column("category", String(16)),
        Column("status", String(8)),
        Column("pinned", Integer),
        Column("created_at", DateTime),
        Column("done_at", DateTime),
    )
    Table(
        "setting",
        metadata,
        Column("key", String(60), primary_key=True),
        Column("value", JSON),
    )
    Table(
        "change",
        metadata,
        Column("id", String(12), primary_key=True),
        Column("at", DateTime),
        Column("label", String(120)),
        Column("item_id", String(12)),
        Column("before", JSON),
        Column("undone", Integer),
    )
    metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(
            metadata.tables["item"].insert(),
            {
                "id": "legacy-item",
                "kind": "task",
                "title": "legacy",
                "importance": 3,
                "status": "open",
                "pinned": 0,
            },
        )
        connection.execute(
            metadata.tables["setting"].insert(),
            {"key": "hours", "value": {"start_hour": 8}},
        )
        connection.execute(
            metadata.tables["change"].insert(),
            {
                "id": "legacy-change",
                "label": "Added legacy",
                "item_id": "legacy-item",
                "undone": 0,
            },
        )
