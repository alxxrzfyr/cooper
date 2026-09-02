import { createElement, useEffect, useRef, type ReactNode } from "react";
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
  const organizer = event.organizer_name;
  const description = event.description ? parseDescription(event.description) : null;
  const meeting = meetingFromDescription(description ?? { nodes: [], links: [], text: "" });
  const meetingUrl = event.meeting_url ?? meeting.url;
  const facts: Array<[string, ReactNode]> = [["When", eventWhen(event, timeZone)]];

  if (meetingUrl) {
    facts.push([
      "Meeting",
      <span className="event-link">
        <a href={meetingUrl} target="_blank" rel="noreferrer">
          Join meeting
        </a>
        <small>{meetingLabel(meetingUrl)}</small>
      </span>,
    ]);
  }
  if (meeting.phone) {
    facts.push([
      "Phone",
      <a href={`tel:${meeting.phone.replace(/[^\d+]/g, "")}`}>{meeting.phone}</a>,
    ]);
  }
  if (meeting.meetingId) facts.push(["Meeting ID", meeting.meetingId]);
  if (meeting.passcode) facts.push(["Passcode", meeting.passcode]);
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

      {description && description.nodes.length > 0 && (
        <div className="frame__notes frame__description">{description.nodes}</div>
      )}
    </Frame>
  );
}
