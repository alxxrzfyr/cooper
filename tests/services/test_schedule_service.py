import datetime as dt
from collections.abc import Iterator

import pytest
from sqlalchemy.orm import Session

from cadence.adapters.database import Base, build_engine, build_session_factory
from cadence.adapters.mutation_repository import SqlAlchemyMutationRepository
from cadence.adapters.schedule_repositories import (
    BlockRepository,
    CalendarCacheRepository,
    OutboxRepository,
    SyncStateRepository,
    WindowRepository,
)
from cadence.adapters.task_repository import SqlAlchemyTaskRepository
from cadence.core.candidates import rank_tasks
from cadence.core.tasks import TaskDraft
from cadence.core.windows import FocusWindow, Interval
from cadence.services.schedule_service import ScheduleService
from cadence.services.sync_service import SyncService
from cadence.services.task_service import TaskService
from tests.fakes import FakeClock, SequentialIds

UTC = dt.UTC
SG = "Asia/Singapore"
# Sunday 2026-08-30, 16:00 UTC = Monday 00:00 Singapore.
NOW = dt.datetime(2026, 8, 30, 16, 0, tzinfo=UTC)


class FakeCalendarClient:
    """Records calls and can be told to fail, without touching a network."""

    def __init__(self) -> None:
        self.inserted: list[dict[str, object]] = []
        self.deleted: list[str] = []
        self.fail_with: Exception | None = None
        self.pages: list[object] = []

    def insert_block(self, **kwargs: object) -> str:
        if self.fail_with is not None:
            raise self.fail_with
        self.inserted.append(kwargs)
        return str(kwargs["event_id"])

    def update_block(self, **kwargs: object) -> str:
        return str(kwargs["event_id"])

    def delete_block(self, *, calendar_id: str, event_id: str) -> None:
        if self.fail_with is not None:
            raise self.fail_with
        self.deleted.append(event_id)

    def list_events(self, **kwargs: object) -> object:
        if self.fail_with is not None:
            raise self.fail_with
        return self.pages.pop(0)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = build_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with build_session_factory(engine)() as open_session:
        yield open_session


class Harness:
    def __init__(self, session: Session) -> None:
        self.clock = FakeClock(NOW)
        self.windows = WindowRepository(session)
        self.blocks = BlockRepository(session)
        self.outbox = OutboxRepository(session)
        self.cache = CalendarCacheRepository(session)
        self.sync_state = SyncStateRepository(session)
        self.mutations = SqlAlchemyMutationRepository(session)
        self.tasks = TaskService(
            repository=SqlAlchemyTaskRepository(session),
            clock=self.clock,
            new_id=SequentialIds("task"),
        )
        self.schedule = ScheduleService(
            windows=self.windows,
            blocks=self.blocks,
            outbox=self.outbox,
            cache=self.cache,
            mutations=self.mutations,
            clock=self.clock,
            new_id=SequentialIds("id"),
            write_calendar_id="primary",
        )
        self.client = FakeCalendarClient()
        self.sync = SyncService(
            client=self.client,  # type: ignore[arg-type]
            blocks=self.blocks,
            outbox=self.outbox,
            cache=self.cache,
            sync_state=self.sync_state,
            clock=self.clock,
            write_calendar_id="primary",
            busy_calendar_ids=("primary",),
        )

    def declare_morning_window(self, *, cap: int = 3) -> FocusWindow:
        window = FocusWindow(
            id="am",
            weekday=0,
            start_local=dt.time(9, 0),
            end_local=dt.time(12, 0),
            timezone=SG,
            daily_block_cap=cap,
        )
        self.windows.add(window)
        return window

    def shortlist(self):
        return rank_tasks(self.tasks.list(statuses=("active",)), now=self.clock.now())


@pytest.fixture
def harness(session: Session) -> Harness:
    return Harness(session)


