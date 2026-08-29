"""The intent vocabulary: the entire output space of the language model.

Anything a provider returns that does not validate against one of these types is
not executed. Pure dataclasses, so validation is testable without a model or a
framework.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from typing import Literal

from cadence.core.errors import DomainValidationError
from cadence.core.tasks import TaskDraft

REASON_MAX_LENGTH = 200
QueryKind = Literal["today", "backlog", "next", "date"]


@dataclasses.dataclass(frozen=True, slots=True)
class IntentContext:
    """What the compiler is allowed to know.

    Deliberately narrow. There is no field capable of carrying calendar text, which
    is what keeps third-party content out of the mutating path.
    """

    today: dt.date
    timezone: str
    recent_task_ids: tuple[str, ...] = ()
    recent_task_titles: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if len(self.recent_task_ids) > 5:
            raise DomainValidationError("at most five recent task references are carried")


@dataclasses.dataclass(frozen=True, slots=True)
class CreateTask:
    draft: TaskDraft


@dataclasses.dataclass(frozen=True, slots=True)
class UpdateTask:
    task_ref: str
    changes: tuple[tuple[str, object], ...]

    def __post_init__(self) -> None:
        if not self.changes:
            raise DomainValidationError("UpdateTask requires at least one change")


@dataclasses.dataclass(frozen=True, slots=True)
class CompleteTask:
    task_ref: str


@dataclasses.dataclass(frozen=True, slots=True)
class DropTask:
    task_ref: str


@dataclasses.dataclass(frozen=True, slots=True)
class PinTask:
    task_ref: str
    date: dt.date | None


@dataclasses.dataclass(frozen=True, slots=True)
class CreateEvent:
    """A fixed commitment. Never ranked and never re-placed by the scheduler."""

    title: str
    start: dt.datetime
    end: dt.datetime

    def __post_init__(self) -> None:
        title = self.title.strip()
        if not title:
            raise DomainValidationError("event title must not be blank")
        object.__setattr__(self, "title", title)
        if self.start.tzinfo is None or self.end.tzinfo is None:
            raise DomainValidationError("event times must carry a timezone")
        if self.end <= self.start:
            raise DomainValidationError("event must end after it starts")


@dataclasses.dataclass(frozen=True, slots=True)
class Query:
    kind: QueryKind
    date: dt.date | None = None

    def __post_init__(self) -> None:
        if self.kind == "date" and self.date is None:
            raise DomainValidationError("a date query requires a date")


@dataclasses.dataclass(frozen=True, slots=True)
class Undo:
    mutation_id: str | None = None


@dataclasses.dataclass(frozen=True, slots=True)
class Clarify:
    """The only honest answer to an ambiguous utterance. Causes no mutation."""

    question: str
    candidates: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.question.strip():
            raise DomainValidationError("a clarification requires a question")


type Intent = (
    CreateTask
    | UpdateTask
    | CompleteTask
    | DropTask
    | PinTask
    | CreateEvent
    | Query
    | Undo
    | Clarify
)

MUTATING_INTENTS = (CreateTask, UpdateTask, CompleteTask, DropTask, PinTask, CreateEvent)


def is_mutating(intent: Intent) -> bool:
    """Whether executing this intent changes stored state."""
    return isinstance(intent, MUTATING_INTENTS)


def intent_kind(intent: Intent) -> str:
    """Stable name used in the mutation log and the parsed chip."""
    return type(intent).__name__
