"""Focus window routes.

The windows the user paints here are the entire territory the scheduler may write into, so
these endpoints are the boundary that makes autonomous scheduling safe.
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, status
from pydantic import BaseModel, ConfigDict, Field

from cadence.api.dependencies import WindowServiceDep
from cadence.core.windows import FocusWindow

router = APIRouter(prefix="/api/windows", tags=["windows"])

WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


class WindowCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    weekdays: list[int] = Field(min_length=1)
    start_local: dt.time
    end_local: dt.time
    timezone: str | None = None
    daily_block_cap: int = Field(default=3, ge=1, le=12)


class WindowUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_local: dt.time | None = None
    end_local: dt.time | None = None
    daily_block_cap: int | None = Field(default=None, ge=1, le=12)
    active: bool | None = None


class WindowResponse(BaseModel):
    id: str
    weekday: int
    weekday_name: str
    start_local: dt.time
    end_local: dt.time
    timezone: str
    daily_block_cap: int
    active: bool
    minutes: int

    @classmethod
    def of(cls, window: FocusWindow) -> WindowResponse:
        start = dt.datetime.combine(dt.date(2000, 1, 1), window.start_local)
        end = dt.datetime.combine(dt.date(2000, 1, 1), window.end_local)
        return cls(
            id=window.id,
            weekday=window.weekday,
            weekday_name=WEEKDAY_NAMES[window.weekday],
            start_local=window.start_local,
            end_local=window.end_local,
            timezone=window.timezone,
            daily_block_cap=window.daily_block_cap,
            active=window.active,
            minutes=int((end - start).total_seconds() // 60),
        )


@router.get("", response_model=list[WindowResponse])
def list_windows(service: WindowServiceDep) -> list[WindowResponse]:
    return [WindowResponse.of(window) for window in service.list()]


@router.post("", response_model=list[WindowResponse], status_code=status.HTTP_201_CREATED)
def create_windows(
    payload: WindowCreateRequest,
    service: WindowServiceDep,
) -> list[WindowResponse]:
    """Declare the same span on one or more weekdays.

    Accepting several weekdays at once matches how the intent is actually formed: "weekday
    mornings" is one decision, not five.
    """
    created = service.declare(
        weekdays=tuple(payload.weekdays),
        start_local=payload.start_local,
        end_local=payload.end_local,
        timezone=payload.timezone,
        daily_block_cap=payload.daily_block_cap,
    )
    return [WindowResponse.of(window) for window in created]


@router.patch("/{window_id}", response_model=WindowResponse)
def update_window(
    window_id: str,
    payload: WindowUpdateRequest,
    service: WindowServiceDep,
) -> WindowResponse:
    return WindowResponse.of(
        service.update(
            window_id,
            start_local=payload.start_local,
            end_local=payload.end_local,
            daily_block_cap=payload.daily_block_cap,
            active=payload.active,
        )
    )


@router.delete("/{window_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_window(window_id: str, service: WindowServiceDep) -> None:
    service.remove(window_id)
