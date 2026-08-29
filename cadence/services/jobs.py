"""Catch-up job scheduling.

Jobs record when they last ran and run at startup if overdue. A cron-style trigger would
silently never fire on a laptop that is asleep at 03:00, which would make the nightly plan
quietly fail rather than visibly fail. Quiet failure is the worse outcome, because you only
discover it by noticing the plan is stale.

Every job must therefore be idempotent: running twice must be harmless.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
from collections.abc import Callable

from sqlalchemy.orm import Session

from cadence.adapters.models import JobRunModel


@dataclasses.dataclass(frozen=True, slots=True)
class JobDefinition:
    name: str
    interval: dt.timedelta
    run: Callable[[], str]

    def __post_init__(self) -> None:
        if self.interval <= dt.timedelta(0):
            raise ValueError("job interval must be positive")


@dataclasses.dataclass(frozen=True, slots=True)
class JobStatus:
    name: str
    last_run_at: dt.datetime | None
    last_status: str | None
    due: bool


class JobLedger:
    """Persistent record of when each job last ran."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def last_run(self, name: str) -> dt.datetime | None:
        row = self._session.get(JobRunModel, name)
        if row is None or row.last_run_at is None:
            return None
        moment = row.last_run_at
        return moment if moment.tzinfo else moment.replace(tzinfo=dt.UTC)

    def status(self, name: str) -> tuple[dt.datetime | None, str | None]:
        row = self._session.get(JobRunModel, name)
        if row is None:
            return (None, None)
        last = self.last_run(name)
        return (last, row.last_status)

    def record(self, name: str, *, at: dt.datetime, status: str) -> None:
        row = self._session.get(JobRunModel, name)
        if row is None:
            row = JobRunModel(job_name=name)
            self._session.add(row)
        row.last_run_at = at.astimezone(dt.UTC)
        row.last_status = status[:40]
        self._session.flush()


class JobRunner:
    """Runs whichever jobs are overdue. Deliberately has no timer of its own."""

    def __init__(
        self,
        *,
        ledger: JobLedger,
        now: Callable[[], dt.datetime],
    ) -> None:
        self._ledger = ledger
        self._now = now

    def is_due(self, job: JobDefinition) -> bool:
        last = self._ledger.last_run(job.name)
        if last is None:
            return True
        return self._now() - last >= job.interval

    def statuses(self, jobs: tuple[JobDefinition, ...]) -> tuple[JobStatus, ...]:
        result = []
        for job in jobs:
            last, status = self._ledger.status(job.name)
            result.append(
                JobStatus(
                    name=job.name,
                    last_run_at=last,
                    last_status=status,
                    due=self.is_due(job),
                )
            )
        return tuple(result)

    def run_due(self, jobs: tuple[JobDefinition, ...]) -> dict[str, str]:
        """Run every overdue job once, recording the outcome of each.

        One job failing never prevents the others from running: a broken calendar sync must
        not also stop the nightly plan.
        """
        outcomes: dict[str, str] = {}
        for job in jobs:
            if not self.is_due(job):
                continue
            started = self._now()
            try:
                outcome = job.run()
                status = outcome or "ok"
            except Exception as error:  # noqa: BLE001 - one job must not stop the rest
                status = f"error: {type(error).__name__}"
            self._ledger.record(job.name, at=started, status=status)
            outcomes[job.name] = status
        return outcomes

    def force(self, job: JobDefinition) -> str:
        """Run a job regardless of schedule. Used by manual refresh."""
        started = self._now()
        try:
            status = job.run() or "ok"
        except Exception as error:  # noqa: BLE001
            status = f"error: {type(error).__name__}"
        self._ledger.record(job.name, at=started, status=status)
        return status
