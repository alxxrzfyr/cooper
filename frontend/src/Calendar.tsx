import { useState } from "react";

import { CalendarEventFrame, Frame, TaskFrame } from "./Frame";

import { Mascot } from "./Mascot";
import { calendarEntries, calendarEventContext, type CalendarEntry } from "./calendar-data";
import type { CalendarEvent, Category, Item, View } from "./types";

/** How much calendar to show at once. */
type Mode = "day" | "week" | "month";

const MODES: Mode[] = ["day", "week", "month"];
const MODE_LABEL: Record<Mode, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};
const MODE_KEY = "cooper.calview.v1";

const CATEGORIES: Category[] = ["academics", "work", "organizations", "personal"];
const CATEGORY_LABEL: Record<Category, string> = {
  academics: "Academics",
  work: "Work",
  organizations: "Orgs",
  personal: "Personal",
};

const DAY_START = 7;
const DAY_END = 22;
const HOURS = Array.from({ length: DAY_END - DAY_START }, (_, index) => index + DAY_START);
const WEEKDAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTH_ROWS = 6;

/** Field getters below all read a `Date` as wall-clock time in a named zone, not the browser's
 *  local zone. The backend places `start_at` from `COOPER_TIMEZONE`; a browser in any other zone
 *  must not shift which day or hour a booked block appears to land on. */
type ZonedFields = { year: number; month: number; day: number; hour: number; weekday: number };

const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
      weekday: "short",
    });
    zonedFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

