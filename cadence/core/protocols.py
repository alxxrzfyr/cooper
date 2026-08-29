"""Ports the domain declares and adapters implement.

Declared here so `core` owns its own boundaries. An adapter depends on the domain;
the domain never depends on an adapter.
"""

from __future__ import annotations

import datetime as dt
from typing import Protocol, runtime_checkable

from cadence.core.intents import Intent, IntentContext
from cadence.core.tasks import Task, TaskStatus


@runtime_checkable
class Clock(Protocol):
    """Supplies the current instant, so time is injectable and tests stay deterministic."""

    def now(self) -> dt.datetime: ...


@runtime_checkable
class IdFactory(Protocol):
    """Supplies opaque identifiers."""

    def __call__(self) -> str: ...


@runtime_checkable
class TaskRepository(Protocol):
    """Persistence for tasks and their dependency edges."""

    def add(self, task: Task) -> None: ...

    def get(self, task_id: str) -> Task | None: ...

    def update(self, task: Task) -> None: ...

    def list(self, *, statuses: tuple[TaskStatus, ...] | None = None) -> tuple[Task, ...]: ...

    def blocked_task_ids(self) -> frozenset[str]:
        """IDs of tasks with at least one incomplete blocker."""
        ...

    def dependency_edges(self) -> tuple[tuple[str, str], ...]:
        """All (blocker_id, blocked_id) pairs whose blocker is still incomplete."""
        ...

    def add_dependency(self, *, blocker_id: str, blocked_id: str) -> None: ...


@runtime_checkable
class LLMProvider(Protocol):
    """Translates one user utterance into one validated intent.

    Implementations receive only text the user typed. Passing third-party content,
    including calendar event titles, into this boundary is forbidden.
    """

    name: str

    def compile_intent(self, utterance: str, context: IntentContext) -> Intent: ...
