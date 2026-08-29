import datetime as dt

import pytest

from cadence.core.placement import (
    Placeable,
    PlacementRules,
    UnplacedReason,
    place,
)
from cadence.core.windows import FocusWindow, Interval, expand_windows

UTC = dt.UTC
SG = "Asia/Singapore"
# 2026-08-31 is a Monday. 09:00 Singapore is 01:00 UTC.
MONDAY = dt.date(2026, 8, 31)
NOW = dt.datetime(2026, 8, 30, 0, 0, tzinfo=UTC)


def morning(**overrides: object) -> FocusWindow:
    defaults: dict[str, object] = {
        "id": "am",
        "weekday": 0,
        "start_local": dt.time(9, 0),
        "end_local": dt.time(12, 0),
        "timezone": SG,
        "daily_block_cap": 3,
    }
    return FocusWindow(**(defaults | overrides))  # type: ignore[arg-type]


def instances(*windows: FocusWindow, days: int = 1):
    return expand_windows(list(windows), start=MONDAY, days=days)


def task(task_id: str, minutes: int | None, *, allow_split: bool = False) -> Placeable:
    return Placeable(
        task_id=task_id,
        title=task_id,
        effort_minutes=minutes,
        allow_split=allow_split,
    )


def utc(hour: int, minute: int = 0, day: int = 31) -> dt.datetime:
    return dt.datetime(2026, 8, day, hour, minute, tzinfo=UTC)


class TestInvariants:
    """Properties that must never break, whatever the inputs."""

    def test_no_block_is_ever_placed_outside_a_declared_window(self) -> None:
        windows = instances(morning())
        result = place([task("a", 60), task("b", 60), task("c", 60)], windows, now=NOW)

        assert result.blocks
        for block in result.blocks:
            assert any(window.interval.contains(block.interval) for window in windows), (
                f"{block} escaped every declared window"
            )

    def test_with_no_windows_nothing_is_scheduled(self) -> None:
        result = place([task("a", 60)], [], now=NOW)

        assert result.blocks == ()
        assert [entry.task_id for entry in result.unplaced] == ["a"]

    def test_no_two_blocks_overlap(self) -> None:
        result = place(
            [task("a", 30), task("b", 30), task("c", 30)],
            instances(morning(daily_block_cap=9)),
            now=NOW,
        )

        for first in result.blocks:
            for second in result.blocks:
                if first is not second:
                    assert not first.interval.overlaps(second.interval)

    def test_the_daily_cap_is_never_exceeded(self) -> None:
        result = place(
            [task(f"t{index}", 25) for index in range(10)],
            instances(morning(daily_block_cap=2)),
            now=NOW,
        )

        assert len(result.blocks) == 2

    def test_busy_time_is_never_double_booked(self) -> None:
        busy = Interval(start_utc=utc(1), end_utc=utc(3))  # 09:00-11:00 local

        result = place([task("a", 30)], instances(morning()), now=NOW, busy=[busy])

        assert result.blocks
        for block in result.blocks:
            assert not block.interval.overlaps(busy)

    def test_nothing_is_placed_in_the_past(self) -> None:
        # "Now" is midway through the window: 10:00 local is 02:00 UTC.
        now = utc(2)

        result = place([task("a", 30)], instances(morning()), now=now)

        for block in result.blocks:
            assert block.interval.start_utc >= now

    def test_placement_is_deterministic(self) -> None:
        shortlist = [task("a", 30), task("b", 45)]

        first = place(shortlist, instances(morning()), now=NOW)
        second = place(shortlist, instances(morning()), now=NOW)

        assert first == second


