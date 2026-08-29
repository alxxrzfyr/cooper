"""Tests for the parts that would actually go wrong.

Not exhaustive on purpose. These cover sentence parsing, ranking, placement, and the rules that
keep the app from acting on the wrong thing.
"""

from __future__ import annotations

import datetime as dt
import os
from collections.abc import Iterator
from zoneinfo import ZoneInfo

import pytest

os.environ.setdefault("COOPER_SHARED_KEY", "test-key-that-is-long-enough-x")

from cooper import brain  # noqa: E402
from cooper.brain import parse_with_rules  # noqa: E402
from cooper.db import Item, Store, new_id  # noqa: E402
from cooper.planner import Hours, place, rank  # noqa: E402

TZ = "Asia/Singapore"
ZONE = ZoneInfo(TZ)
# A Monday, mid-morning, so weekday tests are stable.
NOW = dt.datetime(2026, 8, 31, 1, 0, tzinfo=dt.UTC)


def read(sentence: str):
    return parse_with_rules(sentence, tz=TZ)


class TestReadingSentences:
    def test_a_plain_sentence_becomes_a_task(self) -> None:
        action = read("write the quarterly report")

        assert action.verb == "add"
        assert action.title == "write the quarterly report"
        assert action.kind == "task"

    @pytest.mark.parametrize(
        ("phrase", "minutes"),
        [("90m", 90), ("2h", 120), ("1.5h", 90), ("45 mins", 45), ("3 hours", 180)],
    )
    def test_effort_is_understood(self, phrase: str, minutes: int) -> None:
        assert read(f"write the report, {phrase}").minutes == minutes

    @pytest.mark.parametrize(
        ("word", "level"),
        [("critical", 5), ("important", 4), ("minor", 2), ("someday", 1)],
    )
    def test_importance_words_are_understood(self, word: str, level: int) -> None:
        assert read(f"write the report, {word}").importance == level

    def test_a_full_sentence_fills_every_field(self) -> None:
        action = read("write the quarterly report, 90m, important, due friday")

        assert action.title == "write the quarterly report"
        assert action.minutes == 90
        assert action.importance == 4
        assert action.due == dt.date(2026, 9, 4)

    def test_a_clock_time_makes_it_an_event(self) -> None:
        action = read("dentist thursday 3pm")

        assert action.kind == "event"
        assert action.title == "dentist"
        assert action.start is not None
        assert action.start.astimezone(ZONE).hour == 15
        assert action.end == action.start + dt.timedelta(minutes=60)

    def test_a_twenty_four_hour_time_works(self) -> None:
        action = read("standup tomorrow 09:30")

        assert action.start is not None
        assert (action.start.astimezone(ZONE).hour, action.start.astimezone(ZONE).minute) == (9, 30)

    def test_an_event_keeps_a_given_length(self) -> None:
        action = read("workshop monday 10am 2h")

        assert action.end is not None and action.start is not None
        assert action.end - action.start == dt.timedelta(hours=2)

    def test_a_day_without_a_time_stays_a_task(self) -> None:
        assert read("call the dentist on thursday").kind == "task"

    @pytest.mark.parametrize("phrase", ["done the report", "finished the report"])
    def test_completion_is_understood(self, phrase: str) -> None:
        action = read(phrase)

        assert action.verb == "complete"
        assert action.which == "the report"

    def test_completion_without_a_target_asks(self) -> None:
        assert read("done").verb == "ask"

    def test_dropping_is_understood(self) -> None:
        assert read("cancel the team offsite").verb == "drop"

    def test_pinning_is_understood(self) -> None:
        action = read("pin the quarterly report")

        assert action.verb == "pin"
        assert action.which == "the quarterly report"

    @pytest.mark.parametrize("phrase", ["what should i do", "what's next", "today", "shortlist"])
    def test_questions_are_recognised(self, phrase: str) -> None:
        assert read(phrase).verb == "show"

    def test_scheduling_is_recognised(self) -> None:
        assert read("plan my day").verb == "schedule"
        assert read("schedule").verb == "schedule"

    def test_undo_is_recognised(self) -> None:
        assert read("undo").verb == "undo"

    def test_an_empty_sentence_asks(self) -> None:
        assert read("   ").verb == "ask"

    def test_parsing_is_repeatable(self) -> None:
        assert read("write the report, 90m") == read("write the report, 90m")


def task(**fields: object) -> Item:
    defaults: dict[str, object] = {
        "id": new_id(),
        "kind": "task",
        "title": "a task",
        "importance": 3,
        "status": "open",
        "pinned": 0,
        "created_at": NOW,
        "minutes": 60,
    }
    return Item(**(defaults | fields))  # type: ignore[arg-type]


