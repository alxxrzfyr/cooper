import { Mascot } from "./Mascot";
import type { CalendarEvent, Item, View } from "./types";

/** One thing at one time, whichever side it came from. */
interface Entry {
  key: string;
  title: string;
  start: Date;
  end: Date;
  source: "cadence" | "google";
  item?: Item;
}

const DAY_START = 7;
const DAY_END = 22;

function clock(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function dayKey(at: Date): string {
  return at.toDateString();
}

function dayLabel(at: Date, today: Date): string {
  const days = Math.round(
    (new Date(dayKey(at)).getTime() - new Date(dayKey(today)).getTime()) / 86_400_000,
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return at.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

/**
 * Merge both sides into one ordered agenda.
 *
 * Events Cadence created come back from Google too, so those are dropped: `mine` marks them and
 * the local copy is the one with the actions attached.
 */
function agenda(scheduled: Item[], events: CalendarEvent[]): Entry[] {
  const entries: Entry[] = [];

  for (const item of scheduled) {
    if (!item.start_at) continue;
    entries.push({
      key: `c-${item.id}`,
      title: item.title,
      start: new Date(item.start_at),
      end: new Date(item.end_at ?? item.start_at),
      source: "cadence",
      item,
    });
  }

  for (const event of events) {
    if (event.mine) continue;
    entries.push({
      key: `g-${event.start_at}-${event.title}`,
      title: event.title,
      start: new Date(event.start_at),
      end: new Date(event.end_at),
      source: "google",
    });
  }

  return entries.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function groupByDay(entries: Entry[]): Array<[string, Entry[]]> {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const key = dayKey(entry.start);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups];
}

/**
 * The calendar.
 *
 * A day timeline rather than a month grid: on a personal calendar the useful question is "what
 * does today look like and where are the gaps", and a month of tiny boxes answers neither.
 * Cadence's own blocks are filled in the accent colour; your existing events are outlined, so it
 * is obvious at a glance which ones the app placed.
 */
export function Calendar({
  view,
  busy,
  onComplete,
  onDrop,
}: {
  view: View;
  busy: boolean;
  onComplete: (id: string) => void;
  onDrop: (id: string) => void;
}) {
  const entries = agenda(view.scheduled, view.events);
  const today = new Date(view.now);
  const days = groupByDay(entries);
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, index) => index + DAY_START);

  if (entries.length === 0) {
    return (
      <div className="scroll">
        <h1 className="largetitle">
          Calendar
          <span className="largetitle__sub">
            {view.calendar.connected
              ? `Synced with ${view.calendar.email ?? "Google"}`
              : "On this device"}
          </span>
        </h1>
        <section className="empty">
          <Mascot name="empty_state_windows" size="lg" shape="squircle" decorative />
          <h2 className="empty__title">Nothing on the calendar</h2>
          <p className="empty__text">
            Add a task with a time estimate and say &ldquo;plan my day&rdquo;, or give something an
            exact time like &ldquo;dentist thursday 3pm&rdquo;.
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="scroll">
      <h1 className="largetitle">
        Calendar
        <span className="largetitle__sub">
          {view.calendar.connected
            ? `Synced with ${view.calendar.email ?? "Google"}`
            : "On this device · connect Google in Setup"}
        </span>
      </h1>

      {days.map(([key, dayEntries]) => (
        <section className="group" key={key}>
          <div className="daygroup">
            {dayLabel(new Date(key), today)}
            <span className="group__note">
              {dayEntries.length} {dayEntries.length === 1 ? "thing" : "things"}
            </span>
          </div>

          <div className="daygrid">
            {hours.map((hour) => {
              const inHour = dayEntries.filter((entry) => entry.start.getHours() === hour);
              const working =
                hour >= view.hours.start_hour &&
                hour < view.hours.end_hour &&
                view.hours.weekdays.includes((new Date(key).getDay() + 6) % 7);

              return (
                <div className="daygrid__row" key={hour}>
                  <span className="daygrid__hour">{String(hour).padStart(2, "0")}</span>
                  <div className={`daygrid__slot ${working ? "daygrid__slot--open" : ""}`}>
                    {inHour.map((entry) => (
                      <div
                        className={`slot slot--${entry.source}`}
                        key={entry.key}
                        title={`${entry.title} · ${clock(entry.start)}–${clock(entry.end)}`}
                      >
                        <span className="slot__time">{clock(entry.start)}</span>
                        <span className="slot__title">{entry.title}</span>
                        {entry.source === "google" ? (
                          <span className="slot__from">Google</span>
                        ) : (
                          <span className="slot__actions">
                            <button
                              type="button"
                              className="iconbtn"
                              aria-label={`Mark “${entry.title}” done`}
                              disabled={busy}
                              onClick={() => entry.item && onComplete(entry.item.id)}
                            >
                              ✓
                            </button>
                            <button
                              type="button"
                              className="iconbtn"
                              aria-label={`Drop “${entry.title}”`}
                              disabled={busy}
                              onClick={() => entry.item && onDrop(entry.item.id)}
                            >
                              ✕
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      <p className="hint">
        Shaded hours are yours to book. Filled entries are ones Cadence placed; outlined ones came
        from your calendar.
      </p>
    </div>
  );
}
