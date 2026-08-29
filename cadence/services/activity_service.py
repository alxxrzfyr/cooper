"""Activity feed assembly.

Reads the mutation log and renders it as something a person can audit. Given that autonomy is
full, this feed is the only place the user's oversight lives, so it favours legibility over
completeness: each row says what changed in plain words.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from cadence.adapters.mutation_repository import MutationBatch, MutationRecord, MutationRepository
from cadence.adapters.schedule_repositories import BlockRepository
from cadence.core.protocols import Clock, TaskRepository

OP_LABELS = {
    "insert": "created",
    "update": "updated",
    "complete": "completed",
    "drop": "dropped",
    "pin": "pinned",
    "schedule": "scheduled",
    "release": "released",
}


class ActivityService:
    def __init__(
        self,
        *,
        mutations: MutationRepository,
        blocks: BlockRepository,
        tasks: TaskRepository,
        clock: Clock,
    ) -> None:
        self._mutations = mutations
        self._blocks = blocks
        self._tasks = tasks
        self._clock = clock

    def _titles(self) -> dict[str, str]:
        return {task.id: task.title for task in self._tasks.list()}

    def feed(self, *, limit: int = 25) -> dict[str, Any]:
        titles = self._titles()
        batches = self._mutations.recent_batches(limit=limit)
        today = self._clock.now().date()

        return {
            "digest": self._digest(batches, today=today, titles=titles),
            "batches": [self._render_batch(batch, titles) for batch in batches],
        }

    def _render_batch(self, batch: MutationBatch, titles: dict[str, str]) -> dict[str, Any]:
        return {
            "batch_id": batch.batch_id,
            "ts": batch.ts,
            "actor": batch.actor,
            "intent_kind": batch.intent_kind,
            "size": batch.size,
            "undone": batch.is_undone,
            "mutations": [
                {
                    "id": mutation.id,
                    "op": mutation.op,
                    "entity_type": mutation.entity_type,
                    "entity_id": mutation.entity_id,
                    "label": self._label(mutation, titles),
                    "undone": mutation.is_undone,
                }
                for mutation in batch.mutations
            ],
        }

    def _label(self, mutation: MutationRecord, titles: dict[str, str]) -> str:
        verb = OP_LABELS.get(mutation.op, mutation.op)
        if mutation.entity_type == "task":
            return f"{verb} {titles.get(mutation.entity_id, 'a task')}"

        snapshot = mutation.after or mutation.before or {}
        task_id = str(snapshot.get("task_id", ""))
        title = titles.get(task_id, "a task")
        start = snapshot.get("start_utc")
        if isinstance(start, str):
            when = dt.datetime.fromisoformat(start).astimezone().strftime("%a %H:%M")
            return f"{verb} {title} at {when}"
        return f"{verb} {title}"

    def _digest(
        self,
        batches: tuple[MutationBatch, ...],
        *,
        today: dt.date,
        titles: dict[str, str],
    ) -> dict[str, Any]:
        todays = [batch for batch in batches if batch.ts.astimezone().date() == today]
        scheduled = released = 0
        touched: set[str] = set()

        for batch in todays:
            for mutation in batch.mutations:
                if mutation.op == "schedule":
                    scheduled += 1
                elif mutation.op == "release":
                    released += 1
                if mutation.entity_type == "task":
                    touched.add(mutation.entity_id)
                else:
                    snapshot = mutation.after or mutation.before or {}
                    task_id = snapshot.get("task_id")
                    if isinstance(task_id, str):
                        touched.add(task_id)

        return {
            "date": today,
            "ai_batches": sum(1 for batch in todays if batch.actor == "ai"),
            "user_batches": sum(1 for batch in todays if batch.actor == "user"),
            "blocks_scheduled": scheduled,
            "blocks_released": released,
            "tasks_touched": len(touched & set(titles)),
        }

    def blocks(self, *, days: int = 1) -> list[dict[str, Any]]:
        """Blocks in the coming window, for the timeline."""
        now = self._clock.now()
        start = now - dt.timedelta(hours=12)
        end = now + dt.timedelta(days=days)
        titles = self._titles()

        return [
            {
                "id": block.id,
                "task_id": block.task_id,
                "task_title": titles.get(block.task_id),
                "start_utc": block.interval.start_utc,
                "end_utc": block.interval.end_utc,
                "minutes": block.interval.duration_minutes,
                "state": block.state,
                "google_event_id": block.google_event_id,
            }
            for block in self._blocks.list(
                states=("planned", "pushed", "user_moved"),
                since=start,
                until=end,
            )
        ]
