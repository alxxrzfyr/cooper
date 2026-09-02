import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
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
  switch (status) {
    case "needsAction":
      return "Awaiting your response";
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "tentative":
      return "Maybe";
    default:
      return status.replaceAll("_", " ");
  }
}

function meetingLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Open meeting link";
  }
}

interface ParsedDescription {
  nodes: ReactNode[];
  links: string[];
  text: string;
}

const DESCRIPTION_TAGS = new Set(["B", "STRONG", "I", "EM", "U", "P", "DIV", "UL", "OL", "LI"]);
const BLOCKED_DESCRIPTION_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG"]);

function safeUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function parseDescription(html: string): ParsedDescription {
  const parsed = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const root = parsed.body.firstElementChild;
  const links: string[] = [];

  function renderChildren(parent: Node, path: string): ReactNode[] {
    return Array.from(parent.childNodes).flatMap((node, index) =>
      renderNode(node, `${path}-${index}`),
    );
  }

  function renderNode(node: Node, key: string): ReactNode[] {
    if (node.nodeType === Node.TEXT_NODE) return [node.textContent ?? ""];
    if (node.nodeType !== Node.ELEMENT_NODE) return [];
    const element = node as Element;
    if (BLOCKED_DESCRIPTION_TAGS.has(element.tagName)) return [];
    if (element.tagName === "BR") return [<br key={key} />];
    if (element.tagName === "A") {
      const href = safeUrl(element.getAttribute("href") ?? "");
      if (!href) return renderChildren(element, key);
      links.push(href);
      return [
        <a key={key} href={href} target="_blank" rel="noreferrer">
          {renderChildren(element, key)}
        </a>,
      ];
    }
    const children = renderChildren(element, key);
    if (!DESCRIPTION_TAGS.has(element.tagName)) return children;
    return [createElement(element.tagName.toLowerCase(), { key }, children)];
  }

  return {
    nodes: root ? renderChildren(root, "description") : [],
    links,
    text: root?.textContent?.replace(/\s+/g, " ").trim() ?? html.replace(/<[^>]*>/g, " ").trim(),
  };
}

