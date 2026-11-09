"""Planning answer semantics need a snapshot, not a running application or database."""

from copy import deepcopy

import pytest

from cooper.answers import answer_planning_intent
from cooper.brain import Brain
from cooper.db import Store


@pytest.fixture(autouse=True)
def no_io(monkeypatch):
    monkeypatch.setattr(Store, "session", lambda *_a, **_k: pytest.fail("Database accessed"))
    monkeypatch.setattr(Brain, "_generate", lambda *_a, **_k: pytest.fail("Model called"))


class TestPlanningAnswerSemantics:
    @pytest.mark.parametrize(
        "case", ["count", "break", "fragmented", "midnight", "unavailable", "gap", "decimal"]
    )
    def test_fit_constraints_are_read_only_and_model_free(self, planning_view, case):
        view = planning_view
        view["hours"] = {
            "timezone": "UTC",
            "start_hour": 10,
            "end_hour": 11,
            "weekdays": list(range(7)),
            "max_per_day": 1,
            "break_minutes": 10,
        }
        view["planning"]["generated_at"] = view["now"]
        view["planning"]["metrics"]["largest_free_block_minutes"] = 60
        question = "Can I fit 30 minutes today?"
        if case in {"count", "break"}:
            view["planning"]["tasks"] = [
                {
                    "id": "existing",
                    "source": "me",
                    "start_at": "2026-09-30T10:00:00Z",
                    "end_at": "2026-09-30T10:30:00Z",
                }
            ]
            if case == "break":
                view["hours"]["max_per_day"] = 4
        elif case == "fragmented":
            view["planning"]["commitments"] = [
                {"start_at": "2026-09-30T10:35:00Z", "end_at": "2026-09-30T10:45:00Z"}
            ]
        elif case == "midnight":
            view["now"] = view["planning"]["generated_at"] = "2026-09-30T23:50:00Z"
            view["hours"].update(start_hour=0, end_hour=0)
        elif case == "unavailable":
            view["planning"]["complete"] = False
        elif case == "gap":
            question = "What is my largest free block today?"
        elif case == "decimal":
            question = "Can I fit 1.5 minutes today?"
        original = deepcopy(view)
        result = answer_planning_intent("fit_duration", question, view)
        assert not result["message"].startswith("Yes.")
        if case == "gap":
            assert "gap metric" in result["message"]
        elif case == "unavailable":
            assert "can’t confirm" in result["message"]
        elif case == "decimal":
            assert "whole minutes" in result["message"]
        else:
            assert "No legal" in result["message"]
        assert view == original

    @pytest.mark.parametrize("limit, expected", [(10, False), (60, True)])
    def test_fit_uses_daily_limit_not_scalar_gap(self, planning_view, limit, expected):
        view = planning_view
        view["hours"] = {
            "timezone": "UTC",
            "start_hour": 0,
            "end_hour": 0,
            "weekdays": list(range(7)),
            "max_minutes_per_day": limit,
        }
        view["planning"]["generated_at"] = view["now"]
        view["planning"]["metrics"]["largest_free_block_minutes"] = 300
        result = answer_planning_intent("fit_duration", "Can I fit 30 minutes today?", view)
        assert result["message"].startswith("Yes.") is expected
        assert "unsaved" in result["message"] if expected else "No legal" in result["message"]
        if expected:
            assert "10:15 AM–10:45 AM" in result["message"]

    @pytest.mark.parametrize(
        "question",
        [
            "Can I fit 30 minutes tomorrow?",
            "Can I fit 30 minutes today or tomorrow?",
            "Can I fit 30 minutes before lunch today?",
        ],
    )
    def test_fit_rejects_unsupported_scope(self, planning_view, question):
        result = answer_planning_intent("fit_duration", question, planning_view)
        assert "today" in result["message"]
        assert not result["message"].startswith("Yes.")
        assert result["facts"] == []

    @pytest.mark.parametrize(
        "focus_key, expected, start", [("now_id", "current", "09:30"), ("next_id", "next", "11:00")]
    )
    def test_current_and_upcoming_commitments(
        self, planning_view, focus_key, expected, start
    ) -> None:
        view = planning_view
        view["planning"]["commitments"] = [
            {
                "id": "meeting",
                "title": "Synthetic meeting",
                "start_at": f"2026-09-30T{start}:00+00:00",
                "end_at": "2026-09-30T12:00:00+00:00",
            }
        ]
        view["planning"]["focus"][focus_key] = "meeting"
        answer = answer_planning_intent("work_next", "What next?", view)
        assert f"Your {expected} commitment" in answer["message"]
        assert "Synthetic meeting" in answer["facts"][0]

    @pytest.mark.parametrize("minutes, estimate", [(90, "90 minutes"), (None, "effort unknown")])
    def test_remaining_discloses_unscheduled_work_without_a_today_deadline(
        self, planning_view, minutes, estimate
    ) -> None:
        view = planning_view
        view["planning"]["tasks"] = [
            {
                "id": "draft",
                "title": "Draft report",
                "start_at": None,
                "minutes": minutes,
                "due": "2026-10-09T18:00:00+00:00",
            }
        ]
        answer = answer_planning_intent("remaining_today", "What is left?", view)
        assert "Draft report" in answer["message"]
        assert "not all due today" in answer["message"]
        assert answer["facts"] == [f"Unscheduled · Draft report · {estimate}"]

    def test_remaining_does_not_duplicate_scheduled_work(self, planning_view) -> None:
        view = planning_view
        view["planning"]["commitments"] = [
            {
                "id": "draft",
                "title": "Draft report",
                "start_at": "2026-09-30T11:00:00+00:00",
                "end_at": "2026-09-30T12:30:00+00:00",
            }
        ]
        view["planning"]["tasks"] = [
            {
                "id": "draft",
                "title": "Draft report",
                "start_at": "2026-09-30T11:00:00+00:00",
                "minutes": 90,
            }
        ]
        answer = answer_planning_intent("remaining_today", "What is left?", view)
        assert len(answer["facts"]) == 1
        assert "Unscheduled" not in answer["message"]

    @pytest.mark.parametrize("complete", [True, False])
    def test_priority_is_not_a_feasibility_claim(self, planning_view, complete) -> None:
        view = planning_view
        view["planning"]["complete"] = complete
        view["planning"]["tasks"] = [
            {
                "id": "draft",
                "title": "Draft report",
                "start_at": None,
                "minutes": 90,
                "importance": 4,
            }
        ]
        if not complete:
            view["planning"]["source_health"] = [{"source": "google", "status": "unavailable"}]
        answer = answer_planning_intent("focus_week", "What should I focus on?", view)
        assert "highest-priority" in answer["message"]
        assert "marked important" in answer["message"]
        if complete:
            assert "not a confirmed time slot" in answer["message"]
        else:
            assert "can't confirm safe placement" in answer["message"]
            assert answer["warnings"] == ["Google calendar is unavailable."]

    def test_empty_calendar_is_not_workload_reassurance(self, planning_view) -> None:
        view = planning_view
        view["planning"]["tasks"] = [
            {"title": "Draft report", "start_at": None, "minutes": 480},
            {"title": "Research", "start_at": None, "minutes": None},
        ]
        answer = answer_planning_intent("overload_check", "Overloaded today?", view)
        assert "not overloaded" not in answer["message"].lower()
        assert "480 estimated minutes" in answer["message"]
        assert "1 task with unknown effort" in answer["message"]
        assert "not necessarily due on this day" in answer["message"]
        assert "capacity" in answer["message"]

    def test_tomorrow_occupancy_merges_overlaps(self, planning_view) -> None:
        view = planning_view
        view["planning"]["commitments"] = [
            {
                "id": "a",
                "title": "First",
                "start_at": "2026-10-01T09:00:00+00:00",
                "end_at": "2026-10-01T10:30:00+00:00",
            },
            {
                "id": "b",
                "title": "Second",
                "start_at": "2026-10-01T10:00:00+00:00",
                "end_at": "2026-10-01T11:00:00+00:00",
            },
        ]
        answer = answer_planning_intent("overload_check", "Overloaded tomorrow?", view)
        assert "Calendar tomorrow" in answer["message"]
        assert "120 minutes" in answer["message"]
        assert "1 overlapping pair" in answer["message"]
        assert "Occupied · 120 minutes" in answer["facts"]

    def test_unavailable_calendar_keeps_the_uncertainty_warning(self, planning_view) -> None:
        view = planning_view
        view["planning"]["complete"] = False
        view["planning"]["source_health"] = [{"source": "icloud", "status": "unavailable"}]
        answer = answer_planning_intent("overload_check", "Overloaded?", view)
        assert "can’t confirm" in answer["message"]
        assert answer["warnings"] == ["Icloud calendar is unavailable."]

    @pytest.mark.parametrize(
        "intent", ["work_next", "focus_week", "remaining_today", "overload_check"]
    )
    @pytest.mark.parametrize("has_work", [False, True])
    def test_answers_are_read_only_and_model_free(self, planning_view, intent, has_work) -> None:
        view = planning_view
        if has_work:
            view["planning"]["tasks"] = [
                {"id": "draft", "title": "Draft report", "start_at": None, "minutes": 90}
            ]
            view["planning"]["focus"]["now_id"] = "draft"
        original = deepcopy(view)
        answer = answer_planning_intent(intent, "What is left?", view)
        assert set(answer) == {"message", "facts", "warnings"}
        assert answer["message"]
        assert view == original
