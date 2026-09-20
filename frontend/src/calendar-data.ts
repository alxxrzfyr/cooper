import type { CalendarEvent, Category, Item, PlanningCommitment } from "./types";

export interface CalendarEntry {
  key: string;
  title: string;
  start: Date;
  end: Date;
  source: "cooper" | "google" | "gmail" | "icloud";
  category: Category;
  item?: Item;
  event?: CalendarEvent;
  conflict?: boolean;
}

/** The one-line context shown beneath an imported event in compact views. */
export function calendarEventContext(event: CalendarEvent): string {
  if (event.location) return event.location;
  if (event.meeting_url) {
    try {
      return `Online · ${new URL(event.meeting_url).hostname.replace(/^www\./, "")}`;
    } catch {
      return "Online meeting";
    }
  }
  if (event.source === "gmail") return "Gmail";
  return event.source === "icloud" ? "iCloud Calendar" : "Google Calendar";
}

function zonedDay(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function spansDay(start: Date, end: Date, day: string, timeZone: string): boolean {
  const lastMoment = new Date(Math.max(start.getTime(), end.getTime() - 1));
  return zonedDay(start, timeZone) <= day && zonedDay(lastMoment, timeZone) >= day;
}

/** Format the backend's canonical commitments for Calendar and Home. */
export function calendarEntries(
  commitments: PlanningCommitment[],
  timeZone?: string,
  day?: string,
): CalendarEntry[] {
  const entries: CalendarEntry[] = commitments.flatMap((commitment) => {
    const start = new Date(commitment.start_at);
    const end = new Date(commitment.end_at);
    if (day && timeZone && !spansDay(start, end, day, timeZone)) return [];
    const source = ["cooper", "google", "gmail", "icloud"].includes(commitment.source)
      ? (commitment.source as CalendarEntry["source"])
      : "google";
    return [
      {
        key: commitment.id,
        title: commitment.title,
        start,
        end,
        source,
        category: commitment.category,
        item: commitment.item,
        event: commitment.event,
        conflict: commitment.conflict,
      },
    ];
  });

  entries.sort((a, b) => a.start.getTime() - b.start.getTime());
  return entries;
}
