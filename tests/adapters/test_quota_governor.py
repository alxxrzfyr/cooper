import datetime as dt
from zoneinfo import ZoneInfo

import pytest

from cadence.adapters.quota_governor import (
    MAX_BACKOFF_SECONDS,
    QuotaGovernor,
    backoff_seconds,
    next_quota_reset,
)
from cadence.core.errors import ProviderError, QuotaExhaustedError

UTC = dt.UTC
NOW = dt.datetime(2026, 8, 29, 12, 0, tzinfo=UTC)


class MovableClock:
    def __init__(self, now: dt.datetime) -> None:
        self.value = now

    def __call__(self) -> dt.datetime:
        return self.value

    def advance(self, delta: dt.timedelta) -> None:
        self.value += delta


def governor(clock: MovableClock, **kwargs: object) -> QuotaGovernor:
    return QuotaGovernor(now=clock, **kwargs)  # type: ignore[arg-type]


class TestQuotaReset:
    def test_reset_is_the_next_midnight_pacific(self) -> None:
        reset = next_quota_reset(NOW)

        local = reset.astimezone(ZoneInfo("America/Los_Angeles"))
        assert (local.hour, local.minute) == (0, 0)
        assert reset > NOW

    def test_reset_is_always_in_the_future(self) -> None:
        for hour in range(0, 24, 3):
            moment = NOW.replace(hour=hour)
            assert next_quota_reset(moment) > moment


class TestBackoff:
    def test_backoff_grows_with_attempts(self) -> None:
        first = backoff_seconds(1, jitter=lambda: 1.0)
        third = backoff_seconds(3, jitter=lambda: 1.0)

        assert third > first

    def test_backoff_is_capped(self) -> None:
        assert backoff_seconds(50, jitter=lambda: 1.0) <= MAX_BACKOFF_SECONDS

    def test_jitter_keeps_it_positive(self) -> None:
        assert backoff_seconds(1, jitter=lambda: 0.0) > 0


class TestBreaker:
    def test_a_healthy_call_passes_through(self) -> None:
        clock = MovableClock(NOW)

        assert governor(clock).run(lambda: "ok") == "ok"

    def test_the_governor_starts_closed(self) -> None:
        assert governor(MovableClock(NOW)).degraded is False

    def test_one_refusal_does_not_open_the_breaker(self) -> None:
        gov = governor(MovableClock(NOW))

        with pytest.raises(QuotaExhaustedError):
            gov.run(_refuse)

        assert gov.degraded is False

    def test_repeated_refusal_opens_the_breaker(self) -> None:
        gov = governor(MovableClock(NOW), failures_before_open=3)

        for _ in range(3):
            with pytest.raises(QuotaExhaustedError):
                gov.run(_refuse)

        assert gov.degraded is True

    def test_an_open_breaker_refuses_without_calling_the_model(self) -> None:
        gov = governor(MovableClock(NOW), failures_before_open=1)
        with pytest.raises(QuotaExhaustedError):
            gov.run(_refuse)

        calls = {"n": 0}

        def counted() -> str:
            calls["n"] += 1
            return "ok"

        with pytest.raises(QuotaExhaustedError, match="breaker is open"):
            gov.run(counted)

        assert calls["n"] == 0

    def test_a_success_resets_the_failure_count(self) -> None:
        gov = governor(MovableClock(NOW), failures_before_open=3)
        for _ in range(2):
            with pytest.raises(QuotaExhaustedError):
                gov.run(_refuse)

        gov.run(lambda: "ok")

        assert gov.state().consecutive_failures == 0
        assert gov.degraded is False

    def test_the_breaker_closes_itself_after_the_quota_window(self) -> None:
        clock = MovableClock(NOW)
        gov = governor(clock, failures_before_open=1)
        with pytest.raises(QuotaExhaustedError):
            gov.run(_refuse)
        assert gov.degraded is True

        clock.advance(dt.timedelta(days=2))

        assert gov.degraded is False
        assert gov.run(lambda: "ok") == "ok"

    def test_a_malformed_answer_does_not_trip_the_breaker(self) -> None:
        # A schema violation is a different problem from running out of quota.
        gov = governor(MovableClock(NOW), failures_before_open=2)

        for _ in range(5):
            with pytest.raises(ProviderError):
                gov.run(_malformed)

        assert gov.degraded is False

    def test_state_explains_itself_for_the_interface(self) -> None:
        gov = governor(MovableClock(NOW), failures_before_open=1)
        with pytest.raises(QuotaExhaustedError):
            gov.run(_refuse)

        state = gov.state()

        assert state.degraded is True
        assert state.reopens_at is not None
        assert state.reason is not None
        assert "offline parser" in state.reason

    def test_a_healthy_governor_offers_no_reason(self) -> None:
        assert governor(MovableClock(NOW)).state().reason is None

    def test_calls_and_refusals_are_counted(self) -> None:
        gov = governor(MovableClock(NOW), failures_before_open=99)
        gov.run(lambda: "ok")
        with pytest.raises(QuotaExhaustedError):
            gov.run(_refuse)

        state = gov.state()
        assert state.observed_calls == 2
        assert state.observed_refusals == 1


def _refuse() -> str:
    raise QuotaExhaustedError("daily limit reached")


def _malformed() -> str:
    raise ProviderError("schema violation")
