import { useMemo, useState } from "react";

import {
  DeadlinePill,
  ScoreBreakdown,
  SlipPill,
  TaskTitleCell,
  formatEffort,
} from "../components/TaskBits";
import type { RankedTask, Task } from "../types";

export function BacklogView({
  entries,
  blocked,
  today,
  onComplete,
  onDrop,
  busy,
}: {
  entries: RankedTask[];
  blocked: Task[];
  today: string;
  onComplete: (taskId: string) => void;
  onDrop: (taskId: string) => void;
  busy: boolean;
}) {
  const [tag, setTag] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const tags = useMemo(() => {
    const found = new Set<string>();
    entries.forEach((entry) => entry.task.tags.forEach((value) => found.add(value)));
    return [...found].sort();
  }, [entries]);

  const visible = tag ? entries.filter((entry) => entry.task.tags.includes(tag)) : entries;

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Backlog</h1>
          <p className="view__subtitle">
            All unscheduled tasks, ranked by score. Showing {visible.length} of {entries.length}.
          </p>
        </div>
      </header>

      {tags.length > 0 && (
        <div className="filters" role="group" aria-label="Filter by tag">
          <button
            type="button"
            className="icon-button"
            aria-pressed={tag === null}
            onClick={() => setTag(null)}
          >
            All
          </button>
          {tags.map((value) => (
            <button
              key={value}
              type="button"
              className="icon-button"
              aria-pressed={tag === value}
              onClick={() => setTag(value)}
            >
              #{value}
            </button>
          ))}
        </div>
      )}

      <div className="card">
        <table className="table table--rows">
          <caption className="visually-hidden">Backlog tasks ranked by score</caption>
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Task</th>
              <th scope="col">Effort</th>
              <th scope="col">Importance</th>
              <th scope="col">Deadline</th>
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
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="table__meta">
                  Nothing here yet.
                </td>
              </tr>
            )}
            {visible.map((entry) => {
              const open = expanded === entry.task.id;
              return [
                <tr key={entry.task.id}>
                  <td className="table__num">{entry.rank}</td>
                  <td>
                    <TaskTitleCell task={entry.task} pinned={entry.is_pinned} />
                  </td>
                  <td>{formatEffort(entry.task.effort_minutes)}</td>
                  <td>{entry.task.importance}</td>
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
                      aria-controls={`backlog-why-${entry.task.id}`}
                      onClick={() => setExpanded(open ? null : entry.task.id)}
                    >
                      {open ? "▾" : "▸"} why
                    </button>{" "}
                    <button
                      type="button"
                      className="icon-button"
                      disabled={busy}
                      onClick={() => onComplete(entry.task.id)}
                    >
                      done
                    </button>{" "}
                    <button
                      type="button"
                      className="icon-button"
                      disabled={busy}
                      onClick={() => onDrop(entry.task.id)}
                    >
                      drop
                    </button>
                  </td>
                </tr>,
                open ? (
                  <tr key={`${entry.task.id}-why`} id={`backlog-why-${entry.task.id}`}>
                    <td colSpan={8} style={{ padding: 0 }}>
                      <ScoreBreakdown entry={entry} />
                    </td>
                  </tr>
                ) : null,
              ];
            })}
          </tbody>
        </table>
      </div>

      <section className="section" aria-labelledby="backlog-blocked">
        <span className="section__label" id="backlog-blocked">
          Blocked
          <span className="table__meta">Excluded from ranking, not ranked low.</span>
        </span>
        <div className="card">
          <table className="table">
            <caption className="visually-hidden">Blocked tasks</caption>
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Effort</th>
                <th scope="col">Deadline</th>
              </tr>
            </thead>
            <tbody>
              {blocked.length === 0 && (
                <tr>
                  <td colSpan={3} className="table__meta">
                    Nothing is blocked.
                  </td>
                </tr>
              )}
              {blocked.map((task) => (
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
    </div>
  );
}
