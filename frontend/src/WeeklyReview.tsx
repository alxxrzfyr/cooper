import { useState } from "react";

import type { WeeklyReview as Review } from "./types";

const RISK: Record<string, string> = {
  unknown_estimate: "needs an estimate",
  no_feasible_slot: "no free time before it’s due",
  calendar_unchecked: "a calendar couldn’t be checked",
};

function hours(minutes: number): string {
  if (minutes === 0) return "0h";
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${whole}h` : whole === 0 ? `${rest}m` : `${whole}h ${rest}m`;
}

function weekday(date: string): string {
  // `date` is already a local date in the owner's timezone; format it without shifting.
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Read-only week summary. No mutation controls; Home's own actions stay the way to act. */
export function WeeklyReview({ onLoad }: { onLoad: () => Promise<Review | null> }) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    setReview(await onLoad());
    setLoading(false);
  }

  if (!review) {
    return (
      <button
        type="button"
        className="btn btn--quiet"
        disabled={loading}
        onClick={() => void open()}
      >
        Review the week
      </button>
    );
  }

  return (
    <section className="home-review" aria-label="Weekly review">
      {!review.complete && (
        <p className="home-review__note">
          A connected calendar couldn’t be checked, so busy time and deadline fit may be incomplete.
        </p>
      )}

      <h3>
        Done {weekday(review.past.start)} – {weekday(review.past.end)}
      </h3>
      {review.past.completed.length === 0 ? (
        <p className="home-review__note">Nothing completed in the last seven days.</p>
      ) : (
        <ul className="home-review__list">
          {review.past.completed.map((row) => (
            <li key={row.item_id}>{row.title}</li>
          ))}
        </ul>
      )}

      <h3>Still unfinished</h3>
      {review.unfinished.length === 0 ? (
        <p className="home-review__note">Nothing overdue or missed.</p>
      ) : (
        <ul className="home-review__list">
          {review.unfinished.map((row) => (
            <li key={row.item_id}>
              {row.title}: {row.state === "overdue" ? "overdue" : "scheduled time passed"}
            </li>
          ))}
        </ul>
      )}

      <h3>Next seven days</h3>
      <table className="home-review__days">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Fixed</th>
            <th scope="col">Planned</th>
            <th scope="col">Due</th>
          </tr>
        </thead>
        <tbody>
          {review.upcoming.map((day) => (
            <tr key={day.date}>
              <th scope="row">{weekday(day.date)}</th>
              <td>{hours(day.fixed_minutes)}</td>
              <td>{hours(day.planned_minutes)}</td>
              <td>{day.deadlines.map((entry) => entry.title).join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Deadline risks</h3>
      {review.deadline_risks.length === 0 ? (
        <p className="home-review__note">Every deadline this week has time before it.</p>
      ) : (
        <ul className="home-review__list">
          {review.deadline_risks.map((row) => (
            <li key={row.item_id}>
              {row.title}: {RISK[row.reason] ?? row.reason}
            </li>
          ))}
        </ul>
      )}

      <p className="home-review__note">
        {review.uncertainty.unscheduled_count} unscheduled ·{" "}
        {review.uncertainty.unknown_estimate_count} without an estimate
      </p>
      <div>
        <button type="button" className="btn btn--quiet" onClick={() => setReview(null)}>
          Close
        </button>
      </div>
    </section>
  );
}
