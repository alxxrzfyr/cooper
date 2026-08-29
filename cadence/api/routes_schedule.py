"""Scheduling and activity routes.

`preview` computes a placement without persisting it, so the user can see what would happen.
`apply` commits blocks and queues calendar writes as one undoable batch.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Query
from pydantic import BaseModel

from cadence.api.dependencies import (
    ActivityDep,
    PlanServiceDep,
    ScheduleDep,
    SyncDep,
    UndoDep,
)
from cadence.core.placement import PlacementResult
from cadence.services.schedule_service import ScheduleOutcome

router = APIRouter(prefix="/api/schedule", tags=["schedule"])
activity_router = APIRouter(prefix="/api/activity", tags=["activity"])


class BlockResponse(BaseModel):
    id: str
    task_id: str
    task_title: str | None = None
    start_utc: dt.datetime
    end_utc: dt.datetime
    minutes: int
    state: str
    google_event_id: str | None


class UnplacedResponse(BaseModel):
    task_id: str
    reason: str


class PlacementResponse(BaseModel):
    blocks: list[BlockResponse]
    unplaced: list[UnplacedResponse]
    scheduled_minutes: int

    @classmethod
    def of(cls, result: PlacementResult, titles: dict[str, str]) -> PlacementResponse:
        return cls(
            blocks=[
                BlockResponse(
                    id=f"{block.task_id}-{block.piece}",
                    task_id=block.task_id,
                    task_title=titles.get(block.task_id),
                    start_utc=block.interval.start_utc,
                    end_utc=block.interval.end_utc,
                    minutes=block.interval.duration_minutes,
                    state="preview",
                    google_event_id=None,
                )
                for block in result.blocks
            ],
            unplaced=[
                UnplacedResponse(task_id=entry.task_id, reason=entry.reason)
                for entry in result.unplaced
            ],
            scheduled_minutes=result.scheduled_minutes,
        )


class ScheduleAppliedResponse(BaseModel):
    batch_id: str
    placed: list[BlockResponse]
    released: int
    unplaced: list[UnplacedResponse]
    scheduled_minutes: int

    @classmethod
    def of(cls, outcome: ScheduleOutcome, titles: dict[str, str]) -> ScheduleAppliedResponse:
        return cls(
            batch_id=outcome.batch_id,
            placed=[
                BlockResponse(
                    id=block.id,
                    task_id=block.task_id,
                    task_title=titles.get(block.task_id),
                    start_utc=block.interval.start_utc,
                    end_utc=block.interval.end_utc,
                    minutes=block.interval.duration_minutes,
                    state=block.state,
                    google_event_id=block.google_event_id,
                )
                for block in outcome.placed
            ],
            released=len(outcome.released),
            unplaced=[
                UnplacedResponse(task_id=entry.task_id, reason=entry.reason)
                for entry in outcome.result.unplaced
            ],
            scheduled_minutes=outcome.scheduled_minutes,
        )


@router.get("/preview", response_model=PlacementResponse)
def preview(
    plan: PlanServiceDep,
    schedule: ScheduleDep,
    limit: int = Query(default=5, ge=1, le=25),
) -> PlacementResponse:
    shortlist = plan.today(limit=limit)
    titles = {entry.task.id: entry.task.title for entry in shortlist}
    return PlacementResponse.of(schedule.plan_blocks(shortlist), titles)


@router.post("/apply", response_model=ScheduleAppliedResponse)
def apply(
    plan: PlanServiceDep,
    schedule: ScheduleDep,
    limit: int = Query(default=5, ge=1, le=25),
) -> ScheduleAppliedResponse:
    shortlist = plan.today(limit=limit)
    titles = {entry.task.id: entry.task.title for entry in shortlist}
    return ScheduleAppliedResponse.of(schedule.apply(shortlist), titles)


class BlocksResponse(BaseModel):
    blocks: list[BlockResponse]


@router.get("/blocks", response_model=BlocksResponse)
def blocks(
    activity: ActivityDep,
    days: int = Query(default=1, ge=1, le=30),
) -> BlocksResponse:
    return BlocksResponse(blocks=[BlockResponse(**entry) for entry in activity.blocks(days=days)])


class DrainResponse(BaseModel):
    sent: int
    failed: int
    deferred: int
    pending: int


@router.post("/drain", response_model=DrainResponse)
def drain(sync: SyncDep) -> DrainResponse:
    """Push queued calendar writes now rather than waiting for the job."""
    report, pending = sync.drain_now()
    return DrainResponse(
        sent=report.sent,
        failed=report.failed,
        deferred=report.deferred,
        pending=pending,
    )


# ------------------------------------------------------------------------- activity


class MutationResponse(BaseModel):
    id: str
    op: str
    entity_type: str
    entity_id: str
    label: str
    undone: bool


class BatchResponse(BaseModel):
    batch_id: str
    ts: dt.datetime
    actor: str
    intent_kind: str
    size: int
    undone: bool
    mutations: list[MutationResponse]


class DigestResponse(BaseModel):
    date: dt.date
    ai_batches: int
    user_batches: int
    blocks_scheduled: int
    blocks_released: int
    tasks_touched: int


class ActivityResponse(BaseModel):
    digest: DigestResponse
    batches: list[BatchResponse]


@activity_router.get("", response_model=ActivityResponse)
def activity(
    service: ActivityDep, limit: int = Query(default=25, ge=1, le=100)
) -> ActivityResponse:
    feed = service.feed(limit=limit)
    return ActivityResponse(
        digest=DigestResponse(**feed["digest"]),
        batches=[
            BatchResponse(
                batch_id=batch["batch_id"],
                ts=batch["ts"],
                actor=batch["actor"],
                intent_kind=batch["intent_kind"],
                size=batch["size"],
                undone=batch["undone"],
                mutations=[MutationResponse(**mutation) for mutation in batch["mutations"]],
            )
            for batch in feed["batches"]
        ],
    )


class UndoBatchResponse(BaseModel):
    batch_id: str
    reversed_count: int
    already_undone: bool
    calendar_corrections: int


@activity_router.post("/{batch_id}/undo", response_model=UndoBatchResponse)
def undo_batch(batch_id: str, service: UndoDep) -> UndoBatchResponse:
    outcome = service.undo_batch(batch_id)
    return UndoBatchResponse(
        batch_id=outcome.batch_id,
        reversed_count=outcome.reversed_count,
        already_undone=outcome.already_undone,
        calendar_corrections=outcome.calendar_corrections,
    )