class TestScheduling:
    def test_with_no_windows_nothing_is_scheduled(self, harness: Harness) -> None:
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))

        outcome = harness.schedule.apply(harness.shortlist())

        assert outcome.placed == ()
        assert harness.blocks.list() == ()

    def test_a_declared_window_receives_blocks(self, harness: Harness) -> None:
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))

        outcome = harness.schedule.apply(harness.shortlist())

        assert len(outcome.placed) == 1
        assert outcome.scheduled_minutes == 60

    def test_every_block_lands_inside_the_declared_window(self, harness: Harness) -> None:
        window = harness.declare_morning_window()
        for index in range(3):
            harness.tasks.create(TaskDraft(title=f"task {index}", effort_minutes=30))

        outcome = harness.schedule.apply(harness.shortlist())

        assert outcome.placed
        for block in outcome.placed:
            local = block.interval.start_utc.astimezone(window.zone)
            assert 9 <= local.hour < 12

    def test_scheduling_writes_a_mutation_per_block(self, harness: Harness) -> None:
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))

        outcome = harness.schedule.apply(harness.shortlist())

        record = harness.mutations.get(
            harness.mutations.latest().id  # type: ignore[union-attr]
        )
        assert record is not None
        assert record.batch_id == outcome.batch_id
        assert record.actor == "ai"
        assert record.entity_type == "block"

    def test_scheduling_enqueues_a_calendar_write_but_does_not_perform_it(
        self, harness: Harness
    ) -> None:
        # Invariant 7: the Google call never shares a transaction with the database write.
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))

        harness.schedule.apply(harness.shortlist())

        assert harness.outbox.count(state="pending") == 1
        assert harness.client.inserted == []

    def test_busy_calendar_time_is_not_double_booked(self, harness: Harness) -> None:
        harness.declare_morning_window()
        # 09:00-11:00 Singapore is 01:00-03:00 UTC on the Monday.
        harness.cache.upsert(
            google_event_id="ext-1",
            calendar_id="primary",
            title="Someone else's meeting",
            start_utc=dt.datetime(2026, 8, 31, 1, tzinfo=UTC),
            end_utc=dt.datetime(2026, 8, 31, 3, tzinfo=UTC),
            is_app_owned=False,
            has_other_attendees=True,
            updated_at=NOW,
        )
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=45))

        outcome = harness.schedule.apply(harness.shortlist())

        busy = Interval(
            start_utc=dt.datetime(2026, 8, 31, 1, tzinfo=UTC),
            end_utc=dt.datetime(2026, 8, 31, 3, tzinfo=UTC),
        )
        for block in outcome.placed:
            assert not block.interval.overlaps(busy)

    def test_replanning_releases_previously_planned_future_blocks(self, harness: Harness) -> None:
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))
        first = harness.schedule.apply(harness.shortlist())

        second = harness.schedule.apply(harness.shortlist())

        assert len(second.released) == len(first.placed)
        live = [block for block in harness.blocks.list() if block.is_live]
        assert len(live) == len(second.placed)

    def test_a_user_moved_block_is_never_released_by_replanning(self, harness: Harness) -> None:
        import dataclasses

        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))
        outcome = harness.schedule.apply(harness.shortlist())
        moved = dataclasses.replace(outcome.placed[0], state="user_moved")
        harness.blocks.update(moved)

        harness.schedule.apply(harness.shortlist())

        assert harness.blocks.get(moved.id).state == "user_moved"  # type: ignore[union-attr]

    def test_a_task_with_no_estimate_is_reported_rather_than_guessed(
        self, harness: Harness
    ) -> None:
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="vague task"))

        outcome = harness.schedule.apply(harness.shortlist())

        assert outcome.placed == ()
        assert outcome.result.unplaced[0].reason == "no_effort_estimate"

    def test_planning_is_a_preview_that_persists_nothing(self, harness: Harness) -> None:
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))

        result = harness.schedule.plan_blocks(harness.shortlist())

        assert result.blocks
        assert harness.blocks.list() == ()
        assert harness.outbox.count(state="pending") == 0


