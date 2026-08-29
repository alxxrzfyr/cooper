"""Wire format for intents.

Decoding is where untrusted model output becomes a domain value, so this is the security
boundary: anything that does not decode cleanly raises and is never executed. The decoder
is deliberately strict and total, with no "best effort" branch.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Mapping
from typing import Any

from cadence.core.errors import DomainValidationError, ProviderError
from cadence.core.intents import (
    Clarify,
    CompleteTask,
    CreateEvent,
    CreateTask,
    DropTask,
    Intent,
    PinTask,
    Query,
    Undo,
    UpdateTask,
)
from cadence.core.tasks import TaskDraft

# The schema handed to a structured-output model. Kept beside the decoder so the two
# cannot drift apart.
INTENT_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["intent"],
    "properties": {
        "intent": {
            "type": "string",
            "enum": [
                "CreateTask",
                "UpdateTask",
                "CompleteTask",
                "DropTask",
                "PinTask",
                "CreateEvent",
                "Query",
                "Undo",
                "Clarify",
            ],
        },
        "title": {"type": "string"},
        "notes": {"type": "string"},
        "effort_minutes": {"type": "integer"},
        "importance": {"type": "integer"},
        "deadline": {"type": "string", "description": "ISO date"},
        "earliest_start": {"type": "string", "description": "ISO datetime with offset"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "task_ref": {"type": "string"},
        "changes": {"type": "object"},
        "start": {"type": "string", "description": "ISO datetime with offset"},
        "end": {"type": "string", "description": "ISO datetime with offset"},
        "date": {"type": "string", "description": "ISO date"},
        "kind": {"type": "string", "enum": ["today", "backlog", "next", "date"]},
        "question": {"type": "string"},
        "candidates": {"type": "array", "items": {"type": "string"}},
        "mutation_id": {"type": "string"},
    },
}

_DRAFT_KEYS = ("title", "notes", "effort_minutes", "importance", "deadline", "tags")


def _require(payload: Mapping[str, Any], key: str) -> Any:
    if key not in payload or payload[key] is None:
        raise ProviderError(f"missing required field {key!r}")
    return payload[key]


def _date(value: Any, field: str) -> dt.date:
    if isinstance(value, dt.date) and not isinstance(value, dt.datetime):
        return value
    if not isinstance(value, str):
        raise ProviderError(f"{field} must be an ISO date string")
    try:
        return dt.date.fromisoformat(value)
    except ValueError as error:
        raise ProviderError(f"{field} is not an ISO date: {value!r}") from error


def _datetime(value: Any, field: str) -> dt.datetime:
    if isinstance(value, dt.datetime):
        moment = value
    elif isinstance(value, str):
        try:
            moment = dt.datetime.fromisoformat(value)
        except ValueError as error:
            raise ProviderError(f"{field} is not an ISO datetime: {value!r}") from error
    else:
        raise ProviderError(f"{field} must be an ISO datetime string")
    if moment.tzinfo is None:
        raise ProviderError(f"{field} must include a timezone offset")
    return moment


def _draft(payload: Mapping[str, Any]) -> TaskDraft:
    tags = payload.get("tags") or ()
    if not isinstance(tags, (list, tuple)):
        raise ProviderError("tags must be an array")
    deadline = payload.get("deadline")
    return TaskDraft(
        title=str(_require(payload, "title")),
        notes=str(payload["notes"]) if payload.get("notes") else None,
        effort_minutes=payload.get("effort_minutes"),
        importance=int(payload.get("importance", 3)),
        deadline=_date(deadline, "deadline") if deadline else None,
        tags=tuple(str(tag) for tag in tags),
    )


def decode_intent(payload: Mapping[str, Any]) -> Intent:
    """Turn a decoded JSON object into a validated intent.

    Raises ProviderError for anything malformed. Domain rule violations surface as
    DomainValidationError, which the caller treats the same way: do not execute.
    """
    kind = _require(payload, "intent")
    if not isinstance(kind, str):
        raise ProviderError("intent must be a string")

    try:
        match kind:
            case "CreateTask":
                return CreateTask(draft=_draft(payload))
            case "UpdateTask":
                raw_changes = payload.get("changes") or {}
                if not isinstance(raw_changes, Mapping):
                    raise ProviderError("changes must be an object")
                allowed = {key: value for key, value in raw_changes.items() if key in _DRAFT_KEYS}
                if "deadline" in allowed and allowed["deadline"]:
                    allowed["deadline"] = _date(allowed["deadline"], "changes.deadline")
                if "tags" in allowed and allowed["tags"] is not None:
                    allowed["tags"] = tuple(str(tag) for tag in allowed["tags"])
                return UpdateTask(
                    task_ref=str(_require(payload, "task_ref")),
                    changes=tuple(sorted(allowed.items())),
                )
            case "CompleteTask":
                return CompleteTask(task_ref=str(_require(payload, "task_ref")))
            case "DropTask":
                return DropTask(task_ref=str(_require(payload, "task_ref")))
            case "PinTask":
                raw_date = payload.get("date")
                return PinTask(
                    task_ref=str(_require(payload, "task_ref")),
                    date=_date(raw_date, "date") if raw_date else None,
                )
            case "CreateEvent":
                return CreateEvent(
                    title=str(_require(payload, "title")),
                    start=_datetime(_require(payload, "start"), "start"),
                    end=_datetime(_require(payload, "end"), "end"),
                )
            case "Query":
                raw_date = payload.get("date")
                query_kind = str(payload.get("kind", "today"))
                if query_kind not in {"today", "backlog", "next", "date"}:
                    raise ProviderError(f"unknown query kind {query_kind!r}")
                return Query(
                    kind=query_kind,  # type: ignore[arg-type]
                    date=_date(raw_date, "date") if raw_date else None,
                )
            case "Undo":
                mutation_id = payload.get("mutation_id")
                return Undo(mutation_id=str(mutation_id) if mutation_id else None)
            case "Clarify":
                candidates = payload.get("candidates") or ()
                return Clarify(
                    question=str(_require(payload, "question")),
                    candidates=tuple(str(candidate) for candidate in candidates),
                )
            case _:
                raise ProviderError(f"unknown intent {kind!r}")
    except DomainValidationError as error:
        raise ProviderError(f"intent violates a domain rule: {error}") from error
    except (TypeError, ValueError) as error:
        raise ProviderError(f"intent could not be decoded: {error}") from error
