"""The job set and its in-process scheduler.

Runs inside the FastAPI process. One user does not need a broker or a worker pool, and adding
either would buy capacity that will never be consumed while adding two failure modes.

Every job is catch-up based and idempotent, so the machine sleeping through a trigger delays
the work rather than losing it.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging

from sqlalchemy.orm import Session, sessionmaker

from cadence.adapters.mutation_repository import SqlAlchemyMutationRepository
from cadence.adapters.schedule_repositories import (
    BlockRepository,
    CalendarCacheRepository,
    OutboxRepository,
    SyncStateRepository,
    WindowRepository,
)
from cadence.adapters.task_repository import SqlAlchemyTaskRepository
from cadence.adapters.token_cipher import CredentialStore, TokenCipher
from cadence.config import Settings
from cadence.services.auth_service import AuthService
from cadence.services.jobs import JobDefinition, JobLedger, JobRunner
from cadence.services.plan_service import PlanService
from cadence.services.schedule_service import ScheduleService
from cadence.services.sync_service import SyncService
from cadence.services.task_service import TaskService

logger = logging.getLogger("cadence.jobs")

TICK_SECONDS = 20


def _clock() -> dt.datetime:
    return dt.datetime.now(tz=dt.UTC)


class SystemClock:
    def now(self) -> dt.datetime:
        return _clock()


def _new_id() -> str:
    import uuid

    return str(uuid.uuid4())


def _auth(session: Session, settings: Settings, transport: object) -> AuthService | None:
    if settings.token_encryption_key is None:
        return None
    cipher = TokenCipher(settings.token_encryption_key.get_secret_value())
    from cadence.adapters.google_calendar import GoogleOAuthClient

    if not settings.google_configured or settings.google_client_secret is None:
        return None
    return AuthService(
        store=CredentialStore(session, cipher),
        oauth=GoogleOAuthClient(
            client_id=str(settings.google_client_id),
            client_secret=settings.google_client_secret.get_secret_value(),
            redirect_uri=settings.google_redirect_uri,
            transport=transport,  # type: ignore[arg-type]
        ),
        transport=transport,  # type: ignore[arg-type]
        clock=SystemClock(),
        client_id=settings.google_client_id,
        redirect_uri=settings.google_redirect_uri,
    )


def _sync(session: Session, settings: Settings, transport: object) -> SyncService | None:
    auth = _auth(session, settings, transport)
    if auth is None:
        return None
    client = auth.calendar_client()
    if client is None:
        return None
    return SyncService(
        client=client,
        blocks=BlockRepository(session),
        outbox=OutboxRepository(session),
        cache=CalendarCacheRepository(session),
        sync_state=SyncStateRepository(session),
        clock=SystemClock(),
        write_calendar_id=settings.write_calendar_id,
        busy_calendar_ids=settings.busy_calendars(),
    )


def build_jobs(
    *,
    factory: sessionmaker[Session],
    settings: Settings,
    transport: object,
) -> tuple[JobDefinition, ...]:
    """Every scheduled job, each opening and committing its own session."""

    def in_session(work: object) -> str:
        session = factory()
        try:
            result = work(session)  # type: ignore[operator]
            session.commit()
            return str(result)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def drain(session: Session) -> str:
        service = _sync(session, settings, transport)
        if service is None:
            return "no calendar"
        report = service.drain_outbox()
        return f"sent {report.sent}, deferred {report.deferred}"

    def poll(session: Session) -> str:
        service = _sync(session, settings, transport)
        if service is None:
            return "no calendar"
        report = service.pull()
        return f"ingested {report.ingested}, moved {report.user_moved}"

    def nightly_plan(session: Session) -> str:
        plan = PlanService(
            repository=SqlAlchemyTaskRepository(session),
            clock=SystemClock(),
            weights=settings.score_weights(),
        )
        schedule = ScheduleService(
            windows=WindowRepository(session),
            blocks=BlockRepository(session),
            outbox=OutboxRepository(session),
            cache=CalendarCacheRepository(session),
            mutations=SqlAlchemyMutationRepository(session),
            clock=SystemClock(),
            new_id=_new_id,
            write_calendar_id=settings.write_calendar_id,
            rules=settings.placement_rules(),
            horizon_days=settings.horizon_days,
        )
        if not WindowRepository(session).list(active_only=True):
            return "no windows"
        outcome = schedule.apply(plan.today(limit=settings.shortlist_size))
        return f"placed {len(outcome.placed)}"

    def day_drift(session: Session) -> str:
        """Release blocks whose time has passed unworked and record the slip.

        This is what addresses plan decay: a task pushed repeatedly climbs the ranking
        instead of quietly rotting.
        """
        now = _clock()
        blocks = BlockRepository(session)
        tasks = TaskService(
            repository=SqlAlchemyTaskRepository(session),
            clock=SystemClock(),
            new_id=_new_id,
        )
        released = 0
        for block in blocks.list(states=("planned", "pushed")):
            if block.interval.end_utc >= now:
                continue
            import dataclasses

            blocks.update(dataclasses.replace(block, state="orphaned"))
            try:
                task = tasks.get_or_raise(block.task_id)
            except Exception:
                continue
            if task.status == "active":
                tasks.replace(task.slipped())
            released += 1
        return f"released {released}"

    def token_health(session: Session) -> str:
        auth = _auth(session, settings, transport)
        if auth is None:
            return "no calendar"
        status = auth.status()
        return "healthy" if status.get("healthy") else "needs attention"

    return (
        JobDefinition(
            name="outbox_drain",
            interval=dt.timedelta(seconds=settings.outbox_drain_interval),
            run=lambda: in_session(drain),
        ),
        JobDefinition(
            name="calendar_poll",
            interval=dt.timedelta(seconds=settings.calendar_poll_interval),
            run=lambda: in_session(poll),
        ),
        JobDefinition(
            name="day_drift_reconcile",
            interval=dt.timedelta(seconds=settings.day_drift_interval),
            run=lambda: in_session(day_drift),
        ),
        JobDefinition(
            name="nightly_plan",
            interval=dt.timedelta(hours=settings.nightly_plan_interval_hours),
            run=lambda: in_session(nightly_plan),
        ),
        JobDefinition(
            name="token_health",
            interval=dt.timedelta(seconds=settings.token_health_interval),
            run=lambda: in_session(token_health),
        ),
    )


async def run_scheduler(
    *,
    factory: sessionmaker[Session],
    settings: Settings,
    transport: object,
    stop: asyncio.Event,
) -> None:
    """Tick until asked to stop, running whatever is overdue.

    The first tick happens immediately, which is the catch-up behaviour: anything missed while
    the machine was asleep runs at startup rather than waiting for its next slot.
    """
    jobs = build_jobs(factory=factory, settings=settings, transport=transport)

    while not stop.is_set():
        session = factory()
        try:
            runner = JobRunner(ledger=JobLedger(session), now=_clock)
            outcomes = runner.run_due(jobs)
            session.commit()
            for name, status in outcomes.items():
                logger.info("job %s: %s", name, status)
        except Exception:
            session.rollback()
            logger.exception("job tick failed")
        finally:
            session.close()

        with contextlib.suppress(TimeoutError, asyncio.TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=TICK_SECONDS)
