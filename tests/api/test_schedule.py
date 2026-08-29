import datetime as dt
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from cadence.adapters.token_cipher import TokenCipher
from cadence.api.security import SHARED_SECRET_HEADER
from cadence.config import Settings
from cadence.main import create_app

SECRET = "schedule-api-shared-secret-0123456789"
HEADERS = {SHARED_SECRET_HEADER: SECRET}


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    settings = Settings(
        shared_secret=SECRET,
        allowed_hosts=("testserver",),
        database_url=f"sqlite:///{tmp_path / 'schedule.db'}",
        timezone="Asia/Singapore",
        token_encryption_key=TokenCipher.generate_key(),
    )
    with TestClient(create_app(settings, create_schema=True)) as open_client:
        yield open_client


def add_task(client: TestClient, title: str, **payload: object) -> str:
    response = client.post("/api/tasks", json={"title": title} | payload, headers=HEADERS)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def declare_window(client: TestClient, **overrides: object) -> list[dict[str, object]]:
    body = {
        "weekdays": [0, 1, 2, 3, 4],
        "start_local": "09:00:00",
        "end_local": "12:00:00",
        "daily_block_cap": 3,
    } | overrides
    response = client.post("/api/windows", json=body, headers=HEADERS)
    assert response.status_code == 201, response.text
    return list(response.json())


class TestWindows:
    def test_no_windows_exist_initially(self, client: TestClient) -> None:
        assert client.get("/api/windows", headers=HEADERS).json() == []

    def test_declaring_weekday_mornings_creates_one_window_per_day(
        self, client: TestClient
    ) -> None:
        created = declare_window(client)

        assert len(created) == 5
        assert {window["weekday_name"] for window in created} == {
            "Mon",
            "Tue",
            "Wed",
            "Thu",
            "Fri",
        }
        assert all(window["minutes"] == 180 for window in created)

    def test_the_configured_timezone_is_used_by_default(self, client: TestClient) -> None:
        created = declare_window(client, weekdays=[0])

        assert created[0]["timezone"] == "Asia/Singapore"

    def test_a_window_ending_before_it_starts_is_refused(self, client: TestClient) -> None:
        response = client.post(
            "/api/windows",
            json={"weekdays": [0], "start_local": "12:00:00", "end_local": "09:00:00"},
            headers=HEADERS,
        )

        assert response.status_code == 422

    def test_an_out_of_range_cap_is_refused(self, client: TestClient) -> None:
        response = client.post(
            "/api/windows",
            json={
                "weekdays": [0],
                "start_local": "09:00:00",
                "end_local": "12:00:00",
                "daily_block_cap": 0,
            },
            headers=HEADERS,
        )

        assert response.status_code == 422

    def test_a_window_can_be_narrowed(self, client: TestClient) -> None:
        window_id = declare_window(client, weekdays=[0])[0]["id"]

        response = client.patch(
            f"/api/windows/{window_id}",
            json={"end_local": "10:30:00", "daily_block_cap": 1},
            headers=HEADERS,
        )

        assert response.status_code == 200
        assert response.json()["minutes"] == 90
        assert response.json()["daily_block_cap"] == 1

    def test_a_window_can_be_deactivated_without_deleting_it(self, client: TestClient) -> None:
        window_id = declare_window(client, weekdays=[0])[0]["id"]

        client.patch(f"/api/windows/{window_id}", json={"active": False}, headers=HEADERS)

        assert client.get("/api/windows", headers=HEADERS).json()[0]["active"] is False

    def test_a_window_can_be_deleted(self, client: TestClient) -> None:
        window_id = declare_window(client, weekdays=[0])[0]["id"]

        assert client.delete(f"/api/windows/{window_id}", headers=HEADERS).status_code == 204
        assert client.get("/api/windows", headers=HEADERS).json() == []

    def test_deleting_an_unknown_window_is_not_found(self, client: TestClient) -> None:
        assert client.delete("/api/windows/absent", headers=HEADERS).status_code == 404

    def test_window_routes_require_the_shared_secret(self, client: TestClient) -> None:
        assert client.get("/api/windows").status_code == 403


class TestSchedulePreview:
    def test_with_no_windows_nothing_can_be_placed(self, client: TestClient) -> None:
        add_task(client, "write the report", effort_minutes=60)

        body = client.get("/api/schedule/preview", headers=HEADERS).json()

        assert body["blocks"] == []
        assert body["unplaced"][0]["reason"] == "no_room_left"

    def test_a_preview_places_work_without_persisting_it(self, client: TestClient) -> None:
        declare_window(client)
        add_task(client, "write the report", effort_minutes=60)

        body = client.get("/api/schedule/preview", headers=HEADERS).json()

        assert len(body["blocks"]) == 1
        assert body["scheduled_minutes"] == 60
        assert body["blocks"][0]["task_title"] == "write the report"
        # Nothing was stored, so the real blocks list is still empty.
        assert client.get("/api/schedule/blocks", headers=HEADERS).json()["blocks"] == []

    def test_a_task_without_an_estimate_is_reported_with_a_reason(self, client: TestClient) -> None:
        declare_window(client)
        add_task(client, "vague task")

        body = client.get("/api/schedule/preview", headers=HEADERS).json()

        assert body["unplaced"][0]["reason"] == "no_effort_estimate"

    def test_a_task_too_large_for_a_block_is_reported(self, client: TestClient) -> None:
        declare_window(client)
        add_task(client, "enormous project", effort_minutes=600)

        body = client.get("/api/schedule/preview", headers=HEADERS).json()

        assert body["unplaced"][0]["reason"] == "larger_than_any_window_space"


