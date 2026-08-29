import { useCallback, useEffect, useRef, useState } from "react";

import "./theme.css";
import { api } from "./api";
import { Mascot } from "./Mascot";
import { NavBar, TabBar, type Tab } from "./Nav";
import { Row } from "./Row";
import { ApiError, type Item, type Reply, type ReplyKind, type View } from "./types";

/** What the reply strip is showing. Errors and questions are replies too, not exceptions. */
type Shown = { kind: ReplyKind; message: string; chip?: string[] };

const EXAMPLES = [
  "write the quarterly report, 90m, important, due friday",
  "dentist thursday 3pm",
  "plan my day",
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function urgency(score: number): string {
  if (score >= 0.6) return "do this first";
  if (score >= 0.35) return "worth doing today";
  return "can wait";
}

/** Group booked items by local day, so Calendar reads as a schedule rather than a list. */
function byDay(items: Item[]): Array<[string, Item[]]> {
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    if (!item.start_at) continue;
    const label = new Date(item.start_at).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups];
}

export default function App() {
  const [tab, setTab] = useState<Tab>("today");
  const [view, setView] = useState<View | null>(null);
  const [reply, setReply] = useState<Shown | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.today());
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Cannot reach Cadence.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setTab("today");
        input.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const run = useCallback(async (work: () => Promise<Reply | { view: View }>) => {
    setBusy(true);
    try {
      const result = await work();
      if ("kind" in result) setReply(result);
      setView(result.view);
      setFailure(null);
    } catch (error) {
      if (error instanceof ApiError) {
        // A 409 means the words matched more than one thing. That is a question, not a fault.
        setReply({ kind: error.status === 409 ? "question" : "note", message: error.message });
      } else {
        setFailure(error instanceof Error ? error.message : "Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  function send(sentence?: string) {
    const said = (sentence ?? text).trim();
    if (!said || busy) return;
    setText("");
    setTab("today");
    void run(() => api.say(said));
  }

  const shortlist = view?.shortlist ?? [];
  const scheduled = view?.scheduled ?? [];
  const top = shortlist[0];
  const hours = view?.hours;

  return (
    <>
      <NavBar
        canUndo={Boolean(view?.undo)}
        busy={busy}
        onUndo={() => void run(() => api.undo())}
      />

      <main className="page">
        {failure && (
          <div className="banner" role="alert">
            <Mascot name="degraded_mode_state" size="sm" decorative />
            <div className="banner__body">
              <span className="banner__title">Cadence is not running</span>
              <span className="banner__text">
                Start it with <code>uv run uvicorn cadence.app:app --host 127.0.0.1</code>.
              </span>
            </div>
            <button type="button" className="btn btn--quiet" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}

        {reply && (
          <div className="reply" role="status" aria-label="Cadence reply">
            <Mascot
              name={reply.kind === "question" ? "parse_ambiguity_state" : "activity_summary"}
              size="sm"
              decorative
            />
            <div className="reply__body">
              <div className="reply__text">{reply.message}</div>
              {reply.chip && <div className="reply__sub">{reply.chip.join(" · ")}</div>}
            </div>
            {view?.undo && reply.kind !== "question" && reply.kind !== "undone" && (
              <button
                type="button"
                className="reply__undo"
                disabled={busy}
                onClick={() => void run(() => api.undo())}
              >
                Undo
              </button>
            )}
          </div>
        )}

        {tab === "today" && (
          <>
            <h1 className="largetitle">
              Today
              <span className="largetitle__sub">
                {shortlist.length === 0
                  ? "Nothing waiting"
                  : `${shortlist.length} to do · ${scheduled.length} booked`}
              </span>
            </h1>

            {top ? (
              <section className="hero">
                <Mascot name="task_active" size="md" shape="squircle" decorative />
                <div className="hero__body">
                  <span className="hero__eyebrow">Up next</span>
                  <h2 className="hero__title">{top.title}</h2>
                  <span className="hero__meta">
                    {[top.minutes ? `${top.minutes} min` : null, urgency(top.score)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--accent"
                  disabled={busy}
                  onClick={() => void run(() => api.act(top.id, "complete"))}
                >
                  Done
                </button>
              </section>
            ) : (
              <section className="empty">
                <Mascot name="first_run_state" size="lg" shape="squircle" decorative />
                <h2 className="empty__title">Tell me what is on your plate</h2>
                <p className="empty__text">
                  Write it the way you would say it. I work out the task, the time, and what
                  deserves doing first.
                </p>
                <div className="examples">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      className="example"
                      onClick={() => send(example)}
                    >
                      “{example}”
                    </button>
                  ))}
                </div>
              </section>
            )}

            {shortlist.length > 0 && (
              <section className="group">
                <div className="group__label">
                  To do
                  <span className="group__note">ranked</span>
                </div>
                <div className="inset">
                  {shortlist.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      today={view?.today ?? ""}
                      busy={busy}
                      onComplete={() => void run(() => api.act(item.id, "complete"))}
                      onPin={() => void run(() => api.act(item.id, "pin"))}
                      onDrop={() => void run(() => api.act(item.id, "drop"))}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--accent btn--full"
                  disabled={busy}
                  onClick={() => void run(() => api.schedule())}
                >
                  Put these in my calendar
                </button>
              </section>
            )}
          </>
        )}

        {tab === "calendar" && (
          <>
            <h1 className="largetitle">
              Calendar
              <span className="largetitle__sub">
                {view?.calendar.connected ? "Synced with Google" : "On this device"}
              </span>
            </h1>

            {scheduled.length === 0 ? (
              <section className="empty">
                <Mascot name="empty_state_windows" size="lg" shape="squircle" decorative />
                <h2 className="empty__title">Nothing booked yet</h2>
                <p className="empty__text">
                  Add a few tasks with a time estimate, then say “plan my day” and I will fit them
                  into your hours.
                </p>
              </section>
            ) : (
              byDay(scheduled).map(([label, items]) => (
                <section className="group" key={label}>
                  <div className="daygroup">{label}</div>
                  <div className="inset">
                    {items.map((item) => (
                      <Row
                        key={item.id}
                        item={item}
                        today={view?.today ?? ""}
                        busy={busy}
                        onComplete={() => void run(() => api.act(item.id, "complete"))}
                        onDrop={() => void run(() => api.act(item.id, "drop"))}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}

        {tab === "setup" && hours && (
          <>
            <h1 className="largetitle">
              Setup
              <span className="largetitle__sub">{view?.timezone}</span>
            </h1>

            <section className="group">
              <div className="group__label">Working hours</div>
              <div className="inset">
                <div className="field">
                  <span className="field__label">Start</span>
                  <select
                    aria-label="Day starts at"
                    value={hours.start_hour}
                    onChange={(event) =>
                      void run(() =>
                        api.setHours({ ...hours, start_hour: Number(event.target.value) }),
                      )
                    }
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <span className="field__label">End</span>
                  <select
                    aria-label="Day ends at"
                    value={hours.end_hour}
                    onChange={(event) =>
                      void run(() =>
                        api.setHours({ ...hours, end_hour: Number(event.target.value) }),
                      )
                    }
                  >
                    {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                      <option key={hour} value={hour}>
                        {String(hour).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </div>
                <div className="daypick">
                  {DAYS.map((name, index) => (
                    <button
                      key={name}
                      type="button"
                      className="day"
                      aria-pressed={hours.weekdays.includes(index)}
                      onClick={() =>
                        void run(() =>
                          api.setHours({
                            ...hours,
                            weekdays: hours.weekdays.includes(index)
                              ? hours.weekdays.filter((day) => day !== index)
                              : [...hours.weekdays, index].sort((a, b) => a - b),
                          }),
                        )
                      }
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <div className="field">
                  <span className="field__label">Most blocks a day</span>
                  <input
                    type="number"
                    aria-label="Most blocks a day"
                    min={1}
                    max={10}
                    value={hours.max_per_day}
                    onChange={(event) =>
                      void run(() =>
                        api.setHours({ ...hours, max_per_day: Number(event.target.value) }),
                      )
                    }
                  />
                </div>
              </div>
              <p className="hint">Nothing is ever booked outside these hours.</p>
            </section>

            <section className="group">
              <div className="group__label">Google Calendar</div>
              <div className="inset">
                <div className="field">
                  <span className="field__label">
                    {view.calendar.connected
                      ? (view.calendar.email ?? "Connected")
                      : view.calendar.configured
                        ? "Not connected"
                        : "Not set up"}
                  </span>
                  {view.calendar.connected ? (
                    <button
                      type="button"
                      className="btn btn--quiet"
                      onClick={() => void run(() => api.disconnect())}
                    >
                      Disconnect
                    </button>
                  ) : view.calendar.configured ? (
                    <button
                      type="button"
                      className="btn btn--quiet"
                      onClick={() =>
                        void api.connect().then(({ url }) => (window.location.href = url))
                      }
                    >
                      Connect
                    </button>
                  ) : null}
                </div>
              </div>
              {!view.calendar.configured && (
                <p className="hint">
                  Add your Google client id and secret to <code>.env</code> to switch this on.
                </p>
              )}
            </section>

            <section className="group">
              <div className="group__label">Parsing</div>
              <div className="inset">
                <div className="field">
                  <span className="field__label">
                    {view.using_model ? "Gemini" : "Offline rules"}
                  </span>
                  <span className="tag">{view.using_model ? "on" : "no key"}</span>
                </div>
              </div>
              {!view.using_model && (
                <p className="hint">
                  Works fine without a key. Add one for messier sentences. Ranking never uses a
                  model.
                </p>
              )}
            </section>
          </>
        )}
      </main>

      <div className="composer">
        <div className="composer__inner">
          <div className="composer__field">
            <label className="visually-hidden" htmlFor="say">
              Say something to Cadence
            </label>
            <input
              id="say"
              ref={input}
              className="composer__input"
              placeholder="Add a task, or ask what is next…"
              value={text}
              autoComplete="off"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && send()}
            />
          </div>
          <button
            type="button"
            className="composer__send"
            aria-label="Send"
            disabled={busy || !text.trim()}
            onClick={() => send()}
          >
            ↑
          </button>
        </div>
      </div>

      <TabBar current={tab} booked={scheduled.length} onChange={setTab} />
    </>
  );
}
