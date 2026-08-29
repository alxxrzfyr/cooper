"""Mutation log persistence.

Append-only. Every state change records what it replaced, which is the whole basis of
undo. Phase 1 uses this for parsed-chip correction; the same rows serve batch undo later.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from typing import Any, Literal, Protocol, runtime_checkable

from sqlalchemy import select
from sqlalchemy.orm import Session

from cadence.adapters.models import MutationLogModel

Actor = Literal["user", "ai"]


@dataclasses.dataclass(frozen=True, slots=True)
class MutationRecord:
    id: str
    batch_id: str
    ts: dt.datetime
    actor: Actor
    intent_kind: str
    entity_type: str
    entity_id: str
    op: str
    before: dict[str, Any] | None
    after: dict[str, Any] | None
    inverse_applied_at: dt.datetime | None = None

    @property
    def is_undone(self) -> bool:
        return self.inverse_applied_at is not None


@dataclasses.dataclass(frozen=True, slots=True)
class MutationBatch:
    """All mutations produced by one user turn or one job run.

    The unit of undo. Reversing a re-plan means reversing the batch, not hunting for the
    individual blocks it touched.
    """

    batch_id: str
    ts: dt.datetime
    actor: Actor
    intent_kind: str
    mutations: tuple[MutationRecord, ...]

    @property
    def is_undone(self) -> bool:
        return all(mutation.is_undone for mutation in self.mutations)

    @property
    def size(self) -> int:
        return len(self.mutations)


@runtime_checkable
class MutationRepository(Protocol):
    def record(self, mutation: MutationRecord) -> None: ...

    def get(self, mutation_id: str) -> MutationRecord | None: ...

    def latest(self) -> MutationRecord | None: ...

    def mark_undone(self, mutation_id: str, *, at: dt.datetime) -> None: ...

    def batch(self, batch_id: str) -> MutationBatch | None: ...

    def recent_batches(self, *, limit: int = 25) -> tuple[MutationBatch, ...]: ...


def _to_domain(row: MutationLogModel) -> MutationRecord:
    ts = row.ts if row.ts.tzinfo else row.ts.replace(tzinfo=dt.UTC)
    applied = row.inverse_applied_at
    if applied is not None and applied.tzinfo is None:
        applied = applied.replace(tzinfo=dt.UTC)
    return MutationRecord(
        id=row.id,
        batch_id=row.batch_id,
        ts=ts,
        actor=row.actor,  # type: ignore[arg-type]
        intent_kind=row.intent_kind,
        entity_type=row.entity_type,
        entity_id=row.entity_id,
        op=row.op,
        before=dict(row.before_json) if row.before_json else None,
        after=dict(row.after_json) if row.after_json else None,
        inverse_applied_at=applied,
    )


class SqlAlchemyMutationRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def record(self, mutation: MutationRecord) -> None:
        self._session.add(
            MutationLogModel(
                id=mutation.id,
                batch_id=mutation.batch_id,
                ts=mutation.ts.astimezone(dt.UTC),
                actor=mutation.actor,
                intent_kind=mutation.intent_kind,
                entity_type=mutation.entity_type,
                entity_id=mutation.entity_id,
                op=mutation.op,
                before_json=mutation.before,
                after_json=mutation.after,
                inverse_applied_at=None,
            )
        )
        self._session.flush()

    def get(self, mutation_id: str) -> MutationRecord | None:
        row = self._session.get(MutationLogModel, mutation_id)
        return None if row is None else _to_domain(row)

    def latest(self) -> MutationRecord | None:
        statement = (
            select(MutationLogModel)
            .where(MutationLogModel.inverse_applied_at.is_(None))
            .order_by(MutationLogModel.ts.desc(), MutationLogModel.id.desc())
            .limit(1)
        )
        row = self._session.scalars(statement).first()
        return None if row is None else _to_domain(row)

    def mark_undone(self, mutation_id: str, *, at: dt.datetime) -> None:
        row = self._session.get(MutationLogModel, mutation_id)
        if row is None:
            raise KeyError(mutation_id)
        row.inverse_applied_at = at.astimezone(dt.UTC)
        self._session.flush()

    def batch(self, batch_id: str) -> MutationBatch | None:
        statement = (
            select(MutationLogModel)
            .where(MutationLogModel.batch_id == batch_id)
            .order_by(MutationLogModel.ts, MutationLogModel.id)
        )
        rows = list(self._session.scalars(statement))
        if not rows:
            return None
        return _to_batch(rows)

    def recent_batches(self, *, limit: int = 25) -> tuple[MutationBatch, ...]:
        """Most recent batches first, so the activity feed reads newest at the top."""
        ordered = (
            select(MutationLogModel)
            .order_by(MutationLogModel.ts.desc(), MutationLogModel.id.desc())
            .limit(limit * 20)
        )
        grouped: dict[str, list[MutationLogModel]] = {}
        for row in self._session.scalars(ordered):
            grouped.setdefault(row.batch_id, []).append(row)
            if len(grouped) > limit and row.batch_id not in grouped:
                break

        batches = [_to_batch(sorted(rows, key=lambda r: (r.ts, r.id))) for rows in grouped.values()]
        batches.sort(key=lambda batch: batch.ts, reverse=True)
        return tuple(batches[:limit])


def _to_batch(rows: list[MutationLogModel]) -> MutationBatch:
    mutations = tuple(_to_domain(row) for row in rows)
    first = mutations[0]
    return MutationBatch(
        batch_id=first.batch_id,
        ts=max(mutation.ts for mutation in mutations),
        actor=first.actor,
        intent_kind=first.intent_kind,
        mutations=mutations,
    )
