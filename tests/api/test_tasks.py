import datetime as dt
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from cadence.api.security import SHARED_SECRET_HEADER
from cadence.config import Settings
from cadence.main import create_app

SECRET = "tasks-api-test-shared-secret-0123456789"
HEADERS = {SHARED_SECRET_HEADER: SECRET}


@pytest.fixture
def client(tmp_path: object) -> Iterator[TestClient]:
    settings = Settings(
        shared_secret=SECRET,
        allowed_hosts=("testserver",),
        database_url=f"sqlite:///{tmp_path}/api.db",  # type: ignore[str-bytes-safe]
    )
    with TestClient(create_app(settings, create_schema=True)) as open_client:
        yield open_client


def create(client: TestClient, **payload: object) -> dict[str, object]:
    body: dict[str, object] = {"title": "write the report"} | payload
    response = client.post("/api/tasks", json=body, headers=HEADERS)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_returns_the_stored_task(client: TestClient) -> None:
    task = create(client, effort_minutes=180, importance=5, tags=["Work", "work"])

    assert task["title"] == "write the report"
    assert task["effort_minutes"] == 180
    assert task["importance"] == 5
    assert task["tags"] == ["work"]
    assert task["status"] == "active"
    assert task["slip_count"] == 0


def test_created_task_survives_a_separate_request(client: TestClient) -> None:
    task_id = create(client)["id"]

    response = client.get(f"/api/tasks/{task_id}", headers=HEADERS)

    assert response.status_code == 200
    assert response.json()["id"] == task_id


def test_invalid_importance_is_rejected_as_unprocessable(client: TestClient) -> None:
    response = client.post(
        "/api/tasks",
        json={"title": "task", "importance": 9},
        headers=HEADERS,
    )

    assert response.status_code == 422


def test_blank_title_is_rejected(client: TestClient) -> None:
    response = client.post("/api/tasks", json={"title": "   "}, headers=HEADERS)

    assert response.status_code == 422


def test_unknown_field_is_refused(client: TestClient) -> None:
    response = client.post(
        "/api/tasks",
        json={"title": "task", "nonsense": 1},
        headers=HEADERS,
    )

    assert response.status_code == 422


def test_missing_task_returns_not_found(client: TestClient) -> None:
    response = client.get("/api/tasks/absent", headers=HEADERS)

    assert response.status_code == 404


def test_patch_changes_only_supplied_fields(client: TestClient) -> None:
    task_id = create(client, effort_minutes=180, importance=2)["id"]

    response = client.patch(f"/api/tasks/{task_id}", json={"importance": 4}, headers=HEADERS)

    assert response.status_code == 200
    body = response.json()
    assert body["importance"] == 4
    assert body["effort_minutes"] == 180


def test_complete_then_drop_transitions(client: TestClient) -> None:
    task_id = create(client)["id"]

    completed = client.post(f"/api/tasks/{task_id}/complete", headers=HEADERS).json()
    assert completed["status"] == "done"
    assert completed["completed_at"] is not None

    second = client.post(f"/api/tasks/{task_id}/complete", headers=HEADERS)
    assert second.status_code == 422

    dropped = client.post(f"/api/tasks/{task_id}/drop", headers=HEADERS).json()
    assert dropped["status"] == "dropped"


def test_pin_and_unpin(client: TestClient) -> None:
    task_id = create(client)["id"]
    day = dt.date(2026, 8, 29).isoformat()

    pinned = client.put(f"/api/tasks/{task_id}/pin", json={"date": day}, headers=HEADERS).json()
    assert pinned["pinned_for_date"] == day

    cleared = client.put(f"/api/tasks/{task_id}/pin", json={"date": None}, headers=HEADERS).json()
    assert cleared["pinned_for_date"] is None


def test_list_filters_by_status(client: TestClient) -> None:
    first = create(client, title="first")["id"]
    create(client, title="second")
    client.post(f"/api/tasks/{first}/complete", headers=HEADERS)

    active = client.get("/api/tasks?status_filter=active", headers=HEADERS).json()

    assert [task["title"] for task in active] == ["second"]


def test_dependency_marks_the_blocked_task(client: TestClient) -> None:
    blocker = create(client, title="api access")["id"]
    blocked = create(client, title="data export")["id"]

    response = client.post(
        "/api/tasks/dependencies",
        json={"blocker_id": blocker, "blocked_id": blocked},
        headers=HEADERS,
    )
    assert response.status_code == 204

    listed = {
        task["id"]: task["is_blocked"] for task in client.get("/api/tasks", headers=HEADERS).json()
    }
    assert listed[blocked] is True
    assert listed[blocker] is False


def test_self_dependency_is_refused(client: TestClient) -> None:
    task_id = create(client)["id"]

    response = client.post(
        "/api/tasks/dependencies",
        json={"blocker_id": task_id, "blocked_id": task_id},
        headers=HEADERS,
    )

    assert response.status_code == 422


def test_task_routes_still_require_the_shared_secret(client: TestClient) -> None:
    assert client.get("/api/tasks").status_code == 403
    assert client.post("/api/tasks", json={"title": "task"}).status_code == 403
