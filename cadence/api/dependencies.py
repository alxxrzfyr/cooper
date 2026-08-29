"""Request-scoped wiring.

One place decides how a service is built, so routes stay thin and tests can swap the
clock or the identifier source without touching HTTP code.
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
from cadence.adapters.task_repository import SqlAlchemyTaskRepository
from cadence.core.scoring import ScoreWeights
from cadence.services.capture_service import CaptureService
from cadence.services.intent_executor import IntentExecutor
from cadence.services.plan_service import PlanService
from cadence.services.task_service import TaskService


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


def get_task_service(session: SessionDep) -> TaskService:
    return TaskService(
        repository=SqlAlchemyTaskRepository(session),
        clock=SystemClock(),
        new_id=new_uuid,
    )


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
    tasks = TaskService(
        repository=SqlAlchemyTaskRepository(session),
        clock=clock,
        new_id=new_uuid,
    )
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
