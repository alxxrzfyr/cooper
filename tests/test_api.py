"""End-to-end tests through the HTTP API.

Exercises the paths a person actually takes: say something, see it ranked, schedule it, undo.
Google is never contacted; the calendar is simply unconfigured in tests, which is a supported
state rather than a special case.
"""

from __future__ import annotations

import datetime as dt
import os
from collections.abc import Iterator
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

KEY = "test-key-that-is-long-enough-x"
os.environ["COOPER_SHARED_KEY"] = KEY
os.environ["COOPER_TIMEZONE"] = "Asia/Singapore"

HEADERS = {"X-Cooper-Key": KEY}


@pytest.fixture
def client(tmp_path, monkeypatch) -> Iterator[TestClient]:
    """A fresh app against a throwaway database."""
    monkeypatch.setenv("COOPER_DATABASE_URL", f"sqlite:///{tmp_path / 'api.db'}")
    import importlib

    import cooper.app as module

    importlib.reload(module)
    with TestClient(module.app) as open_client:
        yield open_client


def say(client: TestClient, text: str) -> dict:
    response = client.post("/api/say", json={"text": text}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


def ask(client: TestClient, text: str) -> dict:
    """The same endpoint in AI mode, which is opt-in per message."""
    response = client.post("/api/say", json={"text": text, "mode": "ai"}, headers=HEADERS)
    assert response.status_code == 200, response.text
    return response.json()


class TestTheTwoModes:
    """Manual is rules only. AI may answer questions. Both must work with no key at all."""

    def test_manual_is_the_default(self, client: TestClient) -> None:
        # No mode in the body at all, so an omitted field cannot silently spend model quota.
        reply = say(client, "write the report, 90m")
        assert reply["source"] == "rules"

    def test_manual_never_calls_the_model(self, client: TestClient, monkeypatch) -> None:
        import cooper.app as module

        monkeypatch.setattr(module.brain, "_key", "pretend-there-is-a-key")
        monkeypatch.setattr(
            module.brain,
            "_generate",
            lambda *args, **kwargs: pytest.fail("manual mode reached the model"),
        )

        assert say(client, "write the report, 90m")["source"] == "rules"

    def test_ai_mode_still_works_with_no_key(self, client: TestClient) -> None:
        # Rule four of the PRD: no key, and everything still functions. AI mode falls back.
        reply = ask(client, "write the report, 90m")
        assert reply["kind"] == "added"
        assert reply["source"] == "rules"

    def test_a_question_in_ai_mode_is_answered(self, client: TestClient, monkeypatch) -> None:
        import cooper.app as module

        say(client, "write the report, 90m, important")
        monkeypatch.setattr(module.brain, "_key", "pretend-there-is-a-key")
        monkeypatch.setattr(
            module.brain, "_generate", lambda prompt, **kwargs: "Start with the report."
        )

        reply = ask(client, "what should I focus on")

        assert reply["kind"] == "answered"
        assert reply["message"] == "Start with the report."

    def test_an_answer_never_changes_anything(self, client: TestClient, monkeypatch) -> None:
        import cooper.app as module

        say(client, "write the report, 90m")
        before = client.get("/api/today", headers=HEADERS).json()
        monkeypatch.setattr(module.brain, "_key", "pretend-there-is-a-key")
        monkeypatch.setattr(module.brain, "_generate", lambda prompt, **kwargs: "One thing open.")

        ask(client, "what is on my plate")

        after = client.get("/api/today", headers=HEADERS).json()
        assert after["shortlist"] == before["shortlist"]
        assert after["undo"] == before["undo"]

    def test_the_prompt_carries_titles_but_never_notes(
        self, client: TestClient, monkeypatch
    ) -> None:
        import cooper.app as module

        added = say(client, "write the report, 90m")
        item = added["view"]["shortlist"][0]
        client.patch(
            f"/api/items/{item['id']}",
            json={"notes": "the CFO hates the current draft"},
            headers=HEADERS,
        )

        seen: list[str] = []
        monkeypatch.setattr(module.brain, "_key", "pretend-there-is-a-key")
        monkeypatch.setattr(
            module.brain,
            "_generate",
            lambda prompt, **kwargs: seen.append(prompt) or "Nothing much.",
        )

        ask(client, "how long is the report")

        assert "write the quarterly report" in seen[0] or "report" in seen[0]
        assert "CFO" not in seen[0], "notes must never leave the machine"

    def test_an_unreachable_model_falls_back_instead_of_failing(
        self, client: TestClient, monkeypatch
    ) -> None:
        import cooper.app as module

        def explode(*args: object, **kwargs: object) -> str:
            raise OSError("no network")

        monkeypatch.setattr(module.brain, "_key", "pretend-there-is-a-key")
        monkeypatch.setattr(module.brain, "_generate", explode)

        reply = ask(client, "what should I do first")

        assert reply["kind"] == "shown"


class TestSecurity:
    def test_health_needs_no_key(self, client: TestClient) -> None:
        assert client.get("/health").status_code == 200

    def test_everything_else_needs_the_key(self, client: TestClient) -> None:
        assert client.get("/api/today").status_code == 403
        assert client.post("/api/say", json={"text": "hi"}).status_code == 403

    def test_a_wrong_key_is_refused(self, client: TestClient) -> None:
        response = client.get("/api/today", headers={"X-Cooper-Key": "nope"})

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
        assert set(shortlist[0]["why"]) == {"due", "age", "quick"}

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

        assert body["kind"] == "completed"
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

        assert body["kind"] == "pinned"
        assert body["view"]["shortlist"][0]["title"] == "trivial thing"

    def test_asking_what_to_do_changes_nothing(self, client: TestClient) -> None:
        say(client, "write the report, 60m")

        body = say(client, "what should i do")

        assert body["kind"] == "shown"
        assert len(body["view"]["shortlist"]) == 1

    def test_an_empty_sentence_is_refused(self, client: TestClient) -> None:
        assert client.post("/api/say", json={"text": ""}, headers=HEADERS).status_code == 422


class TestScheduling:
    def test_a_new_task_is_booked_the_moment_it_is_added(self, client: TestClient) -> None:
        # The old behaviour left it in the shortlist until you remembered to say "plan my day",
        # so you added something, looked at the calendar, and it was not there.
        body = say(client, "write the report, 60m")

        assert body["item"]["start_at"] is not None
        assert [row["title"] for row in body["view"]["scheduled"]] == ["write the report"]

    def test_booked_work_lands_inside_working_hours(self, client: TestClient) -> None:
        say(client, "write the report, 60m")
        say(client, "review the budget, 45m")

        rows = client.get("/api/today", headers=HEADERS).json()["scheduled"]

        assert len(rows) == 2
        hours = client.get("/api/today", headers=HEADERS).json()["hours"]
        for row in rows:
            local = dt.datetime.fromisoformat(row["start_at"]).astimezone(
                ZoneInfo("Asia/Singapore")
            )
            assert hours["start_hour"] <= local.hour < hours["end_hour"]

    def test_scheduling_again_has_nothing_left_to_do(self, client: TestClient) -> None:
        say(client, "write the report, 60m")

        assert client.post("/api/schedule", headers=HEADERS).json()["placed"] == []

    def test_a_task_without_an_estimate_is_not_booked(self, client: TestClient) -> None:
        # PRD: an errand is ranked and shown but never eats a calendar block, because Cooper
        # skips anything with no estimate rather than inventing one. It stays visible under
        # "waiting for a time" on the dashboard, so skipping is no longer silent.
        body = say(client, "buy milk")

        assert body["item"]["minutes"] is None
        assert body["item"]["start_at"] is None

    def test_scheduling_by_sentence_still_works_for_leftovers(self, client: TestClient) -> None:
        # Anything that could not be placed on the way in, because the week was full, is what a
        # scheduling run is for now.
        client.put(
            "/api/hours",
            json={"start_hour": 9, "end_hour": 10, "weekdays": [0], "max_per_day": 1},
            headers=HEADERS,
        )
        say(client, "write the report, 60m")
        client.put(
            "/api/hours",
            json={"start_hour": 9, "end_hour": 18, "weekdays": [0, 1, 2, 3, 4], "max_per_day": 4},
            headers=HEADERS,
        )

        body = say(client, "plan my day")

        assert body["kind"] in ("scheduled", "note")

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
        assert "COOPER_GOOGLE_CLIENT_ID" in response.json()["detail"]

    def test_a_forged_callback_is_refused(self, client: TestClient) -> None:
        response = client.get("/api/google/callback?code=abc&state=forged")

        assert response.status_code == 200
        assert "did not come from Cooper" in response.text

    def test_a_callback_error_is_shown(self, client: TestClient) -> None:
        response = client.get("/api/google/callback?error=access_denied")

        assert "access_denied" in response.text

    def test_everything_works_with_the_calendar_off(self, client: TestClient) -> None:
        # No Google, no key, and a task still gets added, ranked and booked locally.
        body = say(client, "write the report, 60m")

        assert body["item"]["start_at"] is not None
        assert body["item"]["google_event_id"] is None
        assert body["view"]["calendar"]["connected"] is False


class TestTheTwoLists:
    """The plan ranks what is open. The calendar says when. One item, two questions."""

    def test_open_work_is_ranked_whether_or_not_it_is_booked(self, client: TestClient) -> None:
        body = say(client, "write the report, 60m")["view"]

        assert [row["title"] for row in body["shortlist"]] == ["write the report"]
        assert [row["title"] for row in body["scheduled"]] == ["write the report"]

    def test_finishing_it_takes_it_off_both(self, client: TestClient) -> None:
        say(client, "write the report, 60m")

        body = say(client, "done report")["view"]

        assert body["shortlist"] == []
        assert body["scheduled"] == []


class TestAgenda:
    def test_the_view_carries_an_events_list(self, client: TestClient) -> None:
        # Empty with Google off, which is the supported default rather than a special case.
        body = client.get("/api/today", headers=HEADERS).json()

        assert body["events"] == []

    def test_booked_work_appears_with_its_times(self, client: TestClient) -> None:
        say(client, "write the report, 60m")
        client.post("/api/schedule", headers=HEADERS)

        booked = client.get("/api/today", headers=HEADERS).json()["scheduled"]

        assert len(booked) == 1
        assert booked[0]["start_at"] is not None
        assert booked[0]["end_at"] is not None

    def test_a_fixed_event_keeps_the_time_you_said(self, client: TestClient) -> None:
        say(client, "dentist thursday 3pm")

        booked = client.get("/api/today", headers=HEADERS).json()["scheduled"]

        assert booked[0]["kind"] == "event"
        # 15:00 in Asia/Singapore is 07:00 UTC. The offset must survive the round trip.
        assert booked[0]["start_at"].endswith("+00:00")
        import datetime as dt
        from zoneinfo import ZoneInfo

        local = dt.datetime.fromisoformat(booked[0]["start_at"]).astimezone(
            ZoneInfo("Asia/Singapore")
        )
        assert local.hour == 15


class TestManualForm:
    """Requirement 6: Manual mode is a form, so items arrive as fields, never parsed."""

    def form(self, client: TestClient, **fields) -> dict:
        response = client.post("/api/items", json=fields, headers=HEADERS)
        assert response.status_code == 200, response.text
        return response.json()

    def test_a_typed_task_is_created_without_the_model(self, client: TestClient) -> None:
        body = self.form(
            client, title="write the report", minutes=90, importance=4, category="work"
        )

        assert body["source"] == "form"
        assert body["item"]["title"] == "write the report"
        assert body["item"]["minutes"] == 90
        assert body["item"]["importance"] == 4
        assert body["item"]["category"] == "work"

    def test_a_sized_task_is_booked_into_hours_like_a_parsed_one(self, client: TestClient) -> None:
        # The form reuses the same add path, so a typed task lands on the calendar the same way.
        body = self.form(client, title="revise notes", minutes=45)

        assert body["item"]["start_at"] is not None

    def test_an_unsized_task_is_shown_but_not_booked(self, client: TestClient) -> None:
        body = self.form(client, title="buy milk")

        assert body["item"]["minutes"] is None
        assert body["item"]["start_at"] is None

    def test_a_missing_category_is_worked_out_from_the_title(self, client: TestClient) -> None:
        # Rather than force the person to categorise their own errand.
        body = self.form(client, title="revise for the midterm", minutes=60)

        assert body["item"]["category"] == "academics"

    def test_a_form_event_ending_before_it_starts_is_refused(self, client: TestClient) -> None:
        # The same validation the model's output goes through, not a second, looser gate.
        response = client.post(
            "/api/items",
            json={
                "title": "bad meeting",
                "start": "2026-09-01T15:00:00+08:00",
                "end": "2026-09-01T14:00:00+08:00",
            },
            headers=HEADERS,
        )

        assert response.status_code == 422

    def test_a_form_add_can_be_undone(self, client: TestClient) -> None:
        self.form(client, title="scratch task", minutes=30)

        body = client.post("/api/undo", headers=HEADERS).json()

        assert body["kind"] == "undone"


class TestBulk:
    """Requirement 6's other half: bulk verbs that show the list before acting."""

    def test_match_lists_everything_a_phrase_hits_and_writes_nothing(
        self, client: TestClient
    ) -> None:
        say(client, "review the intro")
        say(client, "review the appendix")
        say(client, "buy milk")

        body = client.post("/api/bulk/match", json={"words": "review"}, headers=HEADERS).json()

        assert body["count"] == 2
        titles = {item["title"] for item in body["matched"]}
        assert titles == {"review the intro", "review the appendix"}
        # Matching must not change anything: all three items are still open.
        assert len(client.get("/api/today", headers=HEADERS).json()["shortlist"]) == 3

    def test_bulk_complete_acts_on_the_confirmed_ids(self, client: TestClient) -> None:
        say(client, "review the intro")
        say(client, "review the appendix")
        matched = client.post("/api/bulk/match", json={"words": "review"}, headers=HEADERS).json()[
            "matched"
        ]
        ids = [item["id"] for item in matched]

        body = client.post("/api/bulk", json={"verb": "complete", "ids": ids}, headers=HEADERS)

        assert body.status_code == 200, body.text
        assert body.json()["kind"] == "completed"
        # Both are gone from the open list.
        assert client.get("/api/today", headers=HEADERS).json()["shortlist"] == []

    def test_a_whole_bulk_batch_is_undone_in_one_step(self, client: TestClient) -> None:
        say(client, "review the intro")
        say(client, "review the appendix")
        matched = client.post("/api/bulk/match", json={"words": "review"}, headers=HEADERS).json()[
            "matched"
        ]
        ids = [item["id"] for item in matched]
        client.post("/api/bulk", json={"verb": "drop", "ids": ids}, headers=HEADERS)

        body = client.post("/api/undo", headers=HEADERS).json()

        assert body["kind"] == "undone"
        # Both come back open, because undo is the correction a bulk verb relies on.
        assert len(client.get("/api/today", headers=HEADERS).json()["shortlist"]) == 2

    def test_bulk_ignores_an_id_that_is_no_longer_open(self, client: TestClient) -> None:
        # The confirmation acts on exactly what was shown and quietly skips anything already gone.
        made = say(client, "review the intro")
        real_id = made["item"]["id"]

        body = client.post(
            "/api/bulk", json={"verb": "drop", "ids": [real_id, "missing00id0"]}, headers=HEADERS
        ).json()

        assert body["kind"] == "dropped"
        assert body["chip"] == ["review the intro"]
