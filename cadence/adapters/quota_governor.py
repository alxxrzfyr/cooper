"""Quota governor and circuit breaker.

Google no longer publishes free-tier rate limits: they are per-project, visible only in AI
Studio, and explicitly not guaranteed. So this does not encode a number it cannot know. It
observes its own ceiling, backs off when refused, and opens a breaker after repeated refusal.

Degraded mode is the designed consequence, not an error path. With the breaker open, capture
falls back to the offline parser, ranking is unaffected because it never needed a model, and
scheduling is unaffected because it never did either.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import random
from collections.abc import Callable
from typing import TypeVar

from cadence.core.errors import ProviderError, QuotaExhaustedError

T = TypeVar("T")

FAILURES_BEFORE_OPEN = 3
BASE_BACKOFF_SECONDS = 2.0
MAX_BACKOFF_SECONDS = 60.0
PACIFIC_TZ = "America/Los_Angeles"


@dataclasses.dataclass(frozen=True, slots=True)
class GovernorState:
    """A snapshot the UI can render honestly."""

    degraded: bool
    consecutive_failures: int
    opened_at: dt.datetime | None
    reopens_at: dt.datetime | None
    observed_calls: int
    observed_refusals: int

    @property
    def reason(self) -> str | None:
        if not self.degraded:
            return None
        return "Model quota exhausted. Capture is using the offline parser."


def next_quota_reset(now: dt.datetime) -> dt.datetime:
    """Requests-per-day quotas reset at midnight Pacific, per Google's documentation."""
    from zoneinfo import ZoneInfo

    pacific = ZoneInfo(PACIFIC_TZ)
    local = now.astimezone(pacific)
    tomorrow = (local + dt.timedelta(days=1)).date()
    midnight = dt.datetime.combine(tomorrow, dt.time.min, tzinfo=pacific)
    return midnight.astimezone(dt.UTC)


def backoff_seconds(attempt: int, *, jitter: Callable[[], float] = random.random) -> float:
    """Exponential backoff with jitter, so retries do not synchronise into a burst."""
    raw = BASE_BACKOFF_SECONDS * (2 ** max(0, attempt - 1))
    return min(MAX_BACKOFF_SECONDS, raw) * (0.5 + jitter() / 2)


class QuotaGovernor:
    """Wraps model calls, tracks refusals, and opens a breaker rather than thrashing."""

    def __init__(
        self,
        *,
        now: Callable[[], dt.datetime],
        failures_before_open: int = FAILURES_BEFORE_OPEN,
    ) -> None:
        self._now = now
        self._failures_before_open = failures_before_open
        self._consecutive_failures = 0
        self._opened_at: dt.datetime | None = None
        self._reopens_at: dt.datetime | None = None
        self._calls = 0
        self._refusals = 0

    @property
    def degraded(self) -> bool:
        """True while the breaker is open. Closes itself once the quota window resets."""
        if self._opened_at is None:
            return False
        if self._reopens_at is not None and self._now() >= self._reopens_at:
            self._reset()
            return False
        return True

    def state(self) -> GovernorState:
        degraded = self.degraded
        return GovernorState(
            degraded=degraded,
            consecutive_failures=self._consecutive_failures,
            opened_at=self._opened_at,
            reopens_at=self._reopens_at,
            observed_calls=self._calls,
            observed_refusals=self._refusals,
        )

    def _reset(self) -> None:
        self._consecutive_failures = 0
        self._opened_at = None
        self._reopens_at = None

    def _open(self) -> None:
        now = self._now()
        self._opened_at = now
        self._reopens_at = next_quota_reset(now)

    def run(self, call: Callable[[], T]) -> T:
        """Execute a model call under the breaker.

        Raises QuotaExhaustedError immediately while degraded, which is what lets the caller
        skip a pointless attempt and fall through to the offline path.
        """
        if self.degraded:
            raise QuotaExhaustedError("quota breaker is open")

        self._calls += 1
        try:
            result = call()
        except QuotaExhaustedError:
            self._refusals += 1
            self._consecutive_failures += 1
            if self._consecutive_failures >= self._failures_before_open:
                self._open()
            raise
        except ProviderError:
            # A malformed answer is not a quota problem, so it must not trip the breaker.
            raise
        else:
            self._consecutive_failures = 0
            return result
