import datetime as dt
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cadence.api.security import SHARED_SECRET_HEADER
from cadence.config import Settings
from cadence.main import create_app

SECRET = "plan-api-test-shared-secret-0123456789"
HEADERS = {SHARED_SECRET_HEADER: SECRET}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(
        shared_secret=SECRET,
        allowed_hosts=("testserver",),
        database_url=f"sqlite:///{tmp_path / 'plan.db'}",
    )
    with TestClient(create_app(settings, create_schema=True)) as open_client:
        yield open_client


def add(client: TestClient, title: str, **payload: object) -> str:
    response = client.post("/api/tasks", json={"title": title} | payload, headers=HEADERS)
    assert response.status_code == 201, response.text
    task_id: str = response.json()["id"]
    return task_id


def test_today_returns_an_empty_plan_for_an_empty_database(client: TestClient) -> None:
    body = client.get("/api/plan/today", headers=HEADERS).json()

    assert body["shortlist"] == []
    assert body["backlog"] == []
    assert body["blocked"] == []
    assert body["degraded"] is False


def test_today_ranks_the_urgent_task_first(client: TestClient) -> None:
    add(client, "ordinary", importance=2)
    add(client, "urgent", importance=5, deadline=dt.date.today().isoformat())

    body = client.get("/api/plan/today", headers=HEADERS).json()

    assert [entry["task"]["title"] for entry in body["shortlist"]] == ["urgent", "ordinary"]
    assert body["shortlist"][0]["rank"] == 1


def test_each_entry_exposes_all_five_score_contributions(client: TestClient) -> None:
    add(client, "a task", importance=4)

    entry = client.get("/api/plan/today", headers=HEADERS).json()["shortlist"][0]

    terms = {contribution["term"] for contribution in entry["contributions"]}
    assert terms == {"deadline_pressure", "importance", "slip_pressure", "unblocks", "age"}
    assert entry["score"] > 0


def test_limit_bounds_the_shortlist_without_bounding_the_backlog(client: TestClient) -> None:
    for index in range(6):
        add(client, f"task {index}")

    body = client.get("/api/plan/today?limit=3", headers=HEADERS).json()

    assert len(body["shortlist"]) == 3
    assert len(body["backlog"]) == 6


def test_an_out_of_range_limit_is_refused(client: TestClient) -> None:
    assert client.get("/api/plan/today?limit=0", headers=HEADERS).status_code == 422
    assert client.get("/api/plan/today?limit=999", headers=HEADERS).status_code == 422


def test_blocked_tasks_appear_only_in_the_blocked_list(client: TestClient) -> None:
    blocker = add(client, "api access")
    blocked = add(client, "data export")
    client.post(
        "/api/tasks/dependencies",
        json={"blocker_id": blocker, "blocked_id": blocked},
        headers=HEADERS,
    )

    body = client.get("/api/plan/today", headers=HEADERS).json()

    assert [entry["task"]["title"] for entry in body["shortlist"]] == ["api access"]
    assert [task["title"] for task in body["blocked"]] == ["data export"]
    assert body["blocked"][0]["is_blocked"] is True


def test_pinning_promotes_a_task_to_the_top(client: TestClient) -> None:
    add(client, "urgent", importance=5, deadline=dt.date.today().isoformat())
    trivial = add(client, "trivial", importance=1)
    client.put(
        f"/api/tasks/{trivial}/pin",
        json={"date": dt.date.today().isoformat()},
        headers=HEADERS,
    )

    shortlist = client.get("/api/plan/today", headers=HEADERS).json()["shortlist"]

    assert shortlist[0]["task"]["title"] == "trivial"
    assert shortlist[0]["is_pinned"] is True


def test_completing_a_task_removes_it_from_the_plan(client: TestClient) -> None:
    task_id = add(client, "finish me")
    client.post(f"/api/tasks/{task_id}/complete", headers=HEADERS)

    assert client.get("/api/plan/today", headers=HEADERS).json()["shortlist"] == []


def test_backlog_lists_every_active_candidate(client: TestClient) -> None:
    add(client, "first")
    add(client, "second")

    body = client.get("/api/plan/backlog", headers=HEADERS).json()

    assert len(body) == 2
    assert body[0]["rank"] == 1


def test_plan_routes_require_the_shared_secret(client: TestClient) -> None:
    assert client.get("/api/plan/today").status_code == 403
    assert client.get("/api/plan/backlog").status_code == 403
