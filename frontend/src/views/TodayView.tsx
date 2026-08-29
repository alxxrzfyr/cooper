import { useState } from "react";

import { MASCOTS } from "../assets";
import { Mascot } from "../components/Mascot";
import {
  DeadlinePill,
  ScoreBreakdown,
  SlipPill,
  TaskTitleCell,
  formatEffort,
} from "../components/TaskBits";
import type { Plan, RankedTask } from "../types";

const LONG_DATE: Intl.DateTimeFormatOptions = {
  weekday: "short",
  year: "numeric",
  month: "short",
  day: "numeric",
};

function totalEffort(entries: RankedTask[]): string {
  const minutes = entries.reduce((sum, entry) => sum + (entry.task.effort_minutes ?? 0), 0);
  return formatEffort(minutes || null);
}

export function TodayView({
  plan,
  today,
  onComplete,
  onTogglePin,
  busy,
}: {
  plan: Plan;
  today: string;
  onComplete: (taskId: string) => void;
  onTogglePin: (task: RankedTask) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const slipped = plan.shortlist.filter((entry) => entry.task.slip_count > 0);
  const leader = plan.shortlist[0];

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Today</h1>
          <p className="view__subtitle">
            {new Date(plan.generated_at).toLocaleDateString(undefined, LONG_DATE)}
            {" · "}
            {plan.shortlist.length} on the shortlist
            {" · "}
            {totalEffort(plan.shortlist)} of work
            {slipped.length > 0 && ` · ${slipped.length} slipped`}
          </p>
        </div>
      </header>

      {leader ? (
        <section className="section" aria-labelledby="next-label">
          <span className="section__label" id="next-label">
            Next
          </span>
          <div className="card now">
            <Mascot asset={MASCOTS.taskActive} className="now__mascot" decorative />
            <div className="now__body">
              <h2 className="now__title">{leader.task.title}</h2>
              <span className="now__meta">
                {formatEffort(leader.task.effort_minutes)} · importance{" "}
                {leader.task.importance} · score {leader.score.toFixed(3)}
                {leader.is_pinned && " · pinned for today"}
              </span>
            </div>
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => onComplete(leader.task.id)}
            >
              Mark done
            </button>
          </div>
        </section>
      ) : (
        <section className="section">
          <div className="card empty">
            <Mascot asset={MASCOTS.profile} className="empty__art" decorative />
            <div className="empty__body">
              <h2 className="empty__title">Nothing on the shortlist</h2>
              <p className="empty__text">
                Type a sentence in the capture bar above, such as “write the quarterly report,
                3h, important, due friday”, and it becomes a ranked task.
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="shortlist-label">
        <span className="section__label" id="shortlist-label">
          Shortlist
          <span className="table__meta">Ranked by score. Expand a row to see why.</span>
        </span>
        <div className="card">
          <table className="table table--rows">
            <caption className="visually-hidden">
              Ranked shortlist of tasks with score breakdowns
            </caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Task</th>
                <th scope="col">Effort</th>
                <th scope="col">Due</th>
                <th scope="col">Slips</th>
                <th scope="col" className="table__right">
                  Score
                </th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {plan.shortlist.length === 0 && (
                <tr>
                  <td colSpan={7} className="table__meta">
                    No candidates yet.
                  </td>
                </tr>
              )}
              {plan.shortlist.map((entry) => {
                const open = expanded === entry.task.id;
                return [
                  <tr key={entry.task.id}>
                    <td className="table__num">{entry.rank}</td>
                    <td>
                      <TaskTitleCell task={entry.task} pinned={entry.is_pinned} />
                    </td>
                    <td>{formatEffort(entry.task.effort_minutes)}</td>
                    <td>
                      <DeadlinePill deadline={entry.task.deadline} today={today} />
                    </td>
                    <td>
                      <SlipPill count={entry.task.slip_count} />
                    </td>
                    <td className="table__right">{entry.score.toFixed(3)}</td>
                    <td>
                      <button
                        type="button"
                        className="disclosure"
                        aria-expanded={open}
                        aria-controls={`why-${entry.task.id}`}
                        onClick={() => setExpanded(open ? null : entry.task.id)}
                      >
                        {open ? "▾" : "▸"} why
                      </button>{" "}
                      <button
                        type="button"
                        className="icon-button"
                        aria-pressed={entry.is_pinned}
                        disabled={busy}
                        onClick={() => onTogglePin(entry)}
                      >
                        pin
                      </button>{" "}
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy}
                        onClick={() => onComplete(entry.task.id)}
                      >
                        done
                      </button>
                    </td>
                  </tr>,
                  open ? (
                    <tr key={`${entry.task.id}-why`} id={`why-${entry.task.id}`}>
                      <td colSpan={7} style={{ padding: 0 }}>
                        <ScoreBreakdown entry={entry} />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      </section>

      {plan.blocked.length > 0 && (
        <section className="section" aria-labelledby="blocked-label">
          <span className="section__label" id="blocked-label">
            Blocked
            <span className="table__meta">Excluded from ranking until unblocked.</span>
          </span>
          <div className="card">
            <table className="table">
              <caption className="visually-hidden">Tasks blocked by an incomplete blocker</caption>
              <thead>
                <tr>
                  <th scope="col">Task</th>
                  <th scope="col">Effort</th>
                  <th scope="col">Due</th>
                </tr>
              </thead>
              <tbody>
                {plan.blocked.map((task) => (
                  <tr key={task.id}>
                    <td className="table__title">{task.title}</td>
                    <td>{formatEffort(task.effort_minutes)}</td>
                    <td>
                      <DeadlinePill deadline={task.deadline} today={today} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
