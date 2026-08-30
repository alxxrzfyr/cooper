import type { Item, Ranked } from "./types";

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short" });
}

/**
 * One task or event in a grouped list.
 *
 * Two gestures and no more: the tick finishes it, and everything else opens its frame, where the
 * score breakdown and the rest of the actions live. The breakdown used to expand in place, which
 * pushed the list around and put three controls on one line of a phone screen.
 */
export function Row({
  item,
  today,
  busy,
  showTime = true,
  onComplete,
  onOpen,
}: {
  item: Item | Ranked;
  today: string;
  busy: boolean;
  showTime?: boolean;
  onComplete: () => void;
  onOpen: () => void;
}) {
  const ranked = "score" in item ? (item as Ranked) : null;
  const late = item.due !== null && item.due.slice(0, 10) < today;
  const dueToday = item.due !== null && item.due.slice(0, 10) === today;

  return (
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

      <button
        type="button"
        className="row__main"
        aria-label={`Open “${item.title}”`}
        onClick={onOpen}
      >
        <div className="row__title">{item.title}</div>
        <div className="row__meta">
          {item.pinned && <span className="tag tag--pin">pinned</span>}
          {showTime && item.start_at && (
            <span className="tag tag--time">
              {shortDay(item.start_at)} {clock(item.start_at)}
            </span>
          )}
          {item.minutes !== null && (
            <span className="tag">{item.minutes}m</span>
          )}
          {item.due && (
            <span
              className={`tag ${late ? "tag--late" : dueToday ? "tag--due" : ""}`}
            >
              {late
                ? "overdue"
                : dueToday
                  ? "due today"
                  : `due ${shortDay(item.due)}`}
            </span>
          )}
          {item.google_event_id && <span className="tag">Google</span>}
        </div>
      </button>

      {/*
        Decoration, not a control: it used to carry the score, so keeping it as a button would
        only duplicate the row's own name and action.
      */}
      {ranked && (
        <span className="chevron" aria-hidden="true">
          ›
        </span>
      )}
    </div>
  );
}
