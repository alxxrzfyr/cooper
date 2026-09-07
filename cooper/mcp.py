"""MCP tool descriptions and request validation for Cooper."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError


class AvailabilityArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    days: int = Field(default=7, ge=1, le=31)


class GmailArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    refresh: bool = True


class PlanArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_ids: list[str] = Field(default_factory=list, max_length=50)
    days: int = Field(default=7, ge=1, le=14)


class ApplyPlanArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_ids: list[str] = Field(min_length=1, max_length=50)
    days: int = Field(default=7, ge=1, le=14)
    confirmed: Literal[True]


ARGUMENTS = {
    "calendar_availability": AvailabilityArgs,
    "gmail_confirmations": GmailArgs,
    "plan_tasks": PlanArgs,
    "apply_plan": ApplyPlanArgs,
}


TOOLS: list[dict[str, Any]] = [
    {
        "name": "calendar_availability",
        "description": "Read busy periods and working hours without revealing calendar titles.",
        "inputSchema": AvailabilityArgs.model_json_schema(),
    },
    {
        "name": "gmail_confirmations",
        "description": "Refresh and read known event confirmations from connected Gmail.",
        "inputSchema": GmailArgs.model_json_schema(),
    },
    {
        "name": "plan_tasks",
        "description": "Preview working-time slots for the user's own tasks without writing them.",
        "inputSchema": PlanArgs.model_json_schema(),
    },
    {
        "name": "apply_plan",
        "description": "Apply a freshly computed task plan after explicit user confirmation.",
        "inputSchema": ApplyPlanArgs.model_json_schema(),
    },
]


def parse_arguments(name: str, value: object) -> BaseModel:
    model = ARGUMENTS.get(name)
    if model is None:
        raise ValueError("Unknown tool.")
    try:
        return model.model_validate(value if isinstance(value, dict) else {})
    except ValidationError as error:
        raise ValueError("Invalid tool arguments.") from error


def tool_result(value: object, *, error: bool = False) -> dict[str, Any]:
    text = value if isinstance(value, str) else _json_text(value)
    result: dict[str, Any] = {
        "content": [{"type": "text", "text": text}],
        "isError": error,
    }
    if not error and not isinstance(value, str):
        result["structuredContent"] = value
    return result


def _json_text(value: object) -> str:
    import json

    return json.dumps(value, separators=(",", ":"), default=str)
