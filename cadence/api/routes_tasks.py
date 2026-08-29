"""Task CRUD routes. Validation and serialisation only."""

from __future__ import annotations

from typing import cast, get_args

from fastapi import APIRouter, status

from cadence.api.dependencies import TaskServiceDep
from cadence.api.schemas import (
    DependencyRequest,
    PinRequest,
    TaskCreateRequest,
    TaskResponse,
    TaskUpdateRequest,
)
from cadence.core.errors import DomainValidationError
from cadence.core.tasks import TaskStatus

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

_VALID_STATUSES: frozenset[str] = frozenset(get_args(TaskStatus))


def _parse_statuses(status_filter: str | None) -> tuple[TaskStatus, ...] | None:
    """Turn a comma-separated query value into validated domain statuses."""
    if not status_filter:
        return None
    requested = tuple(value.strip() for value in status_filter.split(",") if value.strip())
    unknown = sorted(set(requested) - _VALID_STATUSES)
    if unknown:
        raise DomainValidationError(f"unknown task status: {', '.join(unknown)}")
    # Membership was just proven against the Literal's own arguments.
    return cast(tuple[TaskStatus, ...], requested)


@router.get("", response_model=list[TaskResponse])
def list_tasks(service: TaskServiceDep, status_filter: str | None = None) -> list[TaskResponse]:
    statuses = _parse_statuses(status_filter)
    blocked = service.blocked_task_ids()
    return [
        TaskResponse.of(task, is_blocked=task.id in blocked)
        for task in service.list(statuses=statuses)
    ]


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreateRequest, service: TaskServiceDep) -> TaskResponse:
    return TaskResponse.of(service.create(payload.to_draft()))


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(task_id: str, service: TaskServiceDep) -> TaskResponse:
    return TaskResponse.of(service.get_or_raise(task_id))


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, payload: TaskUpdateRequest, service: TaskServiceDep) -> TaskResponse:
    return TaskResponse.of(service.update(task_id, **payload.changes()))


@router.post("/{task_id}/complete", response_model=TaskResponse)
def complete_task(task_id: str, service: TaskServiceDep) -> TaskResponse:
    return TaskResponse.of(service.complete(task_id))


@router.post("/{task_id}/drop", response_model=TaskResponse)
def drop_task(task_id: str, service: TaskServiceDep) -> TaskResponse:
    return TaskResponse.of(service.drop(task_id))


@router.put("/{task_id}/pin", response_model=TaskResponse)
def pin_task(task_id: str, payload: PinRequest, service: TaskServiceDep) -> TaskResponse:
    return TaskResponse.of(service.pin(task_id, for_date=payload.date))


@router.post("/dependencies", status_code=status.HTTP_204_NO_CONTENT)
def add_dependency(payload: DependencyRequest, service: TaskServiceDep) -> None:
    service.add_dependency(blocker_id=payload.blocker_id, blocked_id=payload.blocked_id)