/** The wall-clock date and hour a UTC instant reads as inside `timeZone`. */
function zonedFields(at: Date, timeZone: string): ZonedFields {
  const parts = zonedFormatter(timeZone).formatToParts(at);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  // Midnight renders as "24" under hour12: false in some engines; normalize it to 0.
  const hour = Number(get("hour")) % 24;
  return {
    year: Number(get("year")),
    month: Number(get("month")) - 1,
    day: Number(get("day")),
    hour,
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/** A sortable key for the wall-clock day a UTC instant falls on inside `timeZone`. */
function zonedDayKey(at: Date, timeZone: string): number {
  const { year, month, day } = zonedFields(at, timeZone);
  return year * 10000 + month * 100 + day;
}

/** Midnight, in `timeZone`, on the wall-clock day `at` falls on there — kept as a UTC Date so
 *  arithmetic (`getTime()`, `addDays`) still works; only ever read back through `zonedFields`. */
function startOfDay(at: Date, timeZone: string): Date {
  const { year, month, day } = zonedFields(at, timeZone);
  return new Date(Date.UTC(year, month, day));
}

function addDays(at: Date, days: number, timeZone: string): Date {
  const { year, month, day } = zonedFields(at, timeZone);
  return new Date(Date.UTC(year, month, day + days));
}

/** Return the Monday that contains a date. */
function startOfWeek(at: Date, timeZone: string): Date {
  return addDays(at, -zonedFields(at, timeZone).weekday, timeZone);
}

function startOfMonth(at: Date, timeZone: string): Date {
  const { year, month } = zonedFields(at, timeZone);
  return new Date(Date.UTC(year, month, 1));
}

function sameDay(a: Date, b: Date, timeZone: string): boolean {
  return zonedDayKey(a, timeZone) === zonedDayKey(b, timeZone);
}

function clock(at: Date, timeZone: string): string {
  return at.toLocaleTimeString(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayName(at: Date, timeZone: string): string {
  return at.toLocaleDateString(undefined, { timeZone, weekday: "short" });
}

function dayNumber(at: Date, timeZone: string): number {
  return zonedFields(at, timeZone).day;
}

function monthOf(at: Date, timeZone: string): number {
  return zonedFields(at, timeZone).month;
}

function dayLabel(at: Date, today: Date, timeZone: string): string {
  const days = Math.round(
    (startOfDay(at, timeZone).getTime() - startOfDay(today, timeZone).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return at.toLocaleDateString(undefined, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/** What the arrows are currently pointing at. */
function rangeLabel(mode: Mode, anchor: Date, today: Date, timeZone: string): string {
  if (mode === "day") return dayLabel(anchor, today, timeZone);
  if (mode === "month") {
    return anchor.toLocaleDateString(undefined, {
      timeZone,
      month: "long",
      year: "numeric",
    });
  }
  const start = startOfWeek(anchor, timeZone);
  const full = { timeZone, day: "numeric", month: "short" } as const;
  return `${start.toLocaleDateString(undefined, full)} – ${addDays(start, 6, timeZone).toLocaleDateString(undefined, full)}`;
}

function step(mode: Mode, anchor: Date, delta: number, timeZone: string): Date {
  if (mode === "day") return addDays(anchor, delta, timeZone);
  if (mode === "week") return addDays(anchor, delta * 7, timeZone);
  const { year, month } = zonedFields(anchor, timeZone);
  return new Date(Date.UTC(year, month + delta, 1));
}

/** The days a mode puts on screen. A month always shows six weeks so it never changes height. */
function daysShown(mode: Mode, anchor: Date, timeZone: string): Date[] {
  if (mode === "day") return [startOfDay(anchor, timeZone)];
  if (mode === "week") {
    const start = startOfWeek(anchor, timeZone);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index, timeZone));
  }
  const start = startOfWeek(startOfMonth(anchor, timeZone), timeZone);
  return Array.from({ length: MONTH_ROWS * 7 }, (_, index) => addDays(start, index, timeZone));
}

function loadMode(): Mode {
  try {
    const saved = localStorage.getItem(MODE_KEY);
    return MODES.includes(saved as Mode) ? (saved as Mode) : "day";
  } catch {
    return "day";
  }
}

function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // A calendar that forgets its last view is not worth an error.
  }
}

/** Calendar views for day, week, and month ranges. */
export function Calendar({
  view,
  busy,
  onComplete,
  onPin,
  onDrop,
}: {
  view: View;
  busy: boolean;
  onComplete: (id: string) => void;
  onPin: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const today = new Date(view.now);
  const zone = view.timezone;
  const [mode, setMode] = useState<Mode>(loadMode);
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(today, zone));
  const [picked, setPicked] = useState<Date | null>(null);
  const [chosen, setChosen] = useState<Item | null>(null);
  const [chosenEvent, setChosenEvent] = useState<CalendarEvent | null>(null);

  const entries = calendarEntries(view.scheduled, view.events, zone);
  const days = daysShown(mode, anchor, zone);

  /** Which day a switch to day view should land on: the one whose frame you last opened. */
  const dayOf = picked ?? anchor;

  function choose(next: Mode): void {
    if (next === "day" && mode === "month") setAnchor(dayOf);
    setMode(next);
    saveMode(next);
  }

  function openDay(target: Date): void {
    setAnchor(target);
    setMode("day");
    saveMode("day");
  }

  function working(day: Date, hour: number): boolean {
    return (
      hour >= view.hours.start_hour &&
      hour < view.hours.end_hour &&
      view.hours.weekdays.includes(zonedFields(day, zone).weekday)
    );
  }

  function on(day: Date, hour?: number): CalendarEntry[] {
    return entries.filter(
      (entry) => spansDay(entry, day) && (hour === undefined || entryHour(entry, day) === hour),
    );
  }

  function spansDay(entry: CalendarEntry, day: Date): boolean {
    const dayStart = startOfDay(day, zone);
    const nextDay = addDays(day, 1, zone);
    return entry.start < nextDay && entry.end > dayStart;
  }

  function entryHour(entry: CalendarEntry, day: Date): number {
    return sameDay(entry.start, day, zone) ? zonedFields(entry.start, zone).hour : DAY_START;
  }

  const header = (
    <>
      <h1 className="largetitle">
        Calendar
        <span className="largetitle__sub">
          {view.calendar.connected
            ? `Synced with ${view.calendar.email ?? "Google"}`
            : "On this device · connect Google in Settings"}
        </span>
      </h1>

      <div className="calbar">
        <div className="segmented segmented--inline" role="group" aria-label="Calendar range">
          {MODES.map((option) => (
            <button
              type="button"
              key={option}
              className="segment"
              aria-pressed={mode === option}
              onClick={() => choose(option)}
            >
              {MODE_LABEL[option]}
            </button>
          ))}
        </div>

        <div className="calnav">
          <button
            type="button"
            className="iconbtn"
            aria-label={`Previous ${mode}`}
            onClick={() => setAnchor(step(mode, anchor, -1, zone))}
          >
            ‹
          </button>
          <span className="calnav__label">{rangeLabel(mode, anchor, today, zone)}</span>
          <button
            type="button"
            className="iconbtn"
            aria-label={`Next ${mode}`}
            onClick={() => setAnchor(step(mode, anchor, 1, zone))}
          >
            ›
          </button>
          {days.some((day) => sameDay(day, today, zone)) ? null : (
            <button
              type="button"
              className="ghostbtn"
              onClick={() => setAnchor(startOfDay(today, zone))}
            >
              Today
            </button>
          )}
        </div>
      </div>
    </>
  );

  const legend = (
    <ul className="legend">
      {CATEGORIES.map((category) => (
        <li className={`legend__item cat--${category}`} key={category}>
          <span className="legend__dot" aria-hidden="true" />
          {CATEGORY_LABEL[category]}
        </li>
      ))}
    </ul>
  );

  if (entries.length === 0) {
    return (
      <div className="scroll scroll--wide">
        {header}
        <section className="empty">
          <Mascot name="cooper_reading" size="lg" decorative />
          <h2 className="empty__title">Nothing on the calendar</h2>
          <p className="empty__text">
            Add a task with a time estimate and say &ldquo;plan my day&rdquo;, or give something an
            exact time like &ldquo;dentist thursday 3pm&rdquo;.
          </p>
        </section>
      </div>
    );
  }

  /** Render one entry in the timed grid. */
  function block(entry: CalendarEntry, compact: boolean) {
    const label = `${entry.title} · ${clock(entry.start, zone)}–${clock(entry.end, zone)} · ${
      CATEGORY_LABEL[entry.category]
    }`;

    if (!entry.item && !entry.event) {
      return (
        <div
          className={`slot slot--${entry.source} cat--${entry.category}`}
          key={entry.key}
          title={label}
        >
          <span className="slot__time">{clock(entry.start, zone)}</span>
          <span className="slot__title">{entry.title}</span>
          {compact ? null : (
            <span className="slot__from">{entry.source === "gmail" ? "Gmail" : "Google"}</span>
          )}
        </div>
      );
    }

    return (
      <button
        type="button"
        className={`slot slot--${entry.source} cat--${entry.category} ${entry.event?.all_day ? "slot--all-day" : ""}`}
        key={entry.key}
        title={label}
        aria-label={label}
        onClick={() => {
          if (entry.item) setChosen(entry.item);
          else if (entry.event) setChosenEvent(entry.event);
        }}
      >
        <span className="slot__time">
          {entry.event?.all_day ? "All day" : clock(entry.start, zone)}
        </span>
        <span className="slot__title">{entry.title}</span>
        {entry.event && (
          <>
            <span className="slot__from">
              {entry.event.source === "gmail" ? "Gmail" : "Google"}
            </span>
            <span className="slot__detail">{calendarEventContext(entry.event)}</span>
          </>
        )}
      </button>
    );
  }

  return (
    <div className="scroll scroll--wide">
      {header}

      {mode === "day" ? (
        <section className="group">
          <div className="daygroup">
            {on(anchor).length} {on(anchor).length === 1 ? "thing" : "things"}
          </div>
          <div className="daygrid">
            {HOURS.map((hour) => (
              <div className="daygrid__row" key={hour}>
                <span className="daygrid__hour">{String(hour).padStart(2, "0")}</span>
                <div
                  className={`daygrid__slot ${working(anchor, hour) ? "daygrid__slot--open" : ""}`}
                >
                  {on(anchor, hour).map((entry) => block(entry, false))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {mode === "week" ? (
        <section className="group weekscroll">
          <div className="weekgrid">
            <div className="weekgrid__headrow">
              <span />
              {days.map((day) => (
                <button
                  type="button"
                  key={day.toDateString()}
                  className={`weekgrid__head ${sameDay(day, today, zone) ? "is-today" : ""}`}
                  onClick={() => openDay(day)}
                >
                  <span className="weekgrid__name">{dayName(day, zone)}</span>
                  <span className="weekgrid__num">{dayNumber(day, zone)}</span>
                </button>
              ))}
            </div>

            {HOURS.map((hour) => (
              <div className="weekgrid__line" key={hour}>
                <span className="daygrid__hour">{String(hour).padStart(2, "0")}</span>
                {days.map((day) => (
                  <div
                    key={day.toDateString()}
                    className={`weekgrid__cell ${working(day, hour) ? "daygrid__slot--open" : ""}`}
                  >
                    {on(day, hour).map((entry) => block(entry, true))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {mode === "month" ? (
        <section className="group">
          <div className="monthgrid">
            {WEEKDAY_INITIALS.map((initial, index) => (
              <span className="monthgrid__head" key={index} aria-hidden="true">
                {initial}
              </span>
            ))}
            {days.map((day) => {
              const mine = on(day);
              const outside = monthOf(day, zone) !== monthOf(anchor, zone);
              return (
                <button
                  type="button"
                  key={day.toDateString()}
                  className={`monthcell ${outside ? "is-outside" : ""} ${
                    sameDay(day, today, zone) ? "is-today" : ""
                  }`}
                  aria-label={`${day.toLocaleDateString(undefined, {
                    timeZone: zone,
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}, ${mine.length} ${mine.length === 1 ? "thing" : "things"}`}
                  onClick={() => setPicked(day)}
                >
                  <span className="monthcell__num">{dayNumber(day, zone)}</span>
                  {mine.slice(0, 3).map((entry) => (
                    <span
                      className={`pill pill--${entry.source} cat--${entry.category}`}
                      key={entry.key}
                    >
                      {entry.title}
                    </span>
                  ))}
                  {mine.length > 3 ? (
                    <span className="monthcell__more">+{mine.length - 3}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      <footer className="calfoot">
        {legend}
        <p className="hint">
          Colour is the category. Shaded hours are yours to book. Filled entries are ones Cooper
          placed; outlined ones came from Google Calendar or Gmail.
        </p>
      </footer>

      {picked && !chosen && (
        <Frame
          title={dayLabel(picked, today, zone)}
          subtitle={`${on(picked).length} ${on(picked).length === 1 ? "thing" : "things"}`}
          onClose={() => setPicked(null)}
          footer={
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                openDay(picked);
                setPicked(null);
              }}
            >
              Open this day
            </button>
          }
        >
          {on(picked).length === 0 ? (
            <p className="frame__empty">Nothing on this day.</p>
          ) : (
            <div className="framelist">{on(picked).map((entry) => block(entry, false))}</div>
          )}
        </Frame>
      )}

      {chosen && (
        <TaskFrame
          item={chosen}
          today={view.today}
          busy={busy}
          onClose={() => setChosen(null)}
          onComplete={() => onComplete(chosen.id)}
          onPin={() => onPin(chosen.id)}
          onDrop={() => onDrop(chosen.id)}
        />
      )}

      {chosenEvent && (
        <CalendarEventFrame
          event={chosenEvent}
          timeZone={zone}
          onClose={() => setChosenEvent(null)}
        />
      )}
    </div>
  );
}
