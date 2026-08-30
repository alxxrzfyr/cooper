import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { Item, Ranked } from "./types";

const CATEGORY_LABEL: Record<string, string> = {
  academics: "Academics",
  work: "Work",
  organizations: "Organizations",
  personal: "Personal",
};

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function longDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

/**
 * One thing at a time, with the rest of the app pushed out of focus.
 *
 * A bottom sheet on a phone and a centred card on a desktop, from one component: the difference
 * is which CSS rules apply at which width, so there is no width listener and nothing to keep in
 * sync. Escape closes it, so does the backdrop, and focus moves inside on open so a keyboard is
 * not left behind on the page underneath.
 *
 * It renders into `document.body` rather than where it is written. `position: fixed` covers the
 * viewport only if no ancestor constrains it, and the calendar renders its frames inside
 * `.scroll`, whose `> *` rule sets `width: min(760px, 100%)` on every child to keep text columns
 * readable. That clamped the blur to a 760px strip in the middle of a wide window and left the
 * rail and the margins perfectly sharp. A portal is immune to every rule of that shape.
 */
export function Frame({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll under a sheet, which on iOS looks like the sheet drifting.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="frame" role="presentation" onClick={onClose}>
      <div
        className="frame__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panel}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="frame__grip" aria-hidden="true" />

        <header className="frame__head">
          <div className="frame__heading">
            <h2 className="frame__title">{title}</h2>
            {subtitle && <span className="frame__sub">{subtitle}</span>}
          </div>
          <button type="button" className="frame__close" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="frame__body">{children}</div>
        {footer && <div className="frame__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Everything known about one task or event, and the three things you can do to it. */
export function TaskFrame({
  item,
  today,
  busy,
  onClose,
  onComplete,
  onPin,
  onDrop,
}: {
  item: Item | Ranked;
  today: string;
  busy: boolean;
  onClose: () => void;
  onComplete: () => void;
  onPin: () => void;
  onDrop: () => void;
}) {
  const late = item.due !== null && item.due.slice(0, 10) < today;

  const facts: Array<[string, ReactNode]> = [
    [item.kind === "event" ? "Event" : "Task", CATEGORY_LABEL[item.category] ?? item.category],
  ];
  if (item.start_at) {
    facts.push([
      "When",
      `${longDay(item.start_at)}, ${clock(item.start_at)}${
        item.end_at ? `–${clock(item.end_at)}` : ""
      }`,
    ]);
  }
  if (item.minutes !== null) facts.push(["Takes", `${item.minutes} minutes`]);
  if (item.due) {
    facts.push([late ? "Overdue" : "Due", longDay(item.due)]);
  }
  if (item.pinned) facts.push(["Pinned", "Kept at the top of today"]);
  if (item.google_event_id) facts.push(["Calendar", "In Google Calendar"]);
  if (item.status !== "open") facts.push(["Status", item.status === "done" ? "Done" : "Dropped"]);

  return (
    <Frame
      title={item.title}
      onClose={onClose}
      footer={
        item.status === "open" ? (
          <>
            <button
              type="button"
              className="btn btn--good"
              disabled={busy}
              onClick={() => {
                onComplete();
                onClose();
              }}
            >
              Done
            </button>
            <button
              type="button"
              className="btn btn--quiet"
              aria-pressed={Boolean(item.pinned)}
              disabled={busy}
              onClick={onPin}
            >
              {item.pinned ? "Unpin" : "Pin"}
            </button>
            <button
              type="button"
              className="btn btn--bad"
              disabled={busy}
              onClick={() => {
                onDrop();
                onClose();
              }}
            >
              Delete
            </button>
          </>
        ) : null
      }
    >
      <dl className="facts">
        {facts.map(([label, value]) => (
          <div className="facts__row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {item.notes && <p className="frame__notes">{item.notes}</p>}
    </Frame>
  );
}
