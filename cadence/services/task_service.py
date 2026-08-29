"""Task lifecycle orchestration.

Holds no domain rules of its own: validation lives in `core`, persistence lives behind
the repository port. This layer sequences the two and owns the transaction boundary.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from cadence.core.errors import DomainValidationError, TaskNotFoundError
from cadence.core.protocols import Clock, IdFactory, TaskRepository
from cadence.core.tasks import Task, TaskDraft, TaskStatus

_DRAFT_FIELDS = frozenset(TaskDraft.__dataclass_fields__)


class TaskService:
    def __init__(
        self,
        *,
        repository: TaskRepository,
        clock: Clock,
        new_id: IdFactory,
    ) -> None:
        self._repository = repository
        self._clock = clock
        self._new_id = new_id

    def create(self, draft: TaskDraft) -> Task:
        task = Task(id=self._new_id(), draft=draft, created_at=self._clock.now())
        self._repository.add(task)
        return task

    def get_or_raise(self, task_id: str) -> Task:
        task = self._repository.get(task_id)
        if task is None:
            raise TaskNotFoundError(f"no task with id {task_id!r}")
        return task

    def update(self, task_id: str, **changes: object) -> Task:
        unknown = set(changes) - _DRAFT_FIELDS
        if unknown:
            raise DomainValidationError(f"unknown task fields: {', '.join(sorted(unknown))}")

        task = self.get_or_raise(task_id)
        # dataclasses.replace re-runs __post_init__, so an invalid change raises before
        # anything is written.
        revised = task.with_draft(dataclasses.replace(task.draft, **changes))  # type: ignore[arg-type]
        self._repository.update(revised)
        return revised

    def complete(self, task_id: str) -> Task:
        completed = self.get_or_raise(task_id).completed(at=self._clock.now())
        self._repository.update(completed)
        return completed

    def drop(self, task_id: str) -> Task:
        dropped = self.get_or_raise(task_id).dropped()
        self._repository.update(dropped)
        return dropped

    def pin(self, task_id: str, *, for_date: dt.date | None) -> Task:
        pinned = self.get_or_raise(task_id).pinned(for_date=for_date)
        self._repository.update(pinned)
        return pinned

    def replace(self, task: Task) -> Task:
        """Overwrite a task with a known-good state.

        Used by undo to restore a snapshot wholesale. Deliberately not exposed over HTTP:
        callers there go through the validated field-level paths.
        """
        self.get_or_raise(task.id)
        self._repository.update(task)
        return task

    def list(self, *, statuses: tuple[TaskStatus, ...] | None = None) -> tuple[Task, ...]:
        return self._repository.list(statuses=statuses)

    def blocked_task_ids(self) -> frozenset[str]:
        """IDs of tasks held up by at least one incomplete blocker."""
        return self._repository.blocked_task_ids()

    def add_dependency(self, *, blocker_id: str, blocked_id: str) -> None:
        if blocker_id == blocked_id:
            raise DomainValidationError("a task cannot block itself")
        self.get_or_raise(blocker_id)
        self.get_or_raise(blocked_id)
        self._repository.add_dependency(blocker_id=blocker_id, blocked_id=blocked_id)
