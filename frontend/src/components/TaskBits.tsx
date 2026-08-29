import type { RankedTask, ScoreContribution, Task } from "../types";

const TERM_LABELS: Record<ScoreContribution["term"], string> = {
  deadline_pressure: "Deadline",
  importance: "Importance",
  slip_pressure: "Slipped",
  unblocks: "Unblocks",
  age: "Age",
};

/** Effort in the compact form the concept uses: 90m, 3h, 2h 30m. */
export function formatEffort(minutes: number | null): string {
  if (minutes === null) {
    return "—";
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export function DeadlinePill({ deadline, today }: { deadline: string | null; today: string }) {
  if (!deadline) {
    return <span className="table__meta">—</span>;
  }
  const overdue = deadline < today;
  const due = deadline === today;
  const label = overdue ? `overdue ${deadline}` : due ? "due today" : `due ${deadline}`;
  return (
    <span className={`pill ${overdue ? "pill--overdue" : due ? "pill--due" : ""}`}>{label}</span>
  );
}

export function SlipPill({ count }: { count: number }) {
  if (count === 0) {
    return <span className="table__meta">0×</span>;
  }
  return <span className="pill pill--slip">{count}× slipped</span>;
}

/**
 * Shows why an item ranks where it does.
 *
 * Every term is listed with its normalised value and its actual weighted contribution, so a
 * surprising ranking is explainable rather than mysterious.
 */
export function ScoreBreakdown({ entry }: { entry: RankedTask }) {
  return (
    <div className="breakdown">
      <div className="breakdown__grid">
        {entry.contributions.map((contribution) => (
          <div className="breakdown__term" key={contribution.term}>
            <span className="breakdown__name">{TERM_LABELS[contribution.term]}</span>
            <span className="breakdown__value">+{contribution.weighted.toFixed(3)}</span>
            <span className="breakdown__bar">
              <span
                className="breakdown__fill"
                style={{ width: `${Math.round(contribution.normalised * 100)}%` }}
              />
            </span>
          </div>
        ))}
        <div className="breakdown__term breakdown__total">
          <span className="breakdown__name">Total</span>
          <span className="breakdown__value">{entry.score.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}

export function TaskTitleCell({ task, pinned }: { task: Task; pinned: boolean }) {
  return (
    <div>
      <span className="table__title">{task.title}</span>
      {pinned && <> <span className="pill pill--pinned">pinned</span></>}
      {task.tags.length > 0 && (
        <div className="table__meta">{task.tags.map((tag) => `#${tag}`).join(" ")}</div>
      )}
    </div>
  );
}
