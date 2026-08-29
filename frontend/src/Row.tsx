import { useState } from "react";

import type { Item, Ranked } from "./types";

const TERMS: Array<[keyof Ranked["why"], string]> = [
  ["due", "Deadline"],
  ["importance", "Matters"],
  ["age", "Waiting"],
  ["quick", "Quick"],
];

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short" });
}

/** One task or event. Shows why it ranks where it does, on request. */
export function Row({
  item,
  today,
  busy,
  onComplete,
  onPin,
  onDrop,
}: {
  item: Item | Ranked;
  today: string;
  busy: boolean;
  onComplete: () => void;
  onPin?: () => void;
  onDrop?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ranked = "score" in item ? (item as Ranked) : null;
  const late = item.due !== null && item.due.slice(0, 10) < today;
  const dueToday = item.due !== null && item.due.slice(0, 10) === today;

  return (
    <div>
      <div className={`row ${item.status !== "open" ? "row--done" : ""}`}>
        <button
          type="button"
          className="tick"
          aria-label={`Mark “${item.title}” done`}
          disabled={busy}
          onClick={onComplete}
        >
          ✓
        </button>

        <div className="row__main">
          <div className="row__title">{item.title}</div>
          <div className="row__meta">
            {item.pinned && <span className="tag tag--pin">pinned</span>}
            {item.start_at && (
              <span className="tag tag--time">
                {day(item.start_at)} {clock(item.start_at)}
              </span>
            )}
            {item.minutes !== null && <span className="tag">{item.minutes}m</span>}
            {item.due && (
              <span className={`tag ${late ? "tag--late" : dueToday ? "tag--due" : ""}`}>
                {late ? "overdue" : dueToday ? "due today" : `due ${day(item.due)}`}
              </span>
            )}
            {item.google_event_id && <span className="tag">in Google</span>}
          </div>
        </div>

        {ranked && (
          <button
            type="button"
            className="score"
            aria-expanded={open}
            aria-label={`Why “${item.title}” ranks here`}
            onClick={() => setOpen(!open)}
          >
            {ranked.score.toFixed(2)} {open ? "▴" : "▾"}
          </button>
        )}

        <div className="row__actions">
          {onPin && (
            <button
              type="button"
              className="iconbtn"
              aria-label={`Pin “${item.title}”`}
              aria-pressed={item.pinned}
              disabled={busy}
              onClick={onPin}
            >
              ★
            </button>
          )}
          {onDrop && (
            <button
              type="button"
              className="iconbtn"
              aria-label={`Drop “${item.title}”`}
              disabled={busy}
              onClick={onDrop}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {ranked && open && (
        <div className="why">
          {TERMS.map(([key, label]) => (
            <div className="why__item" key={key}>
              <span className="why__name">{label}</span>
              <span className="why__bar">
                <span className="why__fill" style={{ width: `${ranked.why[key] * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