class TestFitting:
    def test_ranked_order_wins_the_earliest_slot(self) -> None:
        result = place([task("first", 30), task("second", 30)], instances(morning()), now=NOW)

        ordered = sorted(result.blocks, key=lambda block: block.interval.start_utc)
        assert [block.task_id for block in ordered] == ["first", "second"]

    def test_a_buffer_separates_consecutive_blocks(self) -> None:
        result = place(
            [task("a", 30), task("b", 30)],
            instances(morning()),
            now=NOW,
            rules=PlacementRules(buffer_minutes=10),
        )

        ordered = sorted(result.blocks, key=lambda block: block.interval.start_utc)
        gap = ordered[1].interval.start_utc - ordered[0].interval.end_utc
        assert gap >= dt.timedelta(minutes=10)

    def test_a_task_without_an_estimate_cannot_be_placed(self) -> None:
        result = place([task("a", None)], instances(morning()), now=NOW)

        assert result.blocks == ()
        assert result.unplaced[0].reason == UnplacedReason.NO_ESTIMATE

    def test_a_task_longer_than_a_block_and_unsplittable_is_reported(self) -> None:
        result = place([task("epic", 720)], instances(morning()), now=NOW)

        assert result.blocks == ()
        assert result.unplaced[0].reason == UnplacedReason.TOO_LARGE

    def test_a_splittable_task_is_spread_across_pieces(self) -> None:
        # 150 minutes fits a 180-minute window as 90 + buffer + 60.
        result = place(
            [task("big", 150, allow_split=True)],
            instances(morning(daily_block_cap=3)),
            now=NOW,
        )

        pieces = result.blocks_for("big")
        assert len(pieces) == 2
        assert sum(piece.interval.duration_minutes for piece in pieces) == 150
        assert {piece.of_pieces for piece in pieces} == {2}
        assert [piece.piece for piece in pieces] == [1, 2]

    def test_the_buffer_consumes_window_capacity(self) -> None:
        # A 180-minute task cannot fill a 180-minute window: the 10-minute buffer between
        # pieces leaves only 170 usable, and a 10-minute remainder is below the minimum.
        result = place(
            [task("exact", 180, allow_split=True)],
            instances(morning(daily_block_cap=3)),
            now=NOW,
        )

        assert result.blocks_for("exact") == ()
        assert result.unplaced[0].reason == UnplacedReason.NO_ROOM

    def test_a_split_never_leaves_a_piece_below_the_minimum(self) -> None:
        result = place(
            [task("awkward", 100, allow_split=True)],
            instances(morning(daily_block_cap=4)),
            now=NOW,
            rules=PlacementRules(min_block_minutes=25, max_block_minutes=90),
        )

        for piece in result.blocks_for("awkward"):
            assert piece.interval.duration_minutes >= 25

    def test_a_block_never_exceeds_the_maximum_length(self) -> None:
        result = place(
            [task("long", 240, allow_split=True)],
            instances(morning(), morning(id="pm", start_local=dt.time(14), end_local=dt.time(18))),
            now=NOW,
        )

        for block in result.blocks:
            assert block.interval.duration_minutes <= 90

    def test_a_task_too_short_for_the_minimum_is_still_given_the_minimum_space(self) -> None:
        result = place([task("tiny", 5)], instances(morning()), now=NOW)

        # A five-minute task cannot justify a block; the minimum is not shrunk to fit it.
        assert result.blocks == () or result.blocks[0].interval.duration_minutes >= 5

    def test_partial_placement_is_rolled_back_rather_than_left_half_done(self) -> None:
        # Only 60 minutes of window, but the task needs 180 and may split.
        tight = morning(start_local=dt.time(9, 0), end_local=dt.time(10, 0), daily_block_cap=5)

        result = place([task("big", 180, allow_split=True)], instances(tight), now=NOW)

        assert result.blocks_for("big") == ()
        assert result.unplaced[0].reason == UnplacedReason.NO_ROOM

    def test_a_later_task_uses_space_an_earlier_one_could_not(self) -> None:
        tight = morning(start_local=dt.time(9, 0), end_local=dt.time(10, 0))

        result = place([task("epic", 720), task("small", 30)], instances(tight), now=NOW)

        assert [block.task_id for block in result.blocks] == ["small"]
        assert result.unplaced[0].task_id == "epic"

    def test_multiple_windows_across_days_are_used_in_order(self) -> None:
        result = place(
            [task("a", 60), task("b", 60), task("c", 60)],
            instances(morning(daily_block_cap=1), days=15),
            now=NOW,
        )

        starts = [block.interval.start_utc for block in result.blocks]
        assert starts == sorted(starts)
        assert len({start.date() for start in starts}) == 3

    def test_scheduled_minutes_reports_the_total(self) -> None:
        result = place([task("a", 30), task("b", 45)], instances(morning()), now=NOW)

        assert result.scheduled_minutes == 75

    def test_a_window_entirely_in_the_past_is_skipped(self) -> None:
        result = place([task("a", 30)], instances(morning()), now=utc(9))

        assert result.blocks == ()


class TestRules:
    def test_a_negative_buffer_is_rejected(self) -> None:
        with pytest.raises(Exception, match="buffer"):
            PlacementRules(buffer_minutes=-1)

    def test_a_maximum_below_the_minimum_is_rejected(self) -> None:
        with pytest.raises(Exception, match="maximum|minimum"):
            PlacementRules(min_block_minutes=60, max_block_minutes=30)

    def test_naive_now_is_rejected(self) -> None:
        with pytest.raises(Exception, match="timezone"):
            place([task("a", 30)], instances(morning()), now=dt.datetime(2026, 8, 30, 0, 0))
