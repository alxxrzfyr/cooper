"""Prioritisation routes. Read-only."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cadence.api.dependencies import PlanServiceDep
from cadence.api.schemas import TaskResponse
from cadence.core.candidates import RankedTask
from cadence.services.plan_service import DEFAULT_SHORTLIST_SIZE

router = APIRouter(prefix="/api/plan", tags=["plan"])


class ScoreContribution(BaseModel):
    term: str
    normalised: float
    weighted: float


class RankedTaskResponse(BaseModel):
    rank: int
    is_pinned: bool
    score: float
    contributions: list[ScoreContribution]
    task: TaskResponse

    @classmethod
    def of(cls, entry: RankedTask) -> RankedTaskResponse:
        breakdown = entry.breakdown
        normalised = {
            "deadline_pressure": breakdown.deadline_pressure,
            "importance": breakdown.importance,
            "slip_pressure": breakdown.slip_pressure,
            "unblocks": breakdown.unblocks,
            "age": breakdown.age,
        }
        weighted = breakdown.contributions()
        return cls(
            rank=entry.rank,
            is_pinned=entry.is_pinned,
            score=breakdown.total,
            contributions=[
                ScoreContribution(term=term, normalised=value, weighted=weighted[term])
                for term, value in normalised.items()
            ],
            task=TaskResponse.of(entry.task),
        )


class PlanResponse(BaseModel):
    generated_at: dt.datetime
    shortlist: list[RankedTaskResponse]
    backlog: list[RankedTaskResponse]
    blocked: list[TaskResponse]
    degraded: bool


@router.get("/today", response_model=PlanResponse)
def get_today(
    service: PlanServiceDep,
    limit: int = Query(default=DEFAULT_SHORTLIST_SIZE, ge=1, le=50),
) -> PlanResponse:
    plan = service.plan(limit=limit)
    return PlanResponse(
        generated_at=plan.generated_at,
        shortlist=[RankedTaskResponse.of(entry) for entry in plan.shortlist],
        backlog=[RankedTaskResponse.of(entry) for entry in plan.backlog],
        blocked=[TaskResponse.of(task, is_blocked=True) for task in plan.blocked],
        degraded=plan.degraded,
    )


@router.get("/backlog", response_model=list[RankedTaskResponse])
def get_backlog(service: PlanServiceDep) -> list[RankedTaskResponse]:
    return [RankedTaskResponse.of(entry) for entry in service.backlog()]