class TestScheduleApply:
    def test_applying_persists_blocks_and_queues_calendar_writes(self, client: TestClient) -> None:
        declare_window(client)
        add_task(client, "write the report", effort_minutes=60)

        body = client.post("/api/schedule/apply", headers=HEADERS).json()

        assert len(body["placed"]) == 1
        assert body["batch_id"]
        blocks = client.get("/api/schedule/blocks?days=14", headers=HEADERS).json()["blocks"]
        assert len(blocks) == 1
        assert blocks[0]["state"] == "planned"

    def test_every_placed_block_falls_inside_the_declared_window(self, client: TestClient) -> None:
        declare_window(client, start_local="09:00:00", end_local="12:00:00")
        for index in range(3):
            add_task(client, f"task {index}", effort_minutes=30)

        body = client.post("/api/schedule/apply?limit=5", headers=HEADERS).json()

        assert body["placed"]
        for block in body["placed"]:
            local = dt.datetime.fromisoformat(block["start_utc"]) + dt.timedelta(hours=8)
            assert 9 <= local.hour < 12

    def test_applying_twice_releases_the_first_plan(self, client: TestClient) -> None:
        declare_window(client)
        add_task(client, "write the report", effort_minutes=60)
        client.post("/api/schedule/apply", headers=HEADERS)

        second = client.post("/api/schedule/apply", headers=HEADERS).json()

        assert second["released"] >= 1
        live = client.get("/api/schedule/blocks?days=14", headers=HEADERS).json()["blocks"]
        assert len(live) == len(second["placed"])

    def test_draining_without_a_connected_calendar_is_refused_clearly(
        self, client: TestClient
    ) -> None:
        declare_window(client)
        add_task(client, "write the report", effort_minutes=60)
        client.post("/api/schedule/apply", headers=HEADERS)

        response = client.post("/api/schedule/drain", headers=HEADERS)

        assert response.status_code == 422
        assert "not connected" in response.json()["detail"]

    def test_schedule_routes_require_the_shared_secret(self, client: TestClient) -> None:
        assert client.post("/api/schedule/apply").status_code == 403


class TestActivity:
    def test_an_empty_log_produces_an_empty_feed(self, client: TestClient) -> None:
        body = client.get("/api/activity", headers=HEADERS).json()

        assert body["batches"] == []
        assert body["digest"]["blocks_scheduled"] == 0

    def test_capture_appears_in_the_feed_attributed_to_the_user(self, client: TestClient) -> None:
        client.post(
            "/api/capture",
            json={"utterance": "write the quarterly report, 2h"},
            headers=HEADERS,
        )

        body = client.get("/api/activity", headers=HEADERS).json()

        assert len(body["batches"]) == 1
        assert body["batches"][0]["actor"] == "user"
        assert "created" in body["batches"][0]["mutations"][0]["label"]

    def test_scheduling_appears_attributed_to_the_ai(self, client: TestClient) -> None:
        declare_window(client)
        add_task(client, "write the report", effort_minutes=60)
        client.post("/api/schedule/apply", headers=HEADERS)

        body = client.get("/api/activity", headers=HEADERS).json()

        ai_batches = [batch for batch in body["batches"] if batch["actor"] == "ai"]
        assert ai_batches
        assert body["digest"]["blocks_scheduled"] >= 1

    def test_a_batch_can_be_undone(self, client: TestClient) -> None:
        declare_window(client)
        add_task(client, "write the report", effort_minutes=60)
        batch_id = client.post("/api/schedule/apply", headers=HEADERS).json()["batch_id"]

        response = client.post(f"/api/activity/{batch_id}/undo", headers=HEADERS)

        assert response.status_code == 200
        assert response.json()["reversed_count"] >= 1
        assert client.get("/api/schedule/blocks?days=14", headers=HEADERS).json()["blocks"] == []

    def test_undoing_a_batch_twice_is_a_no_op(self, client: TestClient) -> None:
        declare_window(client)
        add_task(client, "write the report", effort_minutes=60)
        batch_id = client.post("/api/schedule/apply", headers=HEADERS).json()["batch_id"]
        client.post(f"/api/activity/{batch_id}/undo", headers=HEADERS)

        second = client.post(f"/api/activity/{batch_id}/undo", headers=HEADERS).json()

        assert second["already_undone"] is True
        assert second["reversed_count"] == 0

    def test_undoing_an_unknown_batch_is_not_found(self, client: TestClient) -> None:
        assert client.post("/api/activity/absent/undo", headers=HEADERS).status_code == 404


class TestAuthStatus:
    def test_status_reports_google_as_unconfigured(self, client: TestClient) -> None:
        body = client.get("/api/auth/status", headers=HEADERS).json()

        assert body["configured"] is False
        assert body["connected"] is False
        assert "not configured" in body["hint"]

    def test_starting_authorization_without_configuration_is_refused(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/auth/start", headers=HEADERS)

        assert response.status_code == 422
        assert "CADENCE_GOOGLE_CLIENT_ID" in response.json()["detail"]

    def test_a_callback_with_a_forged_state_is_refused(self, client: TestClient) -> None:
        # Without this check any page could complete an authorization for the user.
        response = client.get(
            "/api/auth/callback?code=abc&state=forged",
            headers=HEADERS,
        )

        assert response.status_code == 403
        assert "did not originate" in response.text

    def test_a_callback_carrying_an_error_explains_itself(self, client: TestClient) -> None:
        response = client.get("/api/auth/callback?error=access_denied", headers=HEADERS)

        assert response.status_code == 400
        assert "access_denied" in response.text

    def test_auth_routes_require_the_shared_secret(self, client: TestClient) -> None:
        assert client.get("/api/auth/status").status_code == 403
