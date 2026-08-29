"""Focus window management.

Thin, but it owns two decisions worth having in one place: the default timezone comes from
configuration rather than the request, and declaring a span across several weekdays creates one
window per day so caps stay per-day.
"""

from __future__ import annotations

import datetime as dt

from cadence.adapters.schedule_repositories import WindowRepository
from cadence.core.errors import DomainValidationError, TaskNotFoundError
from cadence.core.protocols import IdFactory
from cadence.core.windows import FocusWindow


class WindowService:
    def __init__(
        self,
        *,
        repository: WindowRepository,
        new_id: IdFactory,
        default_timezone: str,
    ) -> None:
        self._repository = repository
        self._new_id = new_id
        self._default_timezone = default_timezone

    def list(self, *, active_only: bool = False) -> tuple[FocusWindow, ...]:
        return self._repository.list(active_only=active_only)

    def get_or_raise(self, window_id: str) -> FocusWindow:
        window = self._repository.get(window_id)
        if window is None:
            raise TaskNotFoundError(f"no focus window with id {window_id!r}")
        return window

    def declare(
        self,
        *,
        weekdays: tuple[int, ...],
        start_local: dt.time,
        end_local: dt.time,
        timezone: str | None = None,
        daily_block_cap: int = 3,
    ) -> tuple[FocusWindow, ...]:
        if not weekdays:
            raise DomainValidationError("at least one weekday is required")
        if len(set(weekdays)) != len(weekdays):
            raise DomainValidationError("weekdays must not repeat")

        zone = timezone or self._default_timezone
        created = []
        for weekday in sorted(weekdays):
            window = FocusWindow(
                id=self._new_id(),
                weekday=weekday,
                start_local=start_local,
                end_local=end_local,
                timezone=zone,
                daily_block_cap=daily_block_cap,
            )
            self._repository.add(window)
            created.append(window)
        return tuple(created)

    def update(
        self,
        window_id: str,
        *,
        start_local: dt.time | None = None,
        end_local: dt.time | None = None,
        daily_block_cap: int | None = None,
        active: bool | None = None,
    ) -> FocusWindow:
        import dataclasses

        current = self.get_or_raise(window_id)
        # dataclasses.replace re-runs validation, so an invalid edit raises before any write.
        revised = dataclasses.replace(
            current,
            start_local=start_local if start_local is not None else current.start_local,
            end_local=end_local if end_local is not None else current.end_local,
            daily_block_cap=(
                daily_block_cap if daily_block_cap is not None else current.daily_block_cap
            ),
            active=active if active is not None else current.active,
        )
        self._repository.update(revised)
        return revised

    def remove(self, window_id: str) -> None:
        self.get_or_raise(window_id)
        self._repository.delete(window_id)
