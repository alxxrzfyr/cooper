"""End-to-end tests through the HTTP API.

Exercises the paths a person actually takes: say something, see it ranked, schedule it, undo.
Google is never contacted; the calendar is simply unconfigured in tests, which is a supported
state rather than a special case.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

KEY = "test-key-that-is-long-enough-x"
os.environ["CADENCE_SHARED_KEY"] = KEY
os.environ["CADENCE_TIMEZONE"] = "Asia/Singapore"

HEADERS = {"X-Cadence-Key": KEY}


@pytest.fixture
def client(tmp_path, monkeypatch) -> Iterator[TestClient]:
    """A fresh app against a throwaway database."""
    monkeypatch.setenv("CADENCE_DATABASE_URL", f"sqlite:///{tmp_path / 'api.db'}")
    import importlib

    import cadence.app as module

    importlib.reload(module)
    with TestClient(module.app) as open_client:
        yield open_client


def say(client: TestClient, text: str) -> dict:
    response = client.post("/api/say", json={"text": text}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


class TestSecurity:
    def test_health_needs_no_key(self, client: TestClient) -> None:
        assert client.get("/health").status_code == 200

    def test_everything_else_needs_the_key(self, client: TestClient) -> None:
        assert client.get("/api/today").status_code == 403
        assert client.post("/api/say", json={"text": "hi"}).status_code == 403

    def test_a_wrong_key_is_refused(self, client: TestClient) -> None:
        response = client.get("/api/today", headers={"X-Cadence-Key": "nope"})

        assert response.status_code == 403


class TestSaying:
    def test_a_sentence_creates_a_task(self, client: TestClient) -> None:
        body = say(client, "write the quarterly report, 90m, important, due friday")

        assert body["kind"] == "added"
        item = body["item"]
        assert item["title"] == "write the quarterly report"
        assert item["minutes"] == 90
        assert item["importance"] == 4
        assert item["due"] is not None

    def test_a_new_task_appears_on_the_shortlist(self, client: TestClient) -> None:
        say(client, "write the report, 60m")

        shortlist = client.get("/api/today", headers=HEADERS).json()["shortlist"]

        assert [row["title"] for row in shortlist] == ["write the report"]
        assert shortlist[0]["score"] > 0
        assert set(shortlist[0]["why"]) == {"due", "importance", "age", "quick"}

    def test_a_timed_sentence_creates_an_event(self, client: TestClient) -> None:
        body = say(client, "dentist thursday 3pm")

        assert body["item"]["kind"] == "event"
        assert body["item"]["start_at"] is not None

    def test_the_offline_parser_is_used_without_a_key(self, client: TestClient) -> None:
        body = say(client, "write the report")

        assert body["source"] == "rules"
        assert body["view"]["using_model"] is False

    def test_completing_by_partial_title(self, client: TestClient) -> None:
        say(client, "write the quarterly report, 60m")

        body = say(client, "done quarterly")

        assert body["kind"] == "changed"
        assert body["item"]["status"] == "done"
        assert body["view"]["shortlist"] == []

    def test_an_ambiguous_reference_asks_instead_of_guessing(self, client: TestClient) -> None:
        say(client, "design review weekly, 30m")
        say(client, "design review prep, 30m")

        response = client.post("/api/say", json={"text": "done design review"}, headers=HEADERS)

        assert response.status_code == 409
        assert "matches 2 items" in response.json()["detail"]

    def test_an_unknown_reference_asks(self, client: TestClient) -> None:
        say(client, "write the report")

        body = say(client, "done buy a boat")

        assert body["kind"] == "question"

    def test_pinning_moves_a_task_to_the_top(self, client: TestClient) -> None:
        say(client, "urgent thing, 30m, critical, due today")
        say(client, "trivial thing, 30m, someday")

        body = say(client, "pin trivial")

        assert body["kind"] == "changed"
        assert body["view"]["shortlist"][0]["title"] == "trivial thing"

    def test_asking_what_to_do_changes_nothing(self, client: TestClient) -> None:
        say(client, "write the report, 60m")

        body = say(client, "what should i do")

        assert body["kind"] == "shown"
        assert len(body["view"]["shortlist"]) == 1

    def test_an_empty_sentence_is_refused(self, client: TestClient) -> None:
        assert client.post("/api/say", json={"text": ""}, headers=HEADERS).status_code == 422


class TestScheduling:
    def test_scheduling_places_tasks_into_working_hours(self, client: TestClient) -> None:
        say(client, "write the report, 60m")
        say(client, "review the budget, 45m")

        body = client.post("/api/schedule", headers=HEADERS).json()

        assert len(body["placed"]) == 2
        assert all(slot["minutes"] > 0 for slot in body["placed"])
        assert len(body["view"]["scheduled"]) == 2

    def test_a_task_without_an_estimate_is_not_placed(self, client: TestClient) -> None:
        say(client, "vague thing")

        assert client.post("/api/schedule", headers=HEADERS).json()["placed"] == []

    def test_scheduling_by_sentence_works_too(self, client: TestClient) -> None:
        say(client, "write the report, 60m")

        body = say(client, "plan my day")

        assert body["kind"] == "scheduled"
        assert "Placed 1" in body["message"]

    def test_hours_can_be_narrowed(self, client: TestClient) -> None:
        response = client.put(
            "/api/hours",
            json={"start_hour": 9, "end_hour": 11, "weekdays": [0, 1, 2, 3, 4], "max_per_day": 1},
            headers=HEADERS,
        )

        assert response.status_code == 200
        assert response.json()["view"]["hours"]["max_per_day"] == 1

    def test_a_day_that_ends_before_it_starts_is_refused(self, client: TestClient) -> None:
        response = client.put(
            "/api/hours",
            json={"start_hour": 18, "end_hour": 9, "weekdays": [0], "max_per_day": 2},
            headers=HEADERS,
        )

        assert response.status_code == 422

    def test_no_working_days_is_refused(self, client: TestClient) -> None:
        response = client.put(
            "/api/hours",
            json={"start_hour": 9, "end_hour": 18, "weekdays": [], "max_per_day": 2},
            headers=HEADERS,
        )

        assert response.status_code == 422

    def test_a_narrow_cap_limits_what_gets_placed(self, client: TestClient) -> None:
        client.put(
            "/api/hours",
            json={"start_hour": 9, "end_hour": 10, "weekdays": [0], "max_per_day": 1},
            headers=HEADERS,
        )
        for index in range(4):
            say(client, f"task {index}, 30m")

        placed = client.post("/api/schedule", headers=HEADERS).json()["placed"]

        assert len(placed) <= 1


class TestUndo:
    def test_undoing_an_addition_removes_it(self, client: TestClient) -> None:
        say(client, "mistyped thing, 30m")

        body = client.post("/api/undo", headers=HEADERS).json()

        assert body["kind"] == "undone"
        assert body["view"]["shortlist"] == []

    def test_undoing_a_completion_reopens_the_task(self, client: TestClient) -> None:
        say(client, "write the report, 60m")
        say(client, "done report")

        client.post("/api/undo", headers=HEADERS)

        shortlist = client.get("/api/today", headers=HEADERS).json()["shortlist"]
        assert [row["title"] for row in shortlist] == ["write the report"]

    def test_undoing_a_schedule_frees_the_time(self, client: TestClient) -> None:
        say(client, "write the report, 60m")
        client.post("/api/schedule", headers=HEADERS)

        client.post("/api/undo", headers=HEADERS)

        assert client.get("/api/today", headers=HEADERS).json()["scheduled"] == []

    def test_undo_by_sentence_works(self, client: TestClient) -> None:
        say(client, "mistyped thing, 30m")

        body = say(client, "undo")

        assert body["kind"] == "undone"

    def test_undo_with_nothing_to_undo_says_so(self, client: TestClient) -> None:
        assert client.post("/api/undo", headers=HEADERS).json()["kind"] == "note"

    def test_the_view_names_what_undo_would_reverse(self, client: TestClient) -> None:
        say(client, "write the report, 60m")

        assert "write the report" in client.get("/api/today", headers=HEADERS).json()["undo"]


class TestDirectActions:
    def test_an_item_can_be_edited(self, client: TestClient) -> None:
        item_id = say(client, "write the report, 60m")["item"]["id"]

        response = client.patch(
            f"/api/items/{item_id}",
            json={"title": "write the annual report", "minutes": 120},
            headers=HEADERS,
        )

        assert response.status_code == 200
        assert response.json()["item"]["title"] == "write the annual report"
        assert response.json()["item"]["minutes"] == 120

    def test_an_item_can_be_completed_by_id(self, client: TestClient) -> None:
        item_id = say(client, "write the report, 60m")["item"]["id"]

        body = client.post(f"/api/items/{item_id}/complete", headers=HEADERS).json()

        assert body["item"]["status"] == "done"

    def test_an_unknown_item_is_not_found(self, client: TestClient) -> None:
        assert client.patch("/api/items/nope", json={}, headers=HEADERS).status_code == 404

    def test_an_unknown_action_is_not_found(self, client: TestClient) -> None:
        item_id = say(client, "write the report")["item"]["id"]

        assert client.post(f"/api/items/{item_id}/explode", headers=HEADERS).status_code == 404


class TestGoogle:
    def test_the_calendar_reports_itself_as_unconfigured(self, client: TestClient) -> None:
        calendar = client.get("/api/today", headers=HEADERS).json()["calendar"]

        assert calendar["configured"] is False
        assert calendar["connected"] is False

    def test_connecting_without_credentials_explains_what_is_missing(
        self, client: TestClient
    ) -> None:
        response = client.post("/api/google/connect", headers=HEADERS)

        assert response.status_code == 422
        assert "CADENCE_GOOGLE_CLIENT_ID" in response.json()["detail"]

    def test_a_forged_callback_is_refused(self, client: TestClient) -> None:
        response = client.get("/api/google/callback?code=abc&state=forged")

        assert response.status_code == 200
        assert "did not come from Cadence" in response.text

    def test_a_callback_error_is_shown(self, client: TestClient) -> None:
        response = client.get("/api/google/callback?error=access_denied")

        assert "access_denied" in response.text

    def test_everything_works_with_the_calendar_off(self, client: TestClient) -> None:
        say(client, "write the report, 60m")

        placed = client.post("/api/schedule", headers=HEADERS).json()["placed"]

        assert len(placed) == 1


class TestNoDuplication:
    def test_a_booked_task_leaves_the_shortlist(self, client: TestClient) -> None:
        # Showing the same task under both headings made one task look like two.
        say(client, "write the report, 60m")

        body = client.post("/api/schedule", headers=HEADERS).json()["view"]

        assert body["shortlist"] == []
        assert [row["title"] for row in body["scheduled"]] == ["write the report"]

    def test_unbooked_work_stays_on_the_shortlist(self, client: TestClient) -> None:
        say(client, "write the report, 60m")
        say(client, "no estimate so cannot be booked")

        body = client.post("/api/schedule", headers=HEADERS).json()["view"]

        assert [row["title"] for row in body["shortlist"]] == ["no estimate so cannot be booked"]
