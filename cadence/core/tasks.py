"""Task domain values.

Pure Python. No ORM, no framework, no I/O. Every rule enforced here is enforced
before anything reaches the database, and every test of these rules runs without
a fixture.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from typing import Literal

from cadence.core.errors import DomainValidationError

TaskStatus = Literal["active", "done", "dropped"]

TITLE_MAX_LENGTH = 500
IMPORTANCE_MIN = 1
IMPORTANCE_MAX = 5


def _normalise_tags(tags: tuple[str, ...]) -> tuple[str, ...]:
    """Lowercase, trim, drop blanks, and deduplicate while preserving order."""
    seen: dict[str, None] = {}
    for tag in tags:
        cleaned = tag.strip().lower()
        if cleaned:
            seen.setdefault(cleaned, None)
    return tuple(seen)


def _require_aware(moment: dt.datetime | None, field: str) -> None:
    if moment is not None and moment.tzinfo is None:
        raise DomainValidationError(f"{field} must carry a timezone")


@dataclasses.dataclass(frozen=True, slots=True)
class TaskDraft:
    """The mutable-by-the-user part of a task, validated on construction."""

    title: str
    notes: str | None = None
    effort_minutes: int | None = None
    importance: int = 3
    deadline: dt.date | None = None
    earliest_start: dt.datetime | None = None
    tags: tuple[str, ...] = ()
    allow_split: bool = False

    def __post_init__(self) -> None:
        title = self.title.strip()
        if not title:
            raise DomainValidationError("title must not be blank")
        if len(title) > TITLE_MAX_LENGTH:
            raise DomainValidationError(f"title must be at most {TITLE_MAX_LENGTH} characters")
        object.__setattr__(self, "title", title)

        if not IMPORTANCE_MIN <= self.importance <= IMPORTANCE_MAX:
            raise DomainValidationError(
                f"importance must be between {IMPORTANCE_MIN} and {IMPORTANCE_MAX}"
            )

        if self.effort_minutes is not None and self.effort_minutes <= 0:
            raise DomainValidationError("effort_minutes must be positive when given")

        _require_aware(self.earliest_start, "earliest_start")

        object.__setattr__(self, "tags", _normalise_tags(self.tags))

        notes = self.notes.strip() if self.notes is not None else None
        object.__setattr__(self, "notes", notes or None)

    def replace(self, **changes: object) -> TaskDraft:
        """Return a revalidated copy with the given fields changed."""
        return dataclasses.replace(self, **changes)  # type: ignore[arg-type]


@dataclasses.dataclass(frozen=True, slots=True)
class Task:
    """A persisted task. State transitions return new instances."""

    id: str
    draft: TaskDraft
    created_at: dt.datetime
    status: TaskStatus = "active"
    slip_count: int = 0
    pinned_for_date: dt.date | None = None
    completed_at: dt.datetime | None = None

    def __post_init__(self) -> None:
        _require_aware(self.created_at, "created_at")
        _require_aware(self.completed_at, "completed_at")
        if self.slip_count < 0:
            raise DomainValidationError("slip_count must not be negative")

    @property
    def title(self) -> str:
        return self.draft.title

    @property
    def is_actionable(self) -> bool:
        """Whether the task can still be worked on."""
        return self.status == "active"

    def completed(self, *, at: dt.datetime) -> Task:
        if self.status == "done":
            raise DomainValidationError("task is already complete")
        _require_aware(at, "completed_at")
        return dataclasses.replace(self, status="done", completed_at=at)

    def dropped(self) -> Task:
        return dataclasses.replace(self, status="dropped", completed_at=None)

    def reopened(self) -> Task:
        return dataclasses.replace(self, status="active", completed_at=None)

    def pinned(self, *, for_date: dt.date | None) -> Task:
        return dataclasses.replace(self, pinned_for_date=for_date)

    def slipped(self) -> Task:
        return dataclasses.replace(self, slip_count=self.slip_count + 1)

    def with_draft(self, draft: TaskDraft) -> Task:
        return dataclasses.replace(self, draft=draft)