class TestRanking:
    def test_an_urgent_task_beats_a_relaxed_one(self) -> None:
        soon = task(title="urgent", due=NOW + dt.timedelta(hours=6), importance=5)
        later = task(title="someday", importance=2)

        assert [entry.item.title for entry in rank([later, soon], at=NOW)] == ["urgent", "someday"]

    def test_a_pinned_task_wins_regardless_of_score(self) -> None:
        urgent = task(title="urgent", due=NOW, importance=5)
        pinned = task(title="pinned", importance=1, pinned=1)

        assert rank([urgent, pinned], at=NOW)[0].item.title == "pinned"

    def test_finished_and_dropped_tasks_are_left_out(self) -> None:
        items = [
            task(title="open"),
            task(title="done", status="done"),
            task(title="gone", status="dropped"),
        ]

        assert [entry.item.title for entry in rank(items, at=NOW)] == ["open"]

    def test_events_are_not_ranked(self) -> None:
        assert rank([task(kind="event", title="dentist")], at=NOW) == []

    def test_every_row_explains_itself(self) -> None:
        entry = rank([task(importance=5, due=NOW)], at=NOW)[0]

        assert set(entry.why) == {"due", "importance", "age", "quick"}
        assert entry.score > 0

    def test_an_overdue_task_saturates_its_urgency(self) -> None:
        overdue = rank([task(due=NOW - dt.timedelta(days=3))], at=NOW)[0]

        assert overdue.why["due"] == 1.0

    def test_ranking_is_stable(self) -> None:
        items = [task(title=name) for name in ("a", "b", "c")]

        assert [e.item.id for e in rank(items, at=NOW)] == [e.item.id for e in rank(items, at=NOW)]


class TestPlacing:
    def hours(self, **overrides: object) -> Hours:
        defaults: dict[str, object] = {
            "start_hour": 9,
            "end_hour": 18,
            "weekdays": (0, 1, 2, 3, 4),
            "timezone": TZ,
            "max_per_day": 4,
        }
        return Hours(**(defaults | overrides))  # type: ignore[arg-type]

    def test_nothing_lands_outside_working_hours(self) -> None:
        ranked = rank([task(title=f"t{i}", minutes=60) for i in range(6)], at=NOW)

        slots = place(ranked, busy=[], hours=self.hours(), at=NOW, days=7)

        assert slots
        for slot in slots:
            local = slot.start.astimezone(ZONE)
            assert 9 <= local.hour < 18
            assert local.weekday() in (0, 1, 2, 3, 4)

    def test_nothing_lands_in_the_past(self) -> None:
        slots = place(rank([task(minutes=30)], at=NOW), busy=[], hours=self.hours(), at=NOW)

        assert all(slot.start >= NOW for slot in slots)

    def test_booked_time_is_avoided(self) -> None:
        # 09:00-12:00 local is 01:00-04:00 UTC.
        busy = [(NOW, NOW + dt.timedelta(hours=3))]

        slots = place(rank([task(minutes=30)], at=NOW), busy=busy, hours=self.hours(), at=NOW)

        assert slots
        for slot in slots:
            assert not (slot.start < busy[0][1] and busy[0][0] < slot.end)

    def test_slots_never_overlap_each_other(self) -> None:
        ranked = rank([task(title=f"t{i}", minutes=45) for i in range(5)], at=NOW)

        slots = place(ranked, busy=[], hours=self.hours(max_per_day=9), at=NOW)

        for first in slots:
            for second in slots:
                if first is not second:
                    assert not (first.start < second.end and second.start < first.end)

    def test_a_daily_cap_is_respected(self) -> None:
        ranked = rank([task(title=f"t{i}", minutes=30) for i in range(10)], at=NOW)

        slots = place(ranked, busy=[], hours=self.hours(max_per_day=2), at=NOW, days=1)

        assert len(slots) <= 2

    def test_a_task_without_an_estimate_is_skipped(self) -> None:
        slots = place(rank([task(minutes=None)], at=NOW), busy=[], hours=self.hours(), at=NOW)

        assert slots == []

    def test_an_already_scheduled_task_is_left_alone(self) -> None:
        booked = task(minutes=60, start_at=NOW, end_at=NOW + dt.timedelta(hours=1))

        assert place(rank([booked], at=NOW), busy=[], hours=self.hours(), at=NOW) == []

    def test_a_long_task_is_capped_to_one_sitting(self) -> None:
        slots = place(rank([task(minutes=600)], at=NOW), busy=[], hours=self.hours(), at=NOW)

        assert slots
        assert slots[0].minutes <= 90

    def test_with_no_working_days_nothing_is_placed(self) -> None:
        slots = place(
            rank([task(minutes=30)], at=NOW),
            busy=[],
            hours=self.hours(weekdays=()),
            at=NOW,
        )

        assert slots == []

    def test_placing_is_repeatable(self) -> None:
        ranked = rank([task(title="a", minutes=30), task(title="b", minutes=30)], at=NOW)

        first = place(ranked, busy=[], hours=self.hours(), at=NOW)
        second = place(ranked, busy=[], hours=self.hours(), at=NOW)

        assert [(s.item_id, s.start) for s in first] == [(s.item_id, s.start) for s in second]


@pytest.fixture
def store(tmp_path) -> Iterator[Store]:
    yield Store(f"sqlite:///{tmp_path / 'test.db'}")


