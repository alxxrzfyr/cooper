"""HTTP request and response shapes.

Pydantic lives at the boundary only. These types translate JSON into domain values and
domain values back into JSON; they hold no rules of their own, so there is exactly one
place a rule can be enforced.
"""

from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, ConfigDict, Field

from cadence.core.tasks import Task, TaskDraft


class TaskCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str
    notes: str | None = None
    effort_minutes: int | None = None
    importance: int = 3
    deadline: dt.date | None = None
    earliest_start: dt.datetime | None = None
    tags: list[str] = Field(default_factory=list)
    allow_split: bool = False

    def to_draft(self) -> TaskDraft:
        return TaskDraft(
            title=self.title,
            notes=self.notes,
            effort_minutes=self.effort_minutes,
            importance=self.importance,
            deadline=self.deadline,
            earliest_start=self.earliest_start,
            tags=tuple(self.tags),
            allow_split=self.allow_split,
        )


class TaskUpdateRequest(BaseModel):
    """Every field optional. Only fields actually supplied are changed."""

    model_config = ConfigDict(extra="forbid")

    title: str | None = None
    notes: str | None = None
    effort_minutes: int | None = None
    importance: int | None = None
    deadline: dt.date | None = None
    earliest_start: dt.datetime | None = None
    tags: list[str] | None = None
    allow_split: bool | None = None

    def changes(self) -> dict[str, object]:
        supplied = self.model_dump(exclude_unset=True)
        if "tags" in supplied and supplied["tags"] is not None:
            supplied["tags"] = tuple(supplied["tags"])
        return supplied


class PinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    date: dt.date | None = None


class TaskResponse(BaseModel):
    id: str
    title: str
    notes: str | None
    effort_minutes: int | None
    importance: int
    deadline: dt.date | None
    earliest_start: dt.datetime | None
    tags: list[str]
    allow_split: bool
    status: str
    slip_count: int
    pinned_for_date: dt.date | None
    created_at: dt.datetime
    completed_at: dt.datetime | None
    is_blocked: bool = False

    @classmethod
    def of(cls, task: Task, *, is_blocked: bool = False) -> TaskResponse:
        draft = task.draft
        return cls(
            id=task.id,
            title=draft.title,
            notes=draft.notes,
            effort_minutes=draft.effort_minutes,
            importance=draft.importance,
            deadline=draft.deadline,
            earliest_start=draft.earliest_start,
            tags=list(draft.tags),
            allow_split=draft.allow_split,
            status=task.status,
            slip_count=task.slip_count,
            pinned_for_date=task.pinned_for_date,
            created_at=task.created_at,
            completed_at=task.completed_at,
            is_blocked=is_blocked,
        )


class DependencyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blocker_id: str
    blocked_id: str
