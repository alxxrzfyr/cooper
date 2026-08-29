import datetime as dt
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cadence.api.security import SHARED_SECRET_HEADER
from cadence.config import Settings
from cadence.main import create_app

SECRET = "capture-api-test-shared-secret-0123456"
HEADERS = {SHARED_SECRET_HEADER: SECRET}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(
        shared_secret=SECRET,
        allowed_hosts=("testserver",),
        database_url=f"sqlite:///{tmp_path / 'capture.db'}",
        timezone="Asia/Singapore",
    )
    with TestClient(create_app(settings, create_schema=True)) as open_client:
        yield open_client


def say(client: TestClient, utterance: str) -> dict[str, object]:
    response = client.post("/api/capture", json={"utterance": utterance}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_sentence_creates_a_task_and_returns_a_chip(client: TestClient) -> None:
    body = say(client, "write the quarterly report, 3h, important, due friday")

    assert body["intent"] == "CreateTask"
    assert body["task"] is not None
    assert body["task"]["title"] == "write the quarterly report"
    assert body["task"]["effort_minutes"] == 180
    assert body["task"]["importance"] == 4
    assert body["chip"]["summary"].startswith("write the quarterly report")
    assert body["mutation_id"] is not None


def test_the_default_configuration_runs_offline_with_zero_model_calls(client: TestClient) -> None:
    body = say(client, "write the report")

    assert body["provider"] == "rule_based"
    assert body["model_calls"] == 0
    assert body["degraded"] is True


def test_a_captured_task_appears_in_the_plan(client: TestClient) -> None:
    say(client, "write the quarterly report, important")

    shortlist = client.get("/api/plan/today", headers=HEADERS).json()["shortlist"]

    assert [entry["task"]["title"] for entry in shortlist] == ["write the quarterly report"]


def test_a_fixed_event_is_echoed_without_creating_a_task(client: TestClient) -> None:
    body = say(client, "dentist thursday 3pm")

    assert body["intent"] == "CreateEvent"
    assert body["task"] is None
    assert "dentist" in body["chip"]["summary"]
    assert client.get("/api/tasks", headers=HEADERS).json() == []


def test_an_ambiguous_reference_returns_conflict_with_candidates(client: TestClient) -> None:
    say(client, "design review weekly")
    say(client, "design review prep")

    response = client.post(
        "/api/capture",
        json={"utterance": "done design review"},
        headers=HEADERS,
    )

    assert response.status_code == 409
    assert len(response.json()["candidates"]) == 2


def test_an_unknown_reference_returns_not_found(client: TestClient) -> None:
    say(client, "write the report")

    response = client.post(
        "/api/capture",
        json={"utterance": "done buy a boat in norway"},
        headers=HEADERS,
    )

    assert response.status_code == 404


def test_a_completion_sentence_closes_the_task(client: TestClient) -> None:
    say(client, "write the quarterly report")

    body = say(client, "done quarterly")

    assert body["intent"] == "CompleteTask"
    assert body["task"]["status"] == "done"


def test_undo_restores_the_previous_state(client: TestClient) -> None:
    created = say(client, "write the report")
    task_id = created["task"]["id"]  # type: ignore[index]
    client.patch(f"/api/tasks/{task_id}", json={"importance": 5}, headers=HEADERS)
    changed = say(client, "pin the report")
    mutation_id = changed["mutation_id"]

    response = client.post(f"/api/capture/{mutation_id}/undo", headers=HEADERS)

    assert response.status_code == 200
    assert response.json()["task"]["pinned_for_date"] is None


def test_undo_of_a_creation_drops_the_task(client: TestClient) -> None:
    created = say(client, "mistyped task")

    client.post(f"/api/capture/{created['mutation_id']}/undo", headers=HEADERS)

    tasks = client.get("/api/tasks", headers=HEADERS).json()
    assert [task["status"] for task in tasks] == ["dropped"]


def test_undo_of_an_unknown_mutation_is_not_found(client: TestClient) -> None:
    assert client.post("/api/capture/absent/undo", headers=HEADERS).status_code == 404


def test_a_question_returns_a_query_intent_and_changes_nothing(client: TestClient) -> None:
    body = say(client, "what should i do")

    assert body["intent"] == "Query"
    assert body["task"] is None
    assert body["mutation_id"] is None


def test_an_empty_utterance_is_refused_by_validation(client: TestClient) -> None:
    response = client.post("/api/capture", json={"utterance": ""}, headers=HEADERS)

    assert response.status_code == 422


def test_an_overlong_utterance_is_refused(client: TestClient) -> None:
    response = client.post("/api/capture", json={"utterance": "x" * 2001}, headers=HEADERS)

    assert response.status_code == 422


def test_provider_status_reports_degraded_mode(client: TestClient) -> None:
    body = client.get("/api/capture/status", headers=HEADERS).json()

    assert body["provider"] == "rule_based"
    assert body["degraded"] is True


def test_capture_requires_the_shared_secret(client: TestClient) -> None:
    assert client.post("/api/capture", json={"utterance": "hello"}).status_code == 403


def test_a_deadline_is_stored_as_a_real_date(client: TestClient) -> None:
    body = say(client, "file the taxes, due 2026-09-10")

    assert body["task"]["deadline"] == dt.date(2026, 9, 10).isoformat()
