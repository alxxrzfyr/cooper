"""Request-scoped wiring.

One place decides how every service is built, so routes stay thin and a test can swap the
clock, the identifier source, or a transport without touching HTTP code.
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session, sessionmaker

from cadence.adapters.intent_compiler import BoundedIntentCompiler
from cadence.adapters.mutation_repository import SqlAlchemyMutationRepository
from cadence.adapters.rule_provider import RuleBasedProvider
from cadence.adapters.schedule_repositories import (
    BlockRepository,
    CalendarCacheRepository,
    OutboxRepository,
    SyncStateRepository,
    WindowRepository,
)
from cadence.adapters.task_repository import SqlAlchemyTaskRepository
from cadence.adapters.token_cipher import CredentialStore, TokenCipher
from cadence.core.errors import DomainValidationError
from cadence.core.placement import PlacementRules
from cadence.core.scoring import ScoreWeights
from cadence.services.activity_service import ActivityService
from cadence.services.auth_service import AuthService
from cadence.services.capture_service import CaptureService
from cadence.services.intent_executor import IntentExecutor
from cadence.services.plan_service import PlanService
from cadence.services.schedule_service import ScheduleService
from cadence.services.sync_service import DrainReport, SyncService
from cadence.services.task_service import TaskService
from cadence.services.undo_service import UndoService
from cadence.services.window_service import WindowService


class SystemClock:
    def now(self) -> dt.datetime:
        return dt.datetime.now(tz=dt.UTC)


def new_uuid() -> str:
    return str(uuid.uuid4())


def get_session(request: Request) -> Iterator[Session]:
    """Yield a session and commit it only if the request succeeded."""
    factory: sessionmaker[Session] = request.app.state.session_factory
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


SessionDep = Annotated[Session, Depends(get_session)]


def _tasks(session: Session) -> TaskService:
    return TaskService(
        repository=SqlAlchemyTaskRepository(session),
        clock=SystemClock(),
        new_id=new_uuid,
    )


def get_task_service(session: SessionDep) -> TaskService:
    return _tasks(session)


TaskServiceDep = Annotated[TaskService, Depends(get_task_service)]


def get_plan_service(session: SessionDep, request: Request) -> PlanService:
    weights: ScoreWeights = request.app.state.score_weights
    return PlanService(
        repository=SqlAlchemyTaskRepository(session),
        clock=SystemClock(),
        weights=weights,
    )


PlanServiceDep = Annotated[PlanService, Depends(get_plan_service)]


def get_capture_service(session: SessionDep, request: Request) -> CaptureService:
    settings = request.app.state.settings
    clock = SystemClock()
    tasks = _tasks(session)
    executor = IntentExecutor(
        tasks=tasks,
        mutations=SqlAlchemyMutationRepository(session),
        clock=clock,
        new_id=new_uuid,
    )
    compiler = BoundedIntentCompiler(
        primary=request.app.state.llm_provider,
        fallback=RuleBasedProvider(),
    )
    return CaptureService(
        compiler=compiler,
        executor=executor,
        tasks=tasks,
        clock=clock,
        timezone=settings.timezone,
    )


CaptureDep = Annotated[CaptureService, Depends(get_capture_service)]


def get_window_service(session: SessionDep, request: Request) -> WindowService:
    return WindowService(
        repository=WindowRepository(session),
        new_id=new_uuid,
        default_timezone=request.app.state.settings.timezone,
    )


WindowServiceDep = Annotated[WindowService, Depends(get_window_service)]


def get_schedule_service(session: SessionDep, request: Request) -> ScheduleService:
    settings = request.app.state.settings
    rules: PlacementRules = request.app.state.placement_rules
    return ScheduleService(
        windows=WindowRepository(session),
        blocks=BlockRepository(session),
        outbox=OutboxRepository(session),
        cache=CalendarCacheRepository(session),
        mutations=SqlAlchemyMutationRepository(session),
        clock=SystemClock(),
        new_id=new_uuid,
        write_calendar_id=settings.write_calendar_id,
        rules=rules,
        horizon_days=settings.horizon_days,
    )


ScheduleDep = Annotated[ScheduleService, Depends(get_schedule_service)]


def get_auth_service(session: SessionDep, request: Request) -> AuthService:
    settings = request.app.state.settings
    cipher = TokenCipher(settings.token_encryption_key.get_secret_value())
    return AuthService(
        store=CredentialStore(session, cipher),
        oauth=request.app.state.oauth_client,
        transport=request.app.state.http_transport,
        clock=SystemClock(),
        client_id=settings.google_client_id,
        redirect_uri=settings.google_redirect_uri,
    )


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


class SyncFacade:
    """Wraps SyncService so routes need not know whether a credential exists."""

    def __init__(self, session: Session, request: Request) -> None:
        self._session = session
        self._request = request
        self._settings = request.app.state.settings

    def _service(self) -> SyncService | None:
        auth = get_auth_service(self._session, self._request)
        client = auth.calendar_client()
        if client is None:
            return None
        return SyncService(
            client=client,
            blocks=BlockRepository(self._session),
            outbox=OutboxRepository(self._session),
            cache=CalendarCacheRepository(self._session),
            sync_state=SyncStateRepository(self._session),
            clock=SystemClock(),
            write_calendar_id=self._settings.write_calendar_id,
            busy_calendar_ids=self._settings.busy_calendars(),
        )

    def drain_now(self) -> tuple[DrainReport, int]:
        outbox = OutboxRepository(self._session)
        service = self._service()
        if service is None:
            raise DomainValidationError(
                "Google Calendar is not connected, so queued writes cannot be sent yet."
            )
        report = service.drain_outbox()
        return (report, outbox.count(state="pending"))

    def pull_now(self) -> object:
        service = self._service()
        if service is None:
            raise DomainValidationError("Google Calendar is not connected.")
        return service.pull()


def get_sync_facade(session: SessionDep, request: Request) -> SyncFacade:
    return SyncFacade(session, request)


SyncDep = Annotated[SyncFacade, Depends(get_sync_facade)]


def get_activity_service(session: SessionDep) -> ActivityService:
    return ActivityService(
        mutations=SqlAlchemyMutationRepository(session),
        blocks=BlockRepository(session),
        tasks=SqlAlchemyTaskRepository(session),
        clock=SystemClock(),
    )


ActivityDep = Annotated[ActivityService, Depends(get_activity_service)]


def get_undo_service(session: SessionDep, request: Request) -> UndoService:
    return UndoService(
        mutations=SqlAlchemyMutationRepository(session),
        tasks=_tasks(session),
        blocks=BlockRepository(session),
        outbox=OutboxRepository(session),
        clock=SystemClock(),
        new_id=new_uuid,
        write_calendar_id=request.app.state.settings.write_calendar_id,
    )


UndoDep = Annotated[UndoService, Depends(get_undo_service)]
