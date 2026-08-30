import { Mascot } from "./Mascot";
import { Row } from "./Row";
import type { CalendarEvent, Item, Ranked, View } from "./types";

/**
 * The dashboard, and the screen the app opens on.
 *
 * Chat is a place to do things; this is the place to see them. Everything here is already in the
 * one `/api/today` payload, so this screen adds no request and cannot disagree with the others.
 *
 * Four sections, in the order a morning actually goes: the single next thing, what today looks
 * like, what is going wrong, and what is still waiting for a time. "What arrived while you were
 * away" is the fifth and is deliberately absent until there is a source that can deliver it.
 */

function clock(at: Date): string {
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** The local calendar day, in the same shape as `view.today`, so the two can be compared. */
function localDay(at: Date): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function greeting(at: Date): string {
  const hour = at.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/** Why this task is where it is, in the words you typed rather than the number behind them. */
function why(item: Item, today: string): string {
  if (!item.due) return "no deadline";
  const day = item.due.slice(0, 10);
  if (day < today) return "overdue";
  if (day === today) return "due today";
  const days = Math.round((new Date(day).getTime() - new Date(today).getTime()) / 86_400_000);
  return days === 1 ? "due tomorrow" : `due in ${days} days`;
}

interface Entry {
  key: string;
  title: string;
  start: Date;
  end: Date;
  source: "cooper" | "google" | "gmail";
  category: Item["category"];
  item?: Item;
}

/**
 * Today's blocks and today's events, in one ordered strip.
 *
 * Events Cooper created come back from Google as well, so `mine` ones are dropped and the local
 * copy is kept — that is the one with actions attached.
 */
function todayStrip(scheduled: Item[], events: CalendarEvent[], today: string): Entry[] {
  const entries: Entry[] = [];

  for (const item of scheduled) {
    if (!item.start_at) continue;
    const start = new Date(item.start_at);
    if (localDay(start) !== today) continue;
    const source = item.source === "gmail" ? "gmail" : "cooper";
    entries.push({
      key: `c-${item.id}`,
      title: item.title,
      start,
      end: new Date(item.end_at ?? item.start_at),
      source,
      category: item.category,
      item: source === "cooper" ? item : undefined,
    });
  }

  for (const event of events) {
    if (event.mine) continue;
    const start = new Date(event.start_at);
    if (localDay(start) !== today) continue;
    entries.push({
      key: `${event.source}-${event.start_at}-${event.title}`,
      title: event.title,
      start,
      end: new Date(event.end_at),
      source: event.source,
      category: event.category,
    });
  }

  return entries.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function Home({
  view,
  busy,
  onComplete,
  onOpen,
  onSchedule,
  onGoToChat,
}: {
  view: View;
  busy: boolean;
  onComplete: (id: string) => void;
  onOpen: (item: Item | Ranked) => void;
  onSchedule: () => void;
  onGoToChat: () => void;
}) {
  const today = view.today;
  const now = new Date(view.now);
  // Imported Gmail confirmations are commitments, not Cooper-owned work. They belong in the
  // agenda, but never in a list with Done/Pin/Delete actions.
  const shortlist = view.shortlist.filter((item) => item.source !== "gmail");
  const next = shortlist[0];

  const strip = todayStrip(view.scheduled, view.events, today);
  /** Still to come today, so the strip can lead with what has not happened yet. */
  const ahead = strip.filter((entry) => entry.end.getTime() >= now.getTime());

  const attention = shortlist.filter((item) => item.due !== null && item.due.slice(0, 10) <= today);
  const unbooked = shortlist.filter((item) => item.start_at === null);
  const scheduledCount = view.scheduled.filter(
    (item) => item.start_at && item.source !== "gmail",
  ).length;

  const nothingAtAll = shortlist.length === 0 && strip.length === 0;

  return (
    <div className="scroll">
      <h1 className="largetitle">
        {greeting(now)}
        <span className="largetitle__sub">
          {now.toLocaleDateString(undefined, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </span>
      </h1>

      {nothingAtAll && (
        <section className="empty">
          <Mascot name="cooper_waving" size="lg" decorative />
          <h2 className="empty__title">Nothing on today</h2>
          <p className="empty__text">
            Tell Cooper what&rsquo;s on your plate and it will show up here, ranked and ready to
            book.
          </p>
          <button type="button" className="btn btn--accent" onClick={onGoToChat}>
            Say something
          </button>
        </section>
      )}

      {next && (
        <section className="hero">
          <Mascot name="cooper_laptop" size="md" decorative />
          <div className="hero__body">
            <span className="hero__eyebrow">Up next</span>
            <h2 className="hero__title">{next.title}</h2>
            <span className="hero__meta">
              {[
                next.start_at ? clock(new Date(next.start_at)) : null,
                next.minutes ? `${next.minutes} min` : null,
                why(next, today),
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>
          <button
            type="button"
            className="btn btn--accent"
            disabled={busy}
            onClick={() => onComplete(next.id)}
          >
            Done
          </button>
        </section>
      )}

      {strip.length > 0 && (
        <section className="group">
          <div className="group__label">
            Today
            <span className="group__note">
              {ahead.length === 0 ? "all done" : `${ahead.length} left of ${strip.length}`}
            </span>
          </div>
          <div className="inset">
            {strip.map((entry) =>
              entry.item ? (
                <button
                  type="button"
                  key={entry.key}
                  className={`slot slot--${entry.source} cat--${entry.category}`}
                  aria-label={`${entry.title} · ${clock(entry.start)}–${clock(entry.end)}`}
                  onClick={() => onOpen(entry.item as Item)}
                >
                  <span className="slot__time">{clock(entry.start)}</span>
                  <span className="slot__title">{entry.title}</span>
                </button>
              ) : (
                // External commitments are facts, not Cooper-owned work. Nothing to act on, so
                // they are not buttons.
                <div
                  key={entry.key}
                  className={`slot slot--${entry.source} cat--${entry.category}`}
                  title={`${entry.title} · ${clock(entry.start)}–${clock(entry.end)}`}
                >
                  <span className="slot__time">{clock(entry.start)}</span>
                  <span className="slot__title">{entry.title}</span>
                  <span className="slot__from">
                    {entry.source === "gmail" ? "Gmail" : "Google"}
                  </span>
                </div>
              ),
            )}
          </div>
        </section>
      )}

      {attention.length > 0 && (
        <section className="group">
          <div className="group__label">
            Needs attention
            <span className="group__note">due today or past it</span>
          </div>
          <div className="inset">
            {attention.map((item) => (
              <Row
                key={item.id}
                item={item}
                today={today}
                busy={busy}
                onComplete={() => onComplete(item.id)}
                onOpen={() => onOpen(item)}
              />
            ))}
          </div>
        </section>
      )}

      {unbooked.length > 0 && (
        <section className="group">
          <div className="group__label">
            Waiting for a time
            <span className="group__note">
              {unbooked.length === 1 ? "1 task" : `${unbooked.length} tasks`}
            </span>
          </div>
          <div className="inset">
            {unbooked.map((item) => (
              <Row
                key={item.id}
                item={item}
                today={today}
                busy={busy}
                onComplete={() => onComplete(item.id)}
                onOpen={() => onOpen(item)}
              />
            ))}
          </div>
          {unbooked.some((item) => item.minutes !== null) && (
            <button
              type="button"
              className="btn btn--accent btn--full"
              disabled={busy}
              onClick={onSchedule}
            >
              Plan my day
            </button>
          )}
          <p className="hint">
            Anything without a length is never given a block, so errands stay on the list rather
            than eating an hour.
          </p>
        </section>
      )}

      {/*
        The whole ranked list, absorbed from what used to be its own Plan tab. The three sections
        above are today's slice of it — what is next, what is late, what is unbooked. This is the
        rest: everything open, in score order, so the backlog has one home rather than a second
        screen that mostly repeated this one.
      */}
      {shortlist.length > 0 && (
        <section className="group">
          <div className="group__label">
            Everything, ranked
            <span className="group__note">
              {shortlist.length} open{scheduledCount > 0 ? ` · ${scheduledCount} booked` : ""}
            </span>
          </div>
          <div className="inset">
            {shortlist.map((item) => (
              <Row
                key={item.id}
                item={item}
                today={today}
                busy={busy}
                onComplete={() => onComplete(item.id)}
                onOpen={() => onOpen(item)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
