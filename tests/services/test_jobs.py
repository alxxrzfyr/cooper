import datetime as dt
from collections.abc import Iterator

import pytest
from sqlalchemy.orm import Session

from cadence.adapters.database import Base, build_engine, build_session_factory
from cadence.services.jobs import JobDefinition, JobLedger, JobRunner

UTC = dt.UTC
NOW = dt.datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


class MovableClock:
    def __init__(self, now: dt.datetime) -> None:
        self.value = now

    def __call__(self) -> dt.datetime:
        return self.value

    def advance(self, delta: dt.timedelta) -> None:
        self.value += delta


@pytest.fixture
def session() -> Iterator[Session]:
    engine = build_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with build_session_factory(engine)() as open_session:
        yield open_session


def counting_job(name: str, interval: dt.timedelta, counter: dict[str, int]) -> JobDefinition:
    def run() -> str:
        counter[name] = counter.get(name, 0) + 1
        return "ok"

    return JobDefinition(name=name, interval=interval, run=run)


def test_a_never_run_job_is_due(session: Session) -> None:
    runner = JobRunner(ledger=JobLedger(session), now=MovableClock(NOW))
    job = counting_job("nightly_plan", dt.timedelta(days=1), {})

    assert runner.is_due(job) is True


def test_a_recently_run_job_is_not_due(session: Session) -> None:
    clock = MovableClock(NOW)
    ledger = JobLedger(session)
    runner = JobRunner(ledger=ledger, now=clock)
    job = counting_job("nightly_plan", dt.timedelta(days=1), {})
    runner.run_due((job,))

    assert runner.is_due(job) is False


def test_an_overdue_job_runs_at_the_next_opportunity(session: Session) -> None:
    # The whole point: the laptop was asleep at 03:00, so the job runs when it wakes.
    clock = MovableClock(NOW)
    counter: dict[str, int] = {}
    runner = JobRunner(ledger=JobLedger(session), now=clock)
    job = counting_job("nightly_plan", dt.timedelta(days=1), counter)
    runner.run_due((job,))
    assert counter["nightly_plan"] == 1

    clock.advance(dt.timedelta(days=3))
    runner.run_due((job,))

    assert counter["nightly_plan"] == 2


def test_a_job_not_yet_due_is_skipped(session: Session) -> None:
    clock = MovableClock(NOW)
    counter: dict[str, int] = {}
    runner = JobRunner(ledger=JobLedger(session), now=clock)
    job = counting_job("calendar_poll", dt.timedelta(minutes=5), counter)
    runner.run_due((job,))

    clock.advance(dt.timedelta(minutes=1))
    runner.run_due((job,))

    assert counter["calendar_poll"] == 1


def test_running_twice_in_a_row_does_not_double_execute(session: Session) -> None:
    clock = MovableClock(NOW)
    counter: dict[str, int] = {}
    runner = JobRunner(ledger=JobLedger(session), now=clock)
    job = counting_job("outbox_drain", dt.timedelta(seconds=30), counter)

    runner.run_due((job,))
    runner.run_due((job,))

    assert counter["outbox_drain"] == 1


def test_one_failing_job_does_not_stop_the_others(session: Session) -> None:
    counter: dict[str, int] = {}
    runner = JobRunner(ledger=JobLedger(session), now=MovableClock(NOW))

    def explode() -> str:
        raise RuntimeError("calendar unreachable")

    failing = JobDefinition(name="calendar_poll", interval=dt.timedelta(minutes=5), run=explode)
    healthy = counting_job("nightly_plan", dt.timedelta(days=1), counter)

    outcomes = runner.run_due((failing, healthy))

    assert "error" in outcomes["calendar_poll"]
    assert outcomes["nightly_plan"] == "ok"
    assert counter["nightly_plan"] == 1


def test_a_failure_is_recorded_so_it_is_visible(session: Session) -> None:
    ledger = JobLedger(session)
    runner = JobRunner(ledger=ledger, now=MovableClock(NOW))

    def explode() -> str:
        raise RuntimeError("boom")

    runner.run_due(
        (JobDefinition(name="token_health", interval=dt.timedelta(hours=1), run=explode),)
    )

    last, status = ledger.status("token_health")
    assert last == NOW
    assert status is not None
    assert "error" in status


def test_a_failed_job_becomes_due_again_after_its_interval(session: Session) -> None:
    clock = MovableClock(NOW)
    ledger = JobLedger(session)
    runner = JobRunner(ledger=ledger, now=clock)
    attempts = {"n": 0}

    def flaky() -> str:
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise RuntimeError("transient")
        return "ok"

    job = JobDefinition(name="calendar_poll", interval=dt.timedelta(minutes=5), run=flaky)
    runner.run_due((job,))
    clock.advance(dt.timedelta(minutes=6))
    outcomes = runner.run_due((job,))

    assert attempts["n"] == 2
    assert outcomes["calendar_poll"] == "ok"


def test_force_runs_regardless_of_schedule(session: Session) -> None:
    counter: dict[str, int] = {}
    runner = JobRunner(ledger=JobLedger(session), now=MovableClock(NOW))
    job = counting_job("calendar_poll", dt.timedelta(days=7), counter)
    runner.run_due((job,))

    runner.force(job)

    assert counter["calendar_poll"] == 2


def test_statuses_report_every_job_for_the_interface(session: Session) -> None:
    clock = MovableClock(NOW)
    runner = JobRunner(ledger=JobLedger(session), now=clock)
    jobs = (
        counting_job("outbox_drain", dt.timedelta(seconds=30), {}),
        counting_job("nightly_plan", dt.timedelta(days=1), {}),
    )
    runner.run_due(jobs)

    statuses = {status.name: status for status in runner.statuses(jobs)}

    assert statuses["outbox_drain"].last_run_at == NOW
    assert statuses["outbox_drain"].due is False
    assert statuses["nightly_plan"].last_status == "ok"


def test_a_non_positive_interval_is_rejected() -> None:
    with pytest.raises(ValueError, match="positive"):
        JobDefinition(name="bad", interval=dt.timedelta(0), run=lambda: "ok")
