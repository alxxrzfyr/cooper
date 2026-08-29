import { useCallback, useEffect, useRef, useState } from "react";

import "./theme.css";
import { api } from "./api";
import { Calendar } from "./Calendar";
import { Chat, loadTurns, saveTurns, type Turn } from "./Chat";
import { Mascot } from "./Mascot";
import { Nav, type Tab } from "./Nav";
import { Row } from "./Row";
import { ApiError, type Reply, type View } from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function id(): string {
  return Math.random().toString(36).slice(2, 10);
}

function urgency(score: number): string {
  if (score >= 0.6) return "do this first";
  if (score >= 0.35) return "worth doing today";
  return "can wait";
}

export default function App() {
  const [tab, setTab] = useState<Tab>("chat");
  const [view, setView] = useState<View | null>(null);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => saveTurns(turns), [turns]);

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
        setTab("chat");
        input.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  function reply(turn: Omit<Turn, "id" | "at" | "who">) {
    setTurns((current) => [...current, { ...turn, id: id(), at: Date.now(), who: "otter" }]);
  }

  /** Send one sentence and let the otter answer. */
  const say = useCallback(
    async (sentence: string) => {
      const said = sentence.trim();
      if (!said || busy) return;

      setTab("chat");
      setText("");
      setTurns((current) => [...current, { id: id(), at: Date.now(), who: "you", text: said }]);
      setBusy(true);

      try {
        const result = await api.say(said);
        setView(result.view);
        setFailure(null);

        if (result.kind === "shown") {
          // "What should I do?" deserves an actual answer in the conversation, not a nudge to
          // go and look at another tab.
          const list = result.view.shortlist.slice(0, 4);
          reply({
            text: list.length
              ? `Start with ${list[0].title}.`
              : "Nothing waiting. Tell me what's on your plate.",
            kind: "shown",
            lines: list.map(
              (row, index) =>
                `${index + 1}. ${row.title}${row.minutes ? ` · ${row.minutes}m` : ""} · ${urgency(row.score)}`,
            ),
          });
        } else {
          reply({ text: result.message, kind: result.kind, item: result.item, lines: result.chip });
        }
      } catch (error) {
        if (error instanceof ApiError) {
          reply({
            text: error.message,
            kind: error.status === 409 ? "question" : "note",
          });
        } else {
          setFailure(error instanceof Error ? error.message : "Something went wrong.");
        }
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  /** Buttons elsewhere in the app also narrate themselves into the conversation. */
  const act = useCallback(
    async (work: () => Promise<Reply | { view: View }>, narrate = true) => {
      setBusy(true);
      try {
        const result = await work();
        setView(result.view);
        setFailure(null);
        if (narrate && "kind" in result) {
          reply({ text: result.message, kind: result.kind, item: result.item, lines: result.chip });
        }
      } catch (error) {
        if (error instanceof ApiError) {
          reply({ text: error.message, kind: error.status === 409 ? "question" : "note" });
        } else {
          setFailure(error instanceof Error ? error.message : "Something went wrong.");
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const shortlist = view?.shortlist ?? [];
  const scheduled = view?.scheduled ?? [];
  const top = shortlist[0];
  const hours = view?.hours;

  return (
    <div className="app">
      <Nav
        current={tab}
        todo={shortlist.length}
        booked={scheduled.length}
        canUndo={Boolean(view?.undo)}
        busy={busy}
        onChange={setTab}
        onUndo={() => void act(() => api.undo())}
      />

      <main className="main">
        {failure && (
          <div className="banner" role="alert">
            <Mascot name="degraded_mode_state" size="sm" decorative />
            <div className="banner__body">
              <span className="banner__title">Cadence isn&rsquo;t running</span>
              <span className="banner__text">
                Start it with <code>uv run uvicorn cadence.app:app --host 127.0.0.1</code>.
              </span>
            </div>
            <button type="button" className="btn btn--quiet" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}

        {tab === "chat" && (
          <Chat turns={turns} thinking={busy} onExample={(example) => void say(example)} />
        )}

        {tab === "plan" && (
          <div className="scroll">
            <h1 className="largetitle">
              Plan
              <span className="largetitle__sub">
                {shortlist.length === 0 && scheduled.length === 0
                  ? "Nothing yet"
                  : `${shortlist.length} to do · ${scheduled.length} booked`}
              </span>
            </h1>

            {top && (
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
                  onClick={() => void act(() => api.act(top.id, "complete"))}
                >
                  Done
                </button>
              </section>
            )}

            {shortlist.length > 0 && (
              <section className="group">
                <div className="group__label">
                  To do<span className="group__note">ranked</span>
                </div>
                <div className="inset">
                  {shortlist.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      today={view?.today ?? ""}
                      busy={busy}
                      onComplete={() => void act(() => api.act(item.id, "complete"))}
                      onPin={() => void act(() => api.act(item.id, "pin"))}
                      onDrop={() => void act(() => api.act(item.id, "drop"))}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="btn btn--accent btn--full"
                  disabled={busy}
                  onClick={() => void act(() => api.schedule())}
                >
                  Put these in my calendar
                </button>
              </section>
            )}

            {shortlist.length === 0 && (
              <section className="empty">
                <Mascot name="empty_state_windows" size="lg" shape="squircle" decorative />
                <h2 className="empty__title">Nothing to do</h2>
                <p className="empty__text">
                  {scheduled.length > 0
                    ? "Everything is booked. Have a look at the Calendar."
                    : "Say something in Chat and it will show up here, ranked and ready to book."}
                </p>
              </section>
            )}
          </div>
        )}

        {tab === "calendar" && view && (
          <Calendar
            view={view}
            busy={busy}
            onComplete={(itemId) => void act(() => api.act(itemId, "complete"))}
            onDrop={(itemId) => void act(() => api.act(itemId, "drop"))}
          />
        )}

        {tab === "setup" && hours && view && (
          <div className="scroll">
            <h1 className="largetitle">
              Setup
              <span className="largetitle__sub">{view.timezone}</span>
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
                      void act(
                        () => api.setHours({ ...hours, start_hour: Number(event.target.value) }),
                        false,
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
                      void act(
                        () => api.setHours({ ...hours, end_hour: Number(event.target.value) }),
                        false,
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
                        void act(
                          () =>
                            api.setHours({
                              ...hours,
                              weekdays: hours.weekdays.includes(index)
                                ? hours.weekdays.filter((day) => day !== index)
                                : [...hours.weekdays, index].sort((a, b) => a - b),
                            }),
                          false,
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
                      void act(
                        () => api.setHours({ ...hours, max_per_day: Number(event.target.value) }),
                        false,
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
                      onClick={() => void act(() => api.disconnect(), false)}
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
              <p className="hint">
                {view.calendar.connected
                  ? "Booked work is written to Google. Your own events block scheduling."
                  : view.calendar.configured
                    ? "Not connected. Cadence is using its own calendar, which works on its own."
                    : "Cadence has its own calendar and needs nothing to work. Add a Google client id and secret to .env if you also want it in Google Calendar."}
              </p>
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

            {turns.length > 0 && (
              <button
                type="button"
                className="btn btn--full"
                onClick={() => setTurns([])}
              >
                Clear conversation
              </button>
            )}
          </div>
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
              placeholder="Tell me what's on your plate…"
              value={text}
              autoComplete="off"
              enterKeyHint="send"
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void say(text)}
            />
            <button
              type="button"
              className="composer__send"
              aria-label="Send"
              disabled={busy || !text.trim()}
              onClick={() => void say(text)}
            >
              <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
                <path
                  d="M12 19V6.4l-5.3 5.3a1 1 0 0 1-1.4-1.4l7-7a1 1 0 0 1 1.4 0l7 7a1 1 0 0 1-1.4 1.4L14 6.4V19a1 1 0 0 1-2 0Z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
