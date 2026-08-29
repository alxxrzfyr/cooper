import datetime as dt
from zoneinfo import ZoneInfo

import pytest

from cadence.core.errors import DomainValidationError
from cadence.core.windows import FocusWindow, Interval, expand_windows, merge_intervals

UTC = dt.UTC
SG = "Asia/Singapore"
NY = "America/New_York"


def window(**overrides: object) -> FocusWindow:
    defaults: dict[str, object] = {
        "id": "win-1",
        "weekday": 0,
        "start_local": dt.time(9, 0),
        "end_local": dt.time(12, 0),
        "timezone": SG,
        "daily_block_cap": 3,
        "active": True,
    }
    return FocusWindow(**(defaults | overrides))  # type: ignore[arg-type]


def test_a_window_must_end_after_it_starts() -> None:
    with pytest.raises(DomainValidationError, match="after"):
        window(start_local=dt.time(12, 0), end_local=dt.time(9, 0))


def test_a_zero_length_window_is_rejected() -> None:
    with pytest.raises(DomainValidationError, match="after"):
        window(start_local=dt.time(9, 0), end_local=dt.time(9, 0))


def test_weekday_must_be_a_real_day() -> None:
    for weekday in (-1, 7):
        with pytest.raises(DomainValidationError, match="weekday"):
            window(weekday=weekday)


def test_cap_must_be_positive() -> None:
    with pytest.raises(DomainValidationError, match="cap"):
        window(daily_block_cap=0)


def test_an_unknown_timezone_is_rejected() -> None:
    with pytest.raises(DomainValidationError, match="timezone"):
        window(timezone="Mars/Olympus_Mons")


def test_expansion_produces_one_instance_per_matching_weekday() -> None:
    # 2026-08-31 is a Monday.
    instances = expand_windows([window(weekday=0)], start=dt.date(2026, 8, 31), days=15)

    assert [instance.date for instance in instances] == [
        dt.date(2026, 8, 31),
        dt.date(2026, 9, 7),
        dt.date(2026, 9, 14),
    ]


def test_expansion_skips_inactive_windows() -> None:
    assert expand_windows([window(active=False)], start=dt.date(2026, 8, 31), days=7) == ()


def test_expansion_converts_local_times_to_utc() -> None:
    instance = expand_windows([window()], start=dt.date(2026, 8, 31), days=1)[0]

    # 09:00 in Singapore (UTC+8) is 01:00 UTC.
    assert instance.interval.start_utc == dt.datetime(2026, 8, 31, 1, 0, tzinfo=UTC)
    assert instance.interval.end_utc == dt.datetime(2026, 8, 31, 4, 0, tzinfo=UTC)


def test_expansion_orders_instances_chronologically() -> None:
    morning = window(id="am", start_local=dt.time(9, 0), end_local=dt.time(11, 0))
    afternoon = window(id="pm", start_local=dt.time(14, 0), end_local=dt.time(16, 0))

    instances = expand_windows([afternoon, morning], start=dt.date(2026, 8, 31), days=1)

    assert [instance.window.id for instance in instances] == ["am", "pm"]


def test_expansion_covers_every_weekday_when_all_are_declared() -> None:
    windows = [window(id=f"w{day}", weekday=day) for day in range(7)]

    instances = expand_windows(windows, start=dt.date(2026, 8, 31), days=7)

    assert len(instances) == 7
    assert {instance.date.weekday() for instance in instances} == set(range(7))


def test_a_window_carries_its_own_cap() -> None:
    instance = expand_windows([window(daily_block_cap=2)], start=dt.date(2026, 8, 31), days=1)[0]

    assert instance.window.daily_block_cap == 2


