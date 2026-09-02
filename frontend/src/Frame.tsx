import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import type { CalendarEvent, Item, Ranked } from "./types";

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

function eventWhen(event: CalendarEvent, timeZone: string): string {
  const zone = event.time_zone ?? timeZone;
  if (event.all_day) {
    return new Date(event.start_at).toLocaleDateString(undefined, {
      timeZone: zone,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return `${new Date(event.start_at).toLocaleString(undefined, {
    timeZone: zone,
    dateStyle: "full",
    timeStyle: "short",
  })}–${new Date(event.end_at).toLocaleTimeString(undefined, {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })}`;
}

function responseLabel(status: string): string {
  return status.replaceAll("_", " ");
}

/** Detail frame rendered in a portal, as a sheet on narrow screens and a card on wide screens. */
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

/** Complete details for an event read from Google Calendar. */
export function CalendarEventFrame({
  event,
  timeZone,
  onClose,
}: {
  event: CalendarEvent;
  timeZone: string;
  onClose: () => void;
}) {
  const organizer = [event.organizer_name, event.organizer_email].filter(Boolean).join(" · ");
  const facts: Array<[string, ReactNode]> = [["When", eventWhen(event, timeZone)]];

  if (event.meeting_url) {
    facts.push([
      "Meeting",
      <a href={event.meeting_url} target="_blank" rel="noreferrer">
        {event.meeting_url}
      </a>,
    ]);
  }
  if (event.location) facts.push(["Location", event.location]);
  if (organizer) facts.push(["Organizer", organizer]);
  if (event.response_status) facts.push(["RSVP", responseLabel(event.response_status)]);

  return (
    <Frame title={event.title} subtitle="Google Calendar" onClose={onClose}>
      <dl className="facts">
        {facts.map(([label, value]) => (
          <div className="facts__row" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      {event.attendees && event.attendees.length > 0 && (
        <section className="frame__section">
          <h3>Guests</h3>
          <ul className="frame__list">
            {event.attendees.map((attendee) => (
              <li key={attendee.email}>
                <span>{attendee.name || attendee.email}</span>
                {attendee.name && <small>{attendee.email}</small>}
                {attendee.response_status && (
                  <small>{responseLabel(attendee.response_status)}</small>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {event.description && <p className="frame__notes">{event.description}</p>}
    </Frame>
  );
}