function meetingFromDescription(description: ParsedDescription): {
  url: string | null;
  phone: string | null;
  meetingId: string | null;
  passcode: string | null;
} {
  const url =
    description.links.find((link) =>
      /zoom|meet\.google|teams\.microsoft|join|conference/i.test(link),
    ) ?? null;
  const phone = description.text.match(/\+\d[\d\s().-]{8,}\d/)?.[0]?.replace(/\s+/g, " ") ?? null;
  const meetingId =
    description.text.match(/meeting\s+id\s*[:#-]?\s*([\d ]{4,})/i)?.[1]?.trim() ?? null;
  const passcode =
    description.text.match(/(?:passcode|password)\s*[:#-]?\s*([\w-]+)/i)?.[1] ?? null;
  return { url, phone, meetingId, passcode };
}

/** Detail frame rendered in a portal, as a sheet on narrow screens and a card on wide screens. */
export function Frame({
  title,
  subtitle,
  colorDot,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  colorDot?: ReactNode;
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
          {colorDot}
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
  const [copied, setCopied] = useState(false);
  const organizer = event.organizer_name;
  const description = event.description ? parseDescription(event.description) : null;
  const meeting = meetingFromDescription(description ?? { nodes: [], links: [], text: "" });
  const meetingUrl = event.meeting_url ?? meeting.url;

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        /* clipboard blocked — do nothing */
      },
    );
  }

  const colorDot = <span className={`event-dot cat--${event.category}`} aria-hidden="true" />;

  return (
    <Frame title={event.title} subtitle="Google Calendar" colorDot={colorDot} onClose={onClose}>
      <div className="event-rows">
        {/* Date / time row — no icon, lives under the title */}
        <div className="event-row event-row--datetime">
          <span className="event-row__icon" aria-hidden="true">
            <svg
              viewBox="0 0 20 20"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="2" y="4" width="16" height="14" rx="2.5" />
              <path d="M2 8h16M6 2v4M14 2v4" strokeLinecap="round" />
            </svg>
          </span>
          <span className="event-row__body">
            <span className="event-row__primary">{eventWhen(event, timeZone)}</span>
          </span>
        </div>

        {/* Meeting / video row */}
        {meetingUrl && (
          <div className="event-row">
            <span className="event-row__icon" aria-hidden="true">
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M2 6.5A2.5 2.5 0 0 1 4.5 4h8A2.5 2.5 0 0 1 15 6.5v7A2.5 2.5 0 0 1 12.5 16h-8A2.5 2.5 0 0 1 2 13.5v-7Z" />
                <path d="M15 8l3-2v8l-3-2" strokeLinejoin="round" />
              </svg>
            </span>
            <div className="event-row__body">
              <a
                href={meetingUrl}
                target="_blank"
                rel="noreferrer"
                className="event-row__primary event-row__link"
              >
                Join meeting
              </a>
              <span className="event-row__sub">{meetingUrl}</span>
            </div>
            <button
              type="button"
              className="event-copy"
              aria-label="Copy meeting link"
              onClick={() => copyLink(meetingUrl)}
            >
              {copied ? (
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="2,9 6,13 14,4" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="5" y="1" width="9" height="11" rx="1.5" />
                  <rect x="2" y="4" width="9" height="11" rx="1.5" />
                </svg>
              )}
              <span className="visually-hidden">{copied ? "Copied" : "Copy"}</span>
            </button>
          </div>
        )}

        {/* Phone / dial-in row */}
        {meeting.phone && (
          <div className="event-row">
            <span className="event-row__icon" aria-hidden="true">
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  d="M3 3.5A1.5 1.5 0 0 1 4.5 2h2.128a1 1 0 0 1 .97.757l.812 3.25a1 1 0 0 1-.29.985L6.54 8.56A11.03 11.03 0 0 0 11.44 13.46l1.568-1.58a1 1 0 0 1 .985-.29l3.25.812A1 1 0 0 1 18 13.372V15.5A1.5 1.5 0 0 1 16.5 17C8.492 17 3 11.508 3 3.5Z"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div className="event-row__body">
              <a
                href={`tel:${meeting.phone.replace(/[^\d+]/g, "")}`}
                className="event-row__primary event-row__link"
              >
                Join by phone
              </a>
              <span className="event-row__sub">
                {meeting.phone}
                {meeting.meetingId && ` · ID: ${meeting.meetingId}`}
                {meeting.passcode && ` · Passcode: ${meeting.passcode}`}
              </span>
            </div>
          </div>
        )}

        {/* Location row */}
        {event.location && (
          <div className="event-row">
            <span className="event-row__icon" aria-hidden="true">
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  d="M10 2a6 6 0 0 1 6 6c0 4-6 11-6 11S4 12 4 8a6 6 0 0 1 6-6Z"
                  strokeLinejoin="round"
                />
                <circle cx="10" cy="8" r="2" />
              </svg>
            </span>
            <span className="event-row__body">
              <span className="event-row__primary">{event.location}</span>
            </span>
          </div>
        )}

        {/* Guests row */}
        {event.attendees && event.attendees.length > 0 && (
          <div className="event-row event-row--guests">
            <span className="event-row__icon" aria-hidden="true">
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="7" cy="6" r="3" />
                <path d="M1 17c0-3.314 2.686-5 6-5" />
                <circle cx="14" cy="7" r="2.5" />
                <path d="M10 17c0-2.761 1.79-4 4-4s4 1.239 4 4" />
              </svg>
            </span>
            <div className="event-row__body">
              <span className="event-row__primary">
                {event.attendees.length} guest{event.attendees.length === 1 ? "" : "s"}
              </span>
              <ul className="event-guests">
                {event.attendees.slice(0, 8).map((g) => (
                  <li key={g.email} className="event-guest">
                    <span className="event-guest__name">{g.name ?? g.email}</span>
                    {g.response_status && g.response_status !== "accepted" && (
                      <span className="event-guest__status">
                        {responseLabel(g.response_status)}
                      </span>
                    )}
                  </li>
                ))}
                {event.attendees.length > 8 && (
                  <li className="event-guest event-guest--more">
                    +{event.attendees.length - 8} more
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Organizer row */}
        {organizer && (
          <div className="event-row">
            <span className="event-row__icon" aria-hidden="true">
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="10" cy="7" r="4" />
                <path d="M2.5 19c0-4.142 3.358-7 7.5-7s7.5 2.858 7.5 7" strokeLinecap="round" />
              </svg>
            </span>
            <span className="event-row__body">
              <span className="event-row__label">Organizer</span>
              <span className="event-row__primary">{organizer}</span>
            </span>
          </div>
        )}

        {/* RSVP row */}
        {event.response_status && (
          <div className="event-row">
            <span className="event-row__icon" aria-hidden="true">
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M2 4h16v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Z" />
                <path d="M2 4l8 7 8-7" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="event-row__body">
              <span className="event-row__label">RSVP</span>
              <span className={`event-row__primary event-rsvp--${event.response_status}`}>
                {responseLabel(event.response_status)}
              </span>
            </span>
          </div>
        )}

        {/* Description row */}
        {description && description.nodes.length > 0 && (
          <div className="event-row event-row--description">
            <span className="event-row__icon" aria-hidden="true">
              <svg
                viewBox="0 0 20 20"
                width="16"
                height="16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M3 5h14M3 9h10M3 13h12M3 17h8" strokeLinecap="round" />
              </svg>
            </span>
            <div className="event-row__body frame__description">{description.nodes}</div>
          </div>
        )}
      </div>
    </Frame>
  );
}
