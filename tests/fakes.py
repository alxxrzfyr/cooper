"""In-memory fakes used to test services without a database.

Fakes rather than mocks: they implement the same Protocol the real adapter does, so a
test that passes here is testing behaviour and not a recording of calls.
"""

from __future__ import annotations

import datetime as dt
import itertools

from cadence.core.tasks import Task, TaskStatus


class FakeClock:
    def __init__(self, now: dt.datetime) -> None:
        self._now = now

    def now(self) -> dt.datetime:
        return self._now

    def advance(self, delta: dt.timedelta) -> None:
        self._now += delta


class SequentialIds:
    def __init__(self, prefix: str = "id") -> None:
        self._counter = itertools.count(1)
        self._prefix = prefix

    def __call__(self) -> str:
        return f"{self._prefix}-{next(self._counter)}"


class InMemoryTaskRepository:
    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}
        self._dependencies: list[tuple[str, str]] = []

    def add(self, task: Task) -> None:
        self._tasks[task.id] = task

    def get(self, task_id: str) -> Task | None:
        return self._tasks.get(task_id)

    def update(self, task: Task) -> None:
        if task.id not in self._tasks:
            raise KeyError(task.id)
        self._tasks[task.id] = task

    def list(self, *, statuses: tuple[TaskStatus, ...] | None = None) -> tuple[Task, ...]:
        tasks = tuple(self._tasks.values())
        if statuses is not None:
            tasks = tuple(task for task in tasks if task.status in statuses)
        return tuple(sorted(tasks, key=lambda task: (task.created_at, task.id)))

    def blocked_task_ids(self) -> frozenset[str]:
        blocked = set()
        for blocker_id, blocked_id in self._dependencies:
            blocker = self._tasks.get(blocker_id)
            if blocker is not None and blocker.status != "done":
                blocked.add(blocked_id)
        return frozenset(blocked)

    def add_dependency(self, *, blocker_id: str, blocked_id: str) -> None:
        self._dependencies.append((blocker_id, blocked_id))


class ExplodingProvider:
    """A provider that fails if it is called at all.

    Used to prove that ranking and scheduling need no model.
    """

    name = "exploding"

    def compile_intent(self, utterance: str, context: object) -> object:
        raise AssertionError("the model must not be called on this path")
