from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

EXPECTED_COLUMNS = {
    "task": {
        "id",
        "title",
        "notes",
        "effort_minutes",
        "importance",
        "deadline",
        "earliest_start",
        "status",
        "slip_count",
        "pinned_for_date",
        "allow_split",
        "tags",
        "created_at",
        "completed_at",
    },
    "task_dependency": {"blocker_id", "blocked_id"},
    "focus_window": {
        "id",
        "weekday",
        "start_local",
        "end_local",
        "timezone",
        "daily_block_cap",
        "active",
    },
    "scheduled_block": {
        "id",
        "task_id",
        "start_utc",
        "end_utc",
        "google_event_id",
        "state",
    },
    "calendar_event_cache": {
        "google_event_id",
        "calendar_id",
        "title",
        "start_utc",
        "end_utc",
        "is_app_owned",
        "has_other_attendees",
        "updated_at",
    },
    "mutation_log": {
        "id",
        "batch_id",
        "ts",
        "actor",
        "intent_kind",
        "entity_type",
        "entity_id",
        "op",
        "before_json",
        "after_json",
        "inverse_applied_at",
    },
    "ai_decision": {
        "id",
        "ts",
        "model_id",
        "kind",
        "input_digest",
        "output_json",
        "reason_text",
        "latency_ms",
        "token_estimate",
    },
    "outbox": {
        "id",
        "mutation_id",
        "operation",
        "payload_json",
        "attempts",
        "next_attempt_at",
        "state",
    },
    "job_run": {"job_name", "last_run_at", "last_status"},
}


def migrated_engine(tmp_path: Path) -> Engine:
    database_url = f"sqlite:///{tmp_path / 'cadence.db'}"
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "head")
    return create_engine(database_url)


def test_upgrade_head_creates_full_section_6_schema(tmp_path: Path) -> None:
    inspector = inspect(migrated_engine(tmp_path))

    # Alembic's own bookkeeping table is not part of the domain schema.
    created = set(inspector.get_table_names()) - {"alembic_version"}
    assert created == set(EXPECTED_COLUMNS)
    for table, expected_columns in EXPECTED_COLUMNS.items():
        assert {column["name"] for column in inspector.get_columns(table)} == expected_columns


def test_calendar_cache_omits_sensitive_fields(tmp_path: Path) -> None:
    columns = {
        column["name"]
        for column in inspect(migrated_engine(tmp_path)).get_columns("calendar_event_cache")
    }
    assert not {"description", "location", "attendee_emails", "meeting_link"} & columns


@pytest.mark.parametrize(
    "statement",
    [
        """INSERT INTO task VALUES
        ('t1', 'Task', NULL, 30, 3, NULL, NULL, 'invalid', 0, NULL, 0, '[]',
         '2026-08-29 00:00:00', NULL)""",
        """INSERT INTO scheduled_block VALUES
        ('b1', 't1', '2026-08-29 00:00:00', '2026-08-29 01:00:00', NULL, 'invalid')""",
        """INSERT INTO mutation_log VALUES
        ('m1', 'batch1', '2026-08-29 00:00:00', 'invalid', 'CreateTask', 'task', 't1',
         'insert', NULL, '{}', NULL)""",
        """INSERT INTO ai_decision VALUES
        ('a1', '2026-08-29 00:00:00', 'configured-model', 'invalid', 'digest', '{}', NULL,
         1, NULL)""",
        """INSERT INTO outbox VALUES
        ('o1', 'm1', 'insert', '{}', 0, NULL, 'invalid')""",
    ],
    ids=["task-status", "block-state", "mutation-actor", "decision-kind", "outbox-state"],
)
def test_section_6_enum_values_are_enforced(tmp_path: Path, statement: str) -> None:
    engine = migrated_engine(tmp_path)

    with engine.begin() as connection, pytest.raises(IntegrityError):
        connection.execute(text(statement))
