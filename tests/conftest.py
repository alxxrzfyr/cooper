"""Shared synthetic planning state for pure answers and their HTTP contract."""

from typing import Any

import pytest


@pytest.fixture
def planning_view() -> dict[str, Any]:
    return {
        "timezone": "UTC",
        "today": "2026-09-30",
        "now": "2026-09-30T10:00:00+00:00",
        "planning": {
            "complete": True,
            "source_health": [],
            "commitments": [],
            "tasks": [],
            "focus": {"now_id": None, "next_id": None},
            "metrics": {"largest_free_block_minutes": 0},
        },
    }