class TestDaylightSaving:
    """The two instants a year that silently corrupt a naive scheduler."""

    def test_a_window_inside_the_spring_forward_gap_shifts_forward(self) -> None:
        # 2027-03-14 in New York: 02:00 to 03:00 does not exist.
        gap_window = window(
            weekday=6,  # Sunday
            start_local=dt.time(2, 30),
            end_local=dt.time(4, 0),
            timezone=NY,
        )

        instance = expand_windows([gap_window], start=dt.date(2027, 3, 14), days=1)[0]

        # 02:30 is shifted to the first valid instant, which is 03:00 local.
        local_start = instance.interval.start_utc.astimezone(ZoneInfo(NY))
        assert (local_start.hour, local_start.minute) == (3, 0)
        assert instance.interval.end_utc > instance.interval.start_utc

    def test_an_ambiguous_fall_back_time_resolves_to_the_first_occurrence(self) -> None:
        # 2026-11-01 in New York: 01:00 to 02:00 happens twice.
        ambiguous = window(
            weekday=6,
            start_local=dt.time(1, 30),
            end_local=dt.time(3, 0),
            timezone=NY,
        )

        instance = expand_windows([ambiguous], start=dt.date(2026, 11, 1), days=1)[0]

        # The first occurrence is still on EDT, which is UTC-4.
        assert instance.interval.start_utc.utcoffset() == dt.timedelta(0)
        assert instance.interval.start_utc == dt.datetime(2026, 11, 1, 5, 30, tzinfo=UTC)

    def test_a_transition_day_still_produces_a_valid_interval(self) -> None:
        for transition in (dt.date(2027, 3, 14), dt.date(2026, 11, 1)):
            instances = expand_windows(
                [window(weekday=6, timezone=NY)],
                start=transition,
                days=1,
            )
            assert len(instances) == 1
            assert instances[0].interval.end_utc > instances[0].interval.start_utc

    def test_a_window_never_collapses_to_zero_length_across_a_transition(self) -> None:
        instances = expand_windows(
            [window(weekday=6, start_local=dt.time(1, 0), end_local=dt.time(3, 0), timezone=NY)],
            start=dt.date(2027, 3, 14),
            days=1,
        )

        assert instances[0].interval.duration_minutes > 0


class TestIntervals:
    def test_duration_is_reported_in_minutes(self) -> None:
        interval = Interval(
            start_utc=dt.datetime(2026, 8, 31, 1, 0, tzinfo=UTC),
            end_utc=dt.datetime(2026, 8, 31, 2, 30, tzinfo=UTC),
        )

        assert interval.duration_minutes == 90

    def test_an_interval_must_end_after_it_starts(self) -> None:
        moment = dt.datetime(2026, 8, 31, 1, 0, tzinfo=UTC)

        with pytest.raises(DomainValidationError):
            Interval(start_utc=moment, end_utc=moment)

    def test_naive_bounds_are_rejected(self) -> None:
        with pytest.raises(DomainValidationError, match="timezone"):
            Interval(
                start_utc=dt.datetime(2026, 8, 31, 1, 0),
                end_utc=dt.datetime(2026, 8, 31, 2, 0),
            )

    def test_overlap_detection(self) -> None:
        def at(start_hour: int, end_hour: int) -> Interval:
            return Interval(
                start_utc=dt.datetime(2026, 8, 31, start_hour, tzinfo=UTC),
                end_utc=dt.datetime(2026, 8, 31, end_hour, tzinfo=UTC),
            )

        assert at(1, 3).overlaps(at(2, 4)) is True
        assert at(1, 3).overlaps(at(3, 5)) is False  # touching is not overlapping
        assert at(1, 5).overlaps(at(2, 3)) is True

    def test_subtracting_a_busy_span_splits_an_interval(self) -> None:
        free = Interval(
            start_utc=dt.datetime(2026, 8, 31, 1, tzinfo=UTC),
            end_utc=dt.datetime(2026, 8, 31, 5, tzinfo=UTC),
        )
        busy = Interval(
            start_utc=dt.datetime(2026, 8, 31, 2, tzinfo=UTC),
            end_utc=dt.datetime(2026, 8, 31, 3, tzinfo=UTC),
        )

        remaining = free.subtract([busy])

        assert [(piece.start_utc.hour, piece.end_utc.hour) for piece in remaining] == [
            (1, 2),
            (3, 5),
        ]

    def test_a_fully_covered_interval_leaves_nothing(self) -> None:
        free = Interval(
            start_utc=dt.datetime(2026, 8, 31, 1, tzinfo=UTC),
            end_utc=dt.datetime(2026, 8, 31, 2, tzinfo=UTC),
        )

        assert free.subtract([free]) == ()

    def test_merging_combines_overlapping_and_touching_spans(self) -> None:
        def at(start_hour: int, end_hour: int) -> Interval:
            return Interval(
                start_utc=dt.datetime(2026, 8, 31, start_hour, tzinfo=UTC),
                end_utc=dt.datetime(2026, 8, 31, end_hour, tzinfo=UTC),
            )

        merged = merge_intervals([at(3, 4), at(1, 2), at(2, 3), at(6, 7)])

        assert [(piece.start_utc.hour, piece.end_utc.hour) for piece in merged] == [(1, 4), (6, 7)]