class TestOutboxDrain:
    def setup_block(self, harness: Harness) -> None:
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))
        harness.schedule.apply(harness.shortlist())

    def test_draining_pushes_the_block_to_the_calendar(self, harness: Harness) -> None:
        self.setup_block(harness)

        report = harness.sync.drain_outbox()

        assert report.sent == 1
        assert len(harness.client.inserted) == 1
        assert harness.outbox.count(state="pending") == 0

    def test_a_pushed_block_records_its_event_id(self, harness: Harness) -> None:
        self.setup_block(harness)

        harness.sync.drain_outbox()

        block = harness.blocks.list(states=("pushed",))[0]
        assert block.google_event_id is not None
        assert block.state == "pushed"

    def test_the_ownership_tag_is_sent_with_the_insert(self, harness: Harness) -> None:
        self.setup_block(harness)

        harness.sync.drain_outbox()

        assert harness.client.inserted[0]["block_id"]

    def test_a_transient_failure_is_retried_later_not_dropped(self, harness: Harness) -> None:
        from cadence.core.errors import ProviderError

        self.setup_block(harness)
        harness.client.fail_with = ProviderError("Google returned HTTP 503")

        report = harness.sync.drain_outbox()

        assert report.deferred == 1
        assert harness.outbox.count(state="pending") == 1
        assert harness.outbox.count(state="failed") == 0

    def test_repeated_failure_eventually_gives_up(self, harness: Harness) -> None:
        from cadence.core.errors import ProviderError

        self.setup_block(harness)
        harness.client.fail_with = ProviderError("Google returned HTTP 500")

        for _ in range(6):
            harness.clock.advance(dt.timedelta(hours=1))
            harness.sync.drain_outbox()

        assert harness.outbox.count(state="failed") == 1

    def test_quota_exhaustion_defers_rather_than_failing(self, harness: Harness) -> None:
        from cadence.core.errors import QuotaExhaustedError

        self.setup_block(harness)
        harness.client.fail_with = QuotaExhaustedError("slow down")

        report = harness.sync.drain_outbox()

        assert report.deferred == 1

    def test_a_released_block_is_not_projected(self, harness: Harness) -> None:
        import dataclasses

        self.setup_block(harness)
        block = harness.blocks.list()[0]
        harness.blocks.update(dataclasses.replace(block, state="orphaned"))

        report = harness.sync.drain_outbox()

        assert report.sent == 1
        assert harness.client.inserted == []

    def test_draining_an_empty_outbox_is_harmless(self, harness: Harness) -> None:
        assert harness.sync.drain_outbox() == harness.sync.drain_outbox()


