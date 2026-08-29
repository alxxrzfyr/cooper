"""Snapshotting for the mutation log.

A snapshot is the whole task as plain JSON-safe values. Storing the full before and after
state, rather than a diff, is what makes undo a restore rather than a replay.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping
from typing import Any, cast

from cadence.core.tasks import Task, TaskDraft, TaskStatus


def task_to_snapshot(task: Task) -> dict[str, Any]:
    draft = task.draft
    return {
        "id": task.id,
        "title": draft.title,
        "notes": draft.notes,
        "effort_minutes": draft.effort_minutes,
        "importance": draft.importance,
        "deadline": draft.deadline.isoformat() if draft.deadline else None,
        "earliest_start": draft.earliest_start.isoformat() if draft.earliest_start else None,
        "tags": list(draft.tags),
        "allow_split": draft.allow_split,
        "status": task.status,
        "slip_count": task.slip_count,
        "pinned_for_date": task.pinned_for_date.isoformat() if task.pinned_for_date else None,
        "created_at": task.created_at.isoformat(),
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
    }


def snapshot_to_task(snapshot: Mapping[str, Any]) -> Task:
    draft = TaskDraft(
        title=snapshot["title"],
        notes=snapshot.get("notes"),
        effort_minutes=snapshot.get("effort_minutes"),
        importance=snapshot.get("importance", 3),
        deadline=dt.date.fromisoformat(snapshot["deadline"]) if snapshot.get("deadline") else None,
        earliest_start=(
            dt.datetime.fromisoformat(snapshot["earliest_start"])
            if snapshot.get("earliest_start")
            else None
        ),
        tags=tuple(snapshot.get("tags") or ()),
        allow_split=bool(snapshot.get("allow_split", False)),
    )
    return Task(
        id=snapshot["id"],
        draft=draft,
        created_at=dt.datetime.fromisoformat(snapshot["created_at"]),
        status=cast(TaskStatus, snapshot.get("status", "active")),
        slip_count=snapshot.get("slip_count", 0),
        pinned_for_date=(
            dt.date.fromisoformat(snapshot["pinned_for_date"])
            if snapshot.get("pinned_for_date")
            else None
        ),
        completed_at=(
            dt.datetime.fromisoformat(snapshot["completed_at"])
            if snapshot.get("completed_at")
            else None
        ),
    )
