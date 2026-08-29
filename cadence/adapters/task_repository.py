"""SQLAlchemy implementation of the task repository port.

Owns the mapping between domain values and rows, including the timezone detail SQLite
forces on us: SQLite has no native aware type, so instants are stored normalised to UTC
and re-tagged as UTC on the way out. Without that, a round trip would silently return
naive datetimes and the domain's own validation would reject them.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session

from cadence.adapters.models import TaskDependencyModel, TaskModel
from cadence.core.tasks import Task, TaskDraft, TaskStatus


def _to_utc(moment: dt.datetime) -> dt.datetime:
    return moment.astimezone(dt.UTC)


def _as_utc(moment: dt.datetime | None) -> dt.datetime | None:
    if moment is None:
        return None
    return moment.replace(tzinfo=dt.UTC) if moment.tzinfo is None else _to_utc(moment)


def _to_domain(row: TaskModel) -> Task:
    created_at = _as_utc(row.created_at)
    assert created_at is not None  # created_at is NOT NULL in the schema
    draft = TaskDraft(
        title=row.title,
        notes=row.notes,
        effort_minutes=row.effort_minutes,
        importance=row.importance,
        deadline=row.deadline,
        earliest_start=_as_utc(row.earliest_start),
        tags=tuple(row.tags or ()),
        allow_split=row.allow_split,
    )
    status: TaskStatus = row.status  # type: ignore[assignment]
    return Task(
        id=row.id,
        draft=draft,
        created_at=created_at,
        status=status,
        slip_count=row.slip_count,
        pinned_for_date=row.pinned_for_date,
        completed_at=_as_utc(row.completed_at),
    )


def _apply(row: TaskModel, task: Task) -> None:
    draft = task.draft
    row.title = draft.title
    row.notes = draft.notes
    row.effort_minutes = draft.effort_minutes
    row.importance = draft.importance
    row.deadline = draft.deadline
    row.earliest_start = _to_utc(draft.earliest_start) if draft.earliest_start else None
    row.tags = list(draft.tags)
    row.allow_split = draft.allow_split
    row.status = task.status
    row.slip_count = task.slip_count
    row.pinned_for_date = task.pinned_for_date
    row.completed_at = _to_utc(task.completed_at) if task.completed_at else None


class SqlAlchemyTaskRepository:
    """Persists tasks in the session's transaction. The caller owns commit."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, task: Task) -> None:
        row = TaskModel(id=task.id, created_at=_to_utc(task.created_at))
        _apply(row, task)
        self._session.add(row)
        self._session.flush()

    def get(self, task_id: str) -> Task | None:
        row = self._session.get(TaskModel, task_id)
        return None if row is None else _to_domain(row)

    def update(self, task: Task) -> None:
        row = self._session.get(TaskModel, task.id)
        if row is None:
            raise KeyError(task.id)
        _apply(row, task)
        self._session.flush()

    def list(self, *, statuses: tuple[TaskStatus, ...] | None = None) -> tuple[Task, ...]:
        statement = select(TaskModel)
        if statuses is not None:
            statement = statement.where(TaskModel.status.in_(statuses))
        statement = statement.order_by(TaskModel.created_at, TaskModel.id)
        return tuple(_to_domain(row) for row in self._session.scalars(statement))

    def blocked_task_ids(self) -> frozenset[str]:
        statement = (
            select(TaskDependencyModel.blocked_id)
            .join(TaskModel, TaskModel.id == TaskDependencyModel.blocker_id)
            .where(TaskModel.status != "done")
        )
        return frozenset(self._session.scalars(statement))

    def dependency_edges(self) -> tuple[tuple[str, str], ...]:
        statement = (
            select(TaskDependencyModel.blocker_id, TaskDependencyModel.blocked_id)
            .join(TaskModel, TaskModel.id == TaskDependencyModel.blocker_id)
            .where(TaskModel.status != "done")
            .order_by(TaskDependencyModel.blocker_id, TaskDependencyModel.blocked_id)
        )
        return tuple((row[0], row[1]) for row in self._session.execute(statement))

    def add_dependency(self, *, blocker_id: str, blocked_id: str) -> None:
        self._session.add(TaskDependencyModel(blocker_id=blocker_id, blocked_id=blocked_id))
        self._session.flush()