class TestStore:
    def test_settings_round_trip(self, store: Store) -> None:
        store.set_setting("hours", {"start_hour": 8})

        assert store.get_setting("hours") == {"start_hour": 8}

    def test_a_missing_setting_returns_the_default(self, store: Store) -> None:
        assert store.get_setting("nope", "fallback") == "fallback"

    def test_only_open_items_are_listed(self, store: Store) -> None:
        with store.session() as session:
            session.add(task(title="open"))
            session.add(task(title="done", status="done"))

        with store.session() as session:
            assert [item.title for item in store.open_items(session)] == ["open"]

    def test_the_last_change_is_recoverable(self, store: Store) -> None:
        with store.session() as session:
            item = task(title="report")
            session.add(item)
            session.flush()
            store.record(session, label="Added “report”", item=item, before=None)

        with store.session() as session:
            change = store.last_change(session)
            assert change is not None
            assert change.label == "Added “report”"

    def test_history_stays_short(self, store: Store) -> None:
        # This is a one-step undo, not an audit trail, so old entries are pruned.
        with store.session() as session:
            for index in range(30):
                item = task(title=f"t{index}")
                session.add(item)
                session.flush()
                store.record(session, label=f"Added t{index}", item=item, before=None)

        with store.session() as session:
            from sqlalchemy import select

            from cooper.db import Change

            assert len(list(session.scalars(select(Change)))) <= 20

    def test_times_come_back_with_a_timezone(self, store: Store) -> None:
        # SQLite drops offsets, and a naive datetime would break every comparison downstream.
        with store.session() as session:
            session.add(task(title="report", due=NOW))

        with store.session() as session:
            from cooper.db import aware

            stored = store.open_items(session)[0]
            assert aware(stored.due) == NOW


class TestTimezones:
    """The bug this class exists for: a 3pm appointment displaying at 11pm."""

    def test_a_local_time_survives_a_round_trip(self, store: Store) -> None:
        three_pm_local = dt.datetime(2026, 9, 3, 15, 0, tzinfo=ZONE)

        with store.session() as session:
            session.add(task(kind="event", title="dentist", start_at=three_pm_local))

        with store.session() as session:
            stored = store.open_items(session)[0]
            assert stored.start_at is not None
            # Same instant, and still 3pm when read back in the original zone.
            assert stored.start_at == three_pm_local
            assert stored.start_at.astimezone(ZONE).hour == 15

    def test_a_due_date_does_not_slide_to_the_next_day(self, store: Store) -> None:
        end_of_sunday = dt.datetime(2026, 8, 30, 23, 59, tzinfo=ZONE)

        with store.session() as session:
            session.add(task(title="report", due=end_of_sunday))

        with store.session() as session:
            stored = store.open_items(session)[0]
            assert stored.due is not None
            assert stored.due.astimezone(ZONE).date() == dt.date(2026, 8, 30)

    def test_everything_comes_back_as_utc(self, store: Store) -> None:
        with store.session() as session:
            session.add(task(title="report", start_at=dt.datetime(2026, 9, 3, 15, tzinfo=ZONE)))

        with store.session() as session:
            stored = store.open_items(session)[0]
            assert stored.start_at is not None
            assert stored.start_at.tzinfo is not None
            assert stored.start_at.utcoffset() == dt.timedelta(0)

    def test_the_json_shape_carries_the_offset(self, store: Store) -> None:
        with store.session() as session:
            session.add(task(kind="event", start_at=dt.datetime(2026, 9, 3, 15, tzinfo=ZONE)))

        with store.session() as session:
            payload = store.open_items(session)[0].to_dict()
            assert payload["start_at"] is not None
            assert dt.datetime.fromisoformat(payload["start_at"]).astimezone(ZONE).hour == 15


class TestCategory:
    """Colour-coding is only useful if the guess is right more often than not."""

    @pytest.mark.parametrize(
        ("sentence", "expected"),
        [
            ("revise for the midterm", "academics"),
            ("cs101 lecture at 9am", "academics"),
            ("finish the problem set", "academics"),
            ("client meeting about the budget", "work"),
            ("reply to Anna", "work"),
            ("committee rehearsal", "organizations"),
            ("volunteer at the fundraiser", "organizations"),
            ("dentist thursday 3pm", "personal"),
            ("buy groceries", "personal"),
        ],
    )
    def test_words_decide_the_category(self, sentence: str, expected: str) -> None:
        assert brain.guess_category(sentence) == expected

    def test_anything_unrecognised_is_personal(self) -> None:
        # A wrong colour is a small cost; inventing a category is a bigger one.
        assert brain.guess_category("qwerty zzz") == "personal"

    def test_the_rules_path_sets_a_category(self) -> None:
        action = brain.parse_with_rules("revise for the exam, 2h", tz="Asia/Singapore")
        assert action.category == "academics"

    def test_a_category_the_model_invents_is_ignored(self) -> None:
        action = brain._from_json(
            {"verb": "add", "title": "client meeting", "category": "urgent"},
            tz="UTC",
            source="gemini",
        )
        assert action.category == "work"
