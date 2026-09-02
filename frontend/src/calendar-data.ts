import type { CalendarEvent, Category, Item } from "./types";

export interface CalendarEntry {
  key: string;
  title: string;
  start: Date;
  end: Date;
  source: "cooper" | "google" | "gmail";
  category: Category;
  item?: Item;
  event?: CalendarEvent;
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

/** Merge local and external entries so Home and Calendar render the same records. */
export function calendarEntries(
  scheduled: Item[],
  events: CalendarEvent[],
  timeZone?: string,
  day?: string,
): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  for (const item of scheduled) {
    if (!item.start_at) continue;
    const start = new Date(item.start_at);
    const end = new Date(item.end_at ?? item.start_at);
    if (day && timeZone && !spansDay(start, end, day, timeZone)) continue;
    const source = item.source === "gmail" ? "gmail" : "cooper";
    entries.push({
      key: `c-${item.id}`,
      title: item.title,
      start,
      end,
      source,
      category: item.category,
      item: source === "cooper" ? item : undefined,
    });
  }

  for (const event of events) {
    if (event.mine) continue;
    const start = new Date(event.start_at);
    const end = new Date(event.end_at);
    if (day && timeZone && !spansDay(start, end, day, timeZone)) continue;
    entries.push({
      key: `${event.source}-${event.event_id ?? event.start_at}-${event.title}`,
      title: event.title,
      start,
      end,
      source: event.source,
      category: event.category,
      event,
    });
  }

  return entries.sort((a, b) => a.start.getTime() - b.start.getTime());
}