class TestCalendarPull:
    def scrubbed(self, **overrides: object):
        from cadence.adapters.google_calendar import ScrubbedEvent

        defaults: dict[str, object] = {
            "google_event_id": "evt-1",
            "calendar_id": "primary",
            "title": "Someone else's meeting",
            "start_utc": dt.datetime(2026, 8, 31, 5, tzinfo=UTC),
            "end_utc": dt.datetime(2026, 8, 31, 6, tzinfo=UTC),
            "is_app_owned": False,
            "has_other_attendees": True,
            "updated_at": NOW,
        }
        return ScrubbedEvent(**(defaults | overrides))  # type: ignore[arg-type]

    def page(self, *events: object, token: str | None = "sync-1"):
        from cadence.adapters.google_calendar import CalendarPage

        return CalendarPage(events=tuple(events), next_sync_token=token)  # type: ignore[arg-type]

    def test_an_external_event_becomes_busy_time(self, harness: Harness) -> None:
        harness.client.pages = [self.page(self.scrubbed())]

        report = harness.sync.pull()

        assert report.ingested == 1
        busy = harness.cache.busy_intervals(
            start=dt.datetime(2026, 8, 31, tzinfo=UTC),
            end=dt.datetime(2026, 9, 1, tzinfo=UTC),
        )
        assert len(busy) == 1

    def test_the_sync_token_is_stored_for_the_next_read(self, harness: Harness) -> None:
        harness.client.pages = [self.page(token="sync-42")]

        harness.sync.pull()

        assert harness.sync_state.token_for("primary") == "sync-42"

    def test_an_expired_token_triggers_one_full_resync(self, harness: Harness) -> None:
        from cadence.adapters.google_calendar import CalendarSyncTokenExpired

        harness.sync_state.save_token("primary", "stale", at=NOW)

        calls = {"n": 0}
        original_pages = [self.page(self.scrubbed(), token="fresh")]

        def list_events(**kwargs: object):
            calls["n"] += 1
            if calls["n"] == 1:
                raise CalendarSyncTokenExpired("gone")
            return original_pages.pop(0)

        harness.client.list_events = list_events  # type: ignore[assignment]

        report = harness.sync.pull()

        assert report.full_resync is True
        assert harness.sync_state.token_for("primary") == "fresh"

    def test_a_block_the_user_dragged_is_adopted_and_marked_user_moved(
        self, harness: Harness
    ) -> None:
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))
        harness.schedule.apply(harness.shortlist())
        harness.sync.drain_outbox()
        block = harness.blocks.list(states=("pushed",))[0]

        moved_start = block.interval.start_utc + dt.timedelta(hours=2)
        harness.client.pages = [
            self.page(
                self.scrubbed(
                    google_event_id=block.google_event_id,
                    is_app_owned=True,
                    cadence_block_id=block.id,
                    has_other_attendees=False,
                    start_utc=moved_start,
                    end_utc=moved_start + dt.timedelta(hours=1),
                )
            )
        ]

        report = harness.sync.pull()

        assert report.user_moved == 1
        updated = harness.blocks.get(block.id)
        assert updated is not None
        assert updated.state == "user_moved"
        assert updated.interval.start_utc == moved_start

    def test_a_block_the_user_deleted_becomes_orphaned(self, harness: Harness) -> None:
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))
        harness.schedule.apply(harness.shortlist())
        harness.sync.drain_outbox()
        block = harness.blocks.list(states=("pushed",))[0]

        harness.client.pages = [
            self.page(
                self.scrubbed(
                    google_event_id=block.google_event_id,
                    is_app_owned=True,
                    cadence_block_id=block.id,
                    cancelled=True,
                )
            )
        ]

        report = harness.sync.pull()

        assert report.orphaned == 1
        assert harness.blocks.get(block.id).state == "orphaned"  # type: ignore[union-attr]

    def test_an_unchanged_app_block_is_not_marked_moved(self, harness: Harness) -> None:
        harness.declare_morning_window()
        harness.tasks.create(TaskDraft(title="write the report", effort_minutes=60))
        harness.schedule.apply(harness.shortlist())
        harness.sync.drain_outbox()
        block = harness.blocks.list(states=("pushed",))[0]

        harness.client.pages = [
            self.page(
                self.scrubbed(
                    google_event_id=block.google_event_id,
                    is_app_owned=True,
                    cadence_block_id=block.id,
                    start_utc=block.interval.start_utc,
                    end_utc=block.interval.end_utc,
                )
            )
        ]

        report = harness.sync.pull()

        assert report.user_moved == 0
        assert harness.blocks.get(block.id).state == "pushed"  # type: ignore[union-attr]

    def test_app_owned_events_are_excluded_from_external_busy_time(self, harness: Harness) -> None:
        # Counting our own blocks as somebody else's meeting would make the scheduler
        # believe its own plan was an immovable commitment.
        harness.client.pages = [
            self.page(self.scrubbed(is_app_owned=True, cadence_block_id="block-x"))
        ]
        harness.sync.pull()

        busy = harness.cache.busy_intervals(
            start=dt.datetime(2026, 8, 31, tzinfo=UTC),
            end=dt.datetime(2026, 9, 1, tzinfo=UTC),
        )
        assert busy == ()
