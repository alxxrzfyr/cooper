"""Placement: turning a ranked shortlist into real calendar time.

Fully deterministic and pure. Takes no provider, so scheduling works with the model
unavailable, which is why quota exhaustion degrades the app rather than breaking it.

The load-bearing invariant: every candidate interval is derived from a window the user
declared, so there is no code path that can emit a block outside one. That is what makes
full autonomy safe without a confirmation step.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections.abc import Iterable, Sequence

from cadence.core.errors import DomainValidationError
from cadence.core.windows import Interval, WindowInstance

MIN_BLOCK_MINUTES = 25
MAX_BLOCK_MINUTES = 90
BUFFER_MINUTES = 10
EARLIEST_START_BUFFER_MINUTES = 15


@dataclasses.dataclass(frozen=True, slots=True)
class PlacementRules:
    min_block_minutes: int = MIN_BLOCK_MINUTES
    max_block_minutes: int = MAX_BLOCK_MINUTES
    buffer_minutes: int = BUFFER_MINUTES
    earliest_start_buffer_minutes: int = EARLIEST_START_BUFFER_MINUTES

    def __post_init__(self) -> None:
        if self.min_block_minutes <= 0:
            raise DomainValidationError("min_block_minutes must be positive")
        if self.max_block_minutes < self.min_block_minutes:
            raise DomainValidationError("max_block_minutes must not be below the minimum")
        if self.buffer_minutes < 0:
            raise DomainValidationError("buffer_minutes must not be negative")


@dataclasses.dataclass(frozen=True, slots=True)
class Placeable:
    """What placement needs to know about a task. Deliberately not the Task itself."""

    task_id: str
    title: str
    effort_minutes: int | None
    allow_split: bool = False


@dataclasses.dataclass(frozen=True, slots=True)
class ProposedBlock:
    task_id: str
    interval: Interval
    window_id: str
    piece: int = 1
    of_pieces: int = 1

    @property
    def is_split(self) -> bool:
        return self.of_pieces > 1


class UnplacedReason:
    NO_ESTIMATE = "no_effort_estimate"
    TOO_LARGE = "larger_than_any_window_space"
    NO_ROOM = "no_room_left"


@dataclasses.dataclass(frozen=True, slots=True)
class Unplaced:
    task_id: str
    reason: str


@dataclasses.dataclass(frozen=True, slots=True)
class PlacementResult:
    blocks: tuple[ProposedBlock, ...]
    unplaced: tuple[Unplaced, ...]

    def blocks_for(self, task_id: str) -> tuple[ProposedBlock, ...]:
        return tuple(block for block in self.blocks if block.task_id == task_id)

    @property
    def scheduled_minutes(self) -> int:
        return sum(block.interval.duration_minutes for block in self.blocks)


def _free_pieces(
    instance: WindowInstance,
    busy: Sequence[Interval],
    earliest: dt.datetime,
) -> list[Interval]:
    """Free time inside one window instance, after busy time and the start clamp."""
    interval = instance.interval
    if interval.end_utc <= earliest:
        return []
    if interval.start_utc < earliest:
        interval = Interval(start_utc=earliest, end_utc=interval.end_utc)
    return list(interval.subtract(busy))


def place(
    shortlist: Sequence[Placeable],
    instances: Sequence[WindowInstance],
    *,
    now: dt.datetime,
    busy: Iterable[Interval] = (),
    rules: PlacementRules = PlacementRules(),
) -> PlacementResult:
    """Greedily first-fit the shortlist into declared window time.

    Ranked order is respected: an earlier task takes the earliest space that fits it. A task
    that cannot fit is reported rather than shrunk, because a block shorter than the minimum
    is not a useful unit of work.
    """
    if now.tzinfo is None:
        raise DomainValidationError("now must carry a timezone")

    earliest = now + dt.timedelta(minutes=rules.earliest_start_buffer_minutes)
    # Occupied time accumulates as we place, so later tasks see earlier decisions.
    occupied: list[Interval] = list(busy)
    placed_per_instance: dict[tuple[str, dt.date], int] = {}

    blocks: list[ProposedBlock] = []
    unplaced: list[Unplaced] = []

    for task in shortlist:
        if task.effort_minutes is None:
            unplaced.append(Unplaced(task.task_id, UnplacedReason.NO_ESTIMATE))
            continue

        remaining = task.effort_minutes
        max_piece = rules.max_block_minutes
        if not task.allow_split and remaining > max_piece:
            unplaced.append(Unplaced(task.task_id, UnplacedReason.TOO_LARGE))
            continue

        pieces: list[tuple[WindowInstance, Interval]] = []
        # Reservations made for this task alone, so a failure can be rolled back exactly.
        reservations: list[Interval] = []

        for instance in instances:
            if remaining <= 0:
                break
            key = (instance.window.id, instance.date)

            # Free space is recomputed after every placement, so a split task can use the
            # remainder of the same window rather than only its first gap.
            while remaining > 0 and placed_per_instance.get(key, 0) < instance.cap:
                candidate = _first_fitting(
                    _free_pieces(instance, occupied, earliest),
                    remaining=remaining,
                    allow_split=task.allow_split,
                    rules=rules,
                )
                if candidate is None:
                    break

                pieces.append((instance, candidate))
                reservation = Interval(
                    start_utc=candidate.start_utc,
                    end_utc=candidate.end_utc + dt.timedelta(minutes=rules.buffer_minutes),
                )
                occupied.append(reservation)
                reservations.append(reservation)
                placed_per_instance[key] = placed_per_instance.get(key, 0) + 1
                remaining -= candidate.duration_minutes

        if remaining > 0 or not pieces:
            # Roll back completely: half a task placed is not a plan, it is a lie.
            for reservation in reservations:
                occupied.remove(reservation)
            for instance, _interval in pieces:
                key = (instance.window.id, instance.date)
                placed_per_instance[key] = max(0, placed_per_instance.get(key, 0) - 1)
            unplaced.append(Unplaced(task.task_id, UnplacedReason.NO_ROOM))
            continue

        total = len(pieces)
        for index, (instance, interval) in enumerate(pieces, start=1):
            blocks.append(
                ProposedBlock(
                    task_id=task.task_id,
                    interval=interval,
                    window_id=instance.window.id,
                    piece=index,
                    of_pieces=total,
                )
            )

    blocks.sort(key=lambda block: block.interval.start_utc)
    return PlacementResult(blocks=tuple(blocks), unplaced=tuple(unplaced))


def _first_fitting(
    free_pieces: Sequence[Interval],
    *,
    remaining: int,
    allow_split: bool,
    rules: PlacementRules,
) -> Interval | None:
    """The earliest free piece that can legally hold some of this task."""
    for free in free_pieces:
        available = free.duration_minutes
        if available < rules.min_block_minutes:
            continue

        length = min(remaining, rules.max_block_minutes, available)
        if length < rules.min_block_minutes:
            continue

        leftover = remaining - length
        if leftover > 0:
            if not allow_split:
                # An unsplittable task must land whole or not at all.
                continue
            if leftover < rules.min_block_minutes:
                # Never leave a stub too small to schedule later.
                continue

        return Interval(
            start_utc=free.start_utc,
            end_utc=free.start_utc + dt.timedelta(minutes=length),
        )
    return None
