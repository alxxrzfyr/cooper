import { useState } from "react";

import { Frame, TaskFrame } from "./Frame";

import { Mascot } from "./Mascot";
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

/** One thing at one time, whichever side it came from. */
interface Entry {
  key: string;
  title: string;
  start: Date;
  end: Date;
  source: "cooper" | "google" | "gmail";
  category: Category;
  item?: Item;
}

function startOfDay(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}

function addDays(at: Date, days: number): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days);
}

/** Return the Monday that contains a date. */
function startOfWeek(at: Date): Date {
  return addDays(at, -((at.getDay() + 6) % 7));
}

function startOfMonth(at: Date): Date {
  return new Date(at.getFullYear(), at.getMonth(), 1);
}

function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

function clock(at: Date): string {
  return at.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayName(at: Date): string {
  return at.toLocaleDateString(undefined, { weekday: "short" });
}

function dayLabel(at: Date, today: Date): string {
  const days = Math.round((startOfDay(at).getTime() - startOfDay(today).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  return at.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

/** What the arrows are currently pointing at. */
function rangeLabel(mode: Mode, anchor: Date, today: Date): string {
  if (mode === "day") return dayLabel(anchor, today);
  if (mode === "month") {
    return anchor.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
    });
  }
  const start = startOfWeek(anchor);
  const full = { day: "numeric", month: "short" } as const;
  return `${start.toLocaleDateString(undefined, full)} – ${addDays(start, 6).toLocaleDateString(undefined, full)}`;
}

function step(mode: Mode, anchor: Date, delta: number): Date {
  if (mode === "day") return addDays(anchor, delta);
  if (mode === "week") return addDays(anchor, delta * 7);
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
}

/** The days a mode puts on screen. A month always shows six weeks so it never changes height. */
function daysShown(mode: Mode, anchor: Date): Date[] {
  if (mode === "day") return [startOfDay(anchor)];
  if (mode === "week") {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }
  const start = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: MONTH_ROWS * 7 }, (_, index) => addDays(start, index));
}

/** Merge local and external entries without duplicating local blocks. */
function agenda(scheduled: Item[], events: CalendarEvent[]): Entry[] {
  const entries: Entry[] = [];

  for (const item of scheduled) {
    if (!item.start_at) continue;
    const source = item.source === "gmail" ? "gmail" : "cooper";
    entries.push({
      key: `c-${item.id}`,
      title: item.title,
      start: new Date(item.start_at),
      end: new Date(item.end_at ?? item.start_at),
      source,
      category: item.category,
      item: source === "cooper" ? item : undefined,
    });
  }

  for (const event of events) {
    if (event.mine) continue;
    entries.push({
      key: `${event.source}-${event.start_at}-${event.title}`,
      title: event.title,
      start: new Date(event.start_at),
      end: new Date(event.end_at),
      source: event.source,
      category: event.category,
    });
  }

  return entries.sort((a, b) => a.start.getTime() - b.start.getTime());
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
  const [mode, setMode] = useState<Mode>(loadMode);
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(today));
  const [picked, setPicked] = useState<Date | null>(null);
  const [chosen, setChosen] = useState<Item | null>(null);

  const entries = agenda(view.scheduled, view.events);
  const days = daysShown(mode, anchor);

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
      view.hours.weekdays.includes((day.getDay() + 6) % 7)
    );
  }

  function on(day: Date, hour?: number): Entry[] {
    return entries.filter(
      (entry) =>
        sameDay(entry.start, day) && (hour === undefined || entry.start.getHours() === hour),
    );
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
            onClick={() => setAnchor(step(mode, anchor, -1))}
          >
            ‹
          </button>
          <span className="calnav__label">{rangeLabel(mode, anchor, today)}</span>
          <button
            type="button"
            className="iconbtn"
            aria-label={`Next ${mode}`}
            onClick={() => setAnchor(step(mode, anchor, 1))}
          >
            ›
          </button>
          {days.some((day) => sameDay(day, today)) ? null : (
            <button type="button" className="ghostbtn" onClick={() => setAnchor(startOfDay(today))}>
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
  function block(entry: Entry, compact: boolean) {
    const label = `${entry.title} · ${clock(entry.start)}–${clock(entry.end)} · ${
      CATEGORY_LABEL[entry.category]
    }`;

    if (!entry.item) {
      return (
        <div
          className={`slot slot--${entry.source} cat--${entry.category}`}
          key={entry.key}
          title={label}
        >
          <span className="slot__time">{clock(entry.start)}</span>
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
        className={`slot slot--${entry.source} cat--${entry.category}`}
        key={entry.key}
        title={label}
        aria-label={label}
        onClick={() => setChosen(entry.item ?? null)}
      >
        <span className="slot__time">{clock(entry.start)}</span>
        <span className="slot__title">{entry.title}</span>
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
                  className={`weekgrid__head ${sameDay(day, today) ? "is-today" : ""}`}
                  onClick={() => openDay(day)}
                >
                  <span className="weekgrid__name">{dayName(day)}</span>
                  <span className="weekgrid__num">{day.getDate()}</span>
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
              const outside = day.getMonth() !== anchor.getMonth();
              return (
                <button
                  type="button"
                  key={day.toDateString()}
                  className={`monthcell ${outside ? "is-outside" : ""} ${
                    sameDay(day, today) ? "is-today" : ""
                  }`}
                  aria-label={`${day.toLocaleDateString(undefined, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}, ${mine.length} ${mine.length === 1 ? "thing" : "things"}`}
                  onClick={() => setPicked(day)}
                >
                  <span className="monthcell__num">{day.getDate()}</span>
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
          title={dayLabel(picked, today)}
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
    </div>
  );
}
