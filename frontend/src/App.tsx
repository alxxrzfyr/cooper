import { useCallback, useEffect, useRef, useState } from "react";

import "./theme.css";
import { applyAppearance, type Appearance, readAppearance, saveAppearance } from "./appearance";
import { api } from "./api";
import { Calendar } from "./Calendar";
import { Chat, loadMode, loadTurns, saveMode, saveTurns, type Mode, type Turn } from "./Chat";
import { Mascot, type MascotName } from "./Mascot";
import { Home } from "./Home";
import { Form } from "./Form";
import { Nav, type Tab } from "./Nav";
import { Row } from "./Row";
import { TaskFrame } from "./Frame";
import {
  ApiError,
  type Item,
  type NewItem,
  type Ranked,
  type Reply,
  type ReplyKind,
  type View,
} from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The three answers to "what should this look like", in the order a segmented control shows. */
const APPEARANCES: Array<{ id: Appearance; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

const GEMINI_KEY = "cooper.gemini_key.v1";

function loadGeminiKey(): string {
  try {
    return localStorage.getItem(GEMINI_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveGeminiKey(value: string): void {
  try {
    const key = value.trim();
    if (key) localStorage.setItem(GEMINI_KEY, key);
    else localStorage.removeItem(GEMINI_KEY);
  } catch {
    /* a blocked store is not worth failing over; the key still applies this session */
  }
}

function formatChecked(value: string): string {
  const checked = new Date(value);
  if (Number.isNaN(checked.getTime())) return value;
  return checked.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function id(): string {
  return Math.random().toString(36).slice(2, 10);
}

type BrowserPermission = NotificationPermission | "unsupported";

function browserPermission(): BrowserPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return window.Notification.permission;
}

function noticeTone(kind: ReplyKind): "good" | "bad" | "answer" | "attention" | "plain" {
  switch (kind) {
    case "added":
    case "completed":
    case "pinned":
    case "scheduled":
      return "good";
    case "dropped":
      return "bad";
    case "answered":
      return "answer";
    case "question":
    case "note":
    case "undone":
      return "attention";
    default:
      return "plain";
  }
}

function noticeFace(kind: ReplyKind): MascotName {
  switch (kind) {
    case "question":
      return "cooper_puzzled";
    case "note":
      return "cooper_tired";
    case "scheduled":
      return "cooper_scheduled";
    case "dropped":
    case "undone":
      return "cooper_undo";
    case "answered":
      return "cooper_thinking";
    default:
      return "cooper_done";
  }
}

interface Notice {
  kind: ReplyKind;
  message: string;
}

/**
 * Why this is at the top, in the words the user typed rather than the number behind it.
 *
 * The score used to be shown as "0.23" with a four-bar breakdown of its terms, which explained
 * the formula rather than the task. The deadline is the formula now, so the deadline is what it
 * says.
 */
function why(item: Item): string {
  if (!item.due) return "no deadline";
  const day = item.due.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (day < today) return "overdue";
  if (day === today) return "due today";
  const days = Math.round((new Date(day).getTime() - new Date(today).getTime()) / 86_400_000);
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
}

export default function App() {
  // The app opens on the dashboard: seeing the day should not require asking for it.
  const [tab, setTab] = useState<Tab>("home");
  const [view, setView] = useState<View | null>(null);
  const [serverModelAvailable, setServerModelAvailable] = useState(false);
  const [loadResolved, setLoadResolved] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [geminiKey, setGeminiKey] = useState(loadGeminiKey);
  const [mode, setMode] = useState<Mode>(loadMode);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [browserAlerts, setBrowserAlerts] = useState<BrowserPermission>(browserPermission);
  const noticeTimer = useRef<number | null>(null);
  /** The one task a frame is open on, if any. Plan and Calendar share the component. */
  const [detail, setDetail] = useState<Item | Ranked | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canUseAi = Boolean(geminiKey.trim()) || serverModelAvailable;

  const announce = useCallback(
    (kind: ReplyKind, message: string, showToast = true) => {
      // Chat already renders the reply. A second copy as a toast would make AI mode feel like an
      // activity log, so keep in-app notices for the other screens while retaining OS alerts.
      if (showToast && tab !== "chat") {
        setNotice({ kind, message });
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => {
          setNotice(null);
          noticeTimer.current = null;
        }, 5200);
      }

      if (
        document.visibilityState === "hidden" &&
        browserAlerts === "granted" &&
        "Notification" in window
      ) {
        new window.Notification("Cooper", {
          body: message,
          icon: `/assets/mascot/${noticeFace(kind)}.webp`,
          tag: "cooper-update",
        });
      }
    },
    [browserAlerts, tab],
  );

  const enableBrowserAlerts = useCallback(async () => {
    if (!("Notification" in window)) {
      announce("note", "This browser does not support notifications.");
      return;
    }
    const permission = await window.Notification.requestPermission();
    setBrowserAlerts(permission);
    announce(
      permission === "granted" ? "added" : "note",
      permission === "granted"
        ? "Browser notifications are on."
        : "Browser notifications stay off until you allow them.",
    );
  }, [announce]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  /** Applied from state, so the page and the picker can never disagree. */
  useEffect(() => applyAppearance(appearance), [appearance]);

  function chooseAppearance(choice: Appearance): void {
    setAppearance(choice);
    saveAppearance(choice);
  }

  useEffect(() => saveTurns(turns), [turns]);

  // AI mode is only usable with a model key. A mode saved from a session that had one — or a key
  // that was later removed — must not strand the user in a conversation that cannot answer and
  // with no form to add through. A key can come from this browser or the deployment.
  useEffect(() => {
    if (loadResolved && !canUseAi && mode === "ai") {
      setMode("manual");
      saveMode("manual");
    }
  }, [canUseAi, loadResolved, mode]);

  const load = useCallback(async () => {
    try {
      const nextView = await api.today();
      setView(nextView);
      setServerModelAvailable(nextView.using_model);
      setFailure(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Cannot reach Cooper.");
    } finally {
      setLoadResolved(true);
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
        const result = await api.say(said, mode, geminiKey);
        setView(result.view);
        setFailure(null);
        announce(result.kind, result.message, false);

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
                `${index + 1}. ${row.title}${row.minutes ? ` · ${row.minutes}m` : ""} · ${why(row)}`,
            ),
          });
        } else {
          reply({
            text: result.message,
            kind: result.kind,
            item: result.item,
            lines: result.chip,
          });
        }
      } catch (error) {
        if (error instanceof ApiError) {
          const kind = error.status === 409 ? "question" : "note";
          reply({
            text: error.message,
            kind,
          });
          announce(kind, error.message);
        } else {
          const message = error instanceof Error ? error.message : "Something went wrong.";
          setFailure(message);
          announce("note", message);
        }
      } finally {
        setBusy(false);
      }
    },
    [announce, busy, geminiKey, mode],
  );

  /** Buttons elsewhere in the app update the source screen and show a transient notice. */
  const act = useCallback(
    async (work: () => Promise<Reply | { view: View }>) => {
      setBusy(true);
      try {
        const result = await work();
        setView(result.view);
        setFailure(null);
        if ("kind" in result) {
          announce(result.kind, result.message);
        }
      } catch (error) {
        if (error instanceof ApiError) {
          const kind = error.status === 409 ? "question" : "note";
          announce(kind, error.message);
        } else {
          const message = error instanceof Error ? error.message : "Something went wrong.";
          setFailure(message);
          announce("note", message);
        }
      } finally {
        setBusy(false);
      }
    },
    [announce],
  );

  /** Manual mode's form: post the fields and let Cooper narrate it into the conversation. */
  const addFromForm = useCallback(
    async (item: NewItem) => {
      await act(() => api.createItem(item));
    },
    [act],
  );

  const shortlist = view?.shortlist ?? [];
  const scheduled = view?.scheduled ?? [];
  const hours = view?.hours;

  return (
    <div className="app">
      <Nav
        current={tab}
        todo={shortlist.length}
        booked={scheduled.length}
        undo={view?.undo ?? null}
        busy={busy}
        onChange={setTab}
        onUndo={() => void act(() => api.undo())}
      />

      <main className="main">
        {failure && (
          <div className="banner" role="alert">
            <Mascot name="cooper_tired" size="sm" decorative />
            <div className="banner__body">
              <span className="banner__title">Cooper isn&rsquo;t running</span>
              <span className="banner__text">
                Start it with <code>uv run uvicorn cooper.app:app --host 127.0.0.1</code>.
              </span>
            </div>
            <button type="button" className="btn btn--quiet" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )}

        {tab === "home" && view && (
          <Home
            view={view}
            busy={busy}
            onComplete={(itemId) => void act(() => api.act(itemId, "complete"))}
            onOpen={setDetail}
            onSchedule={() => void act(() => api.schedule())}
            onGoToChat={() => {
              setTab("chat");
              input.current?.focus();
            }}
          />
        )}

        {tab === "chat" && (
          <Chat
            turns={turns}
            thinking={busy}
            mode={mode}
            canUseAi={canUseAi}
            manualForm={<Form busy={busy} onSubmit={addFromForm} />}
            onMode={(next) => {
              setMode(next);
              saveMode(next);
            }}
            onExample={(example) => void say(example)}
          />
        )}

        {tab === "calendar" && view && (
          <Calendar
            view={view}
            busy={busy}
            onComplete={(itemId) => void act(() => api.act(itemId, "complete"))}
            onPin={(itemId) => void act(() => api.act(itemId, "pin"))}
            onDrop={(itemId) => void act(() => api.act(itemId, "drop"))}
          />
        )}

        {tab === "settings" && hours && view && (
          <div className="scroll">
            <h1 className="largetitle">
              Settings
              <span className="largetitle__sub">{view.timezone}</span>
            </h1>

            <section className="group">
              <div className="group__label">Appearance</div>
              <div className="inset">
                <div className="segmented" role="group" aria-label="Appearance">
                  {APPEARANCES.map(({ id: choice, label }) => (
                    <button
                      key={choice}
                      type="button"
                      className="segment"
                      aria-pressed={appearance === choice}
                      onClick={() => chooseAppearance(choice)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="hint">
                Light unless you say otherwise. System follows whatever your machine is doing.
              </p>
            </section>

            <section className="group">
              <div className="group__label">Working hours</div>
              <div className="inset">
                <div className="field">
                  <span className="field__label">Start</span>
                  <select
                    aria-label="Day starts at"
                    value={hours.start_hour}
                    onChange={(event) =>
                      void act(() =>
                        api.setHours({
                          ...hours,
                          start_hour: Number(event.target.value),
                        }),
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
                      void act(() =>
                        api.setHours({
                          ...hours,
                          end_hour: Number(event.target.value),
                        }),
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
                        void act(() =>
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
                      void act(() =>
                        api.setHours({
                          ...hours,
                          max_per_day: Number(event.target.value),
                        }),
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
                  <span className="field__label">Account</span>
                  <span className="tag">
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
                      onClick={() => void act(() => api.disconnect())}
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
                    ? "Not connected. Cooper is using its own calendar, which works on its own."
                    : "Cooper has its own calendar and needs nothing to work. Add a Google client id and secret to .env if you also want it in Google Calendar."}
              </p>
            </section>

            <section className="group">
              <div className="group__label">Gmail confirmations</div>
              <div className="inset">
                <div className="field">
                  <span className="field__label">Status</span>
                  <span className="tag">
                    {view.gmail.connected
                      ? "Connected"
                      : view.gmail.configured
                        ? "Not connected"
                        : "Not configured"}
                  </span>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    disabled={busy || !view.gmail.connected}
                    onClick={() => void act(() => api.syncGoogle())}
                  >
                    {busy ? "Syncing…" : "Sync now"}
                  </button>
                </div>
                <div className="field">
                  <span className="field__label">Last checked</span>
                  <span className="tag">
                    {view.gmail.last_checked ? formatChecked(view.gmail.last_checked) : "Not yet"}
                  </span>
                </div>
                <div className="field">
                  <span className="field__label">Recent messages</span>
                  <span className="tag">
                    {view.gmail.imported} imported · {view.gmail.skipped} skipped
                  </span>
                </div>
              </div>
              <p className={`hint ${view.gmail.last_error ? "hint--error" : ""}`}>
                {view.gmail.last_error
                  ? view.gmail.last_error
                  : view.gmail.connected
                    ? "Read-only confirmations from Luma, Meetup, and Eventbrite block scheduling."
                    : view.gmail.configured
                      ? "Connect Google Calendar above to enable Gmail confirmations."
                      : "Cooper works without Google. Connect Google to import known Gmail confirmations."}
              </p>
            </section>

            <section className="group">
              <div className="group__label">Parsing</div>
              <div className="inset">
                <div className="field">
                  <span className="field__label">{canUseAi ? "Gemini" : "Offline rules"}</span>
                  <span className="tag">
                    {view.using_model ? "configured" : geminiKey.trim() ? "this browser" : "no key"}
                  </span>
                </div>
                <div className="field field--stacked">
                  <label className="field__label" htmlFor="gemini-key">
                    Gemini API key
                  </label>
                  <div className="field__secret">
                    <input
                      id="gemini-key"
                      type="password"
                      autoComplete="off"
                      maxLength={256}
                      spellCheck={false}
                      value={geminiKey}
                      aria-describedby="gemini-key-hint"
                      onChange={(event) => {
                        const value = event.target.value;
                        setGeminiKey(value);
                        saveGeminiKey(value);
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn--quiet"
                      disabled={!geminiKey}
                      onClick={() => {
                        setGeminiKey("");
                        saveGeminiKey("");
                        setLoadResolved(false);
                        void load();
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
              <p className="hint" id="gemini-key-hint">
                {canUseAi
                  ? "Your key stays in this browser and is sent only with AI messages. Manual mode stays offline."
                  : "Works fine without a key. Add one for messier sentences. Ranking never uses a model."}
              </p>
            </section>

            <section className="group">
              <div className="group__label">Notifications</div>
              <div className="inset">
                <div className="field">
                  <span className="field__label">Browser alerts</span>
                  <span className="tag">
                    {browserAlerts === "unsupported"
                      ? "Not available"
                      : browserAlerts === "granted"
                        ? "On"
                        : browserAlerts === "denied"
                          ? "Blocked"
                          : "Off"}
                  </span>
                  {browserAlerts === "default" && (
                    <button
                      type="button"
                      className="btn btn--quiet"
                      onClick={() => void enableBrowserAlerts()}
                    >
                      Enable
                    </button>
                  )}
                </div>
              </div>
              <p className="hint">
                Cooper shows a small in-app notice for each change. Browser alerts appear only when
                this app is in the background.
              </p>
            </section>

            {turns.length > 0 && (
              <button type="button" className="btn btn--full" onClick={() => setTurns([])}>
                Clear conversation
              </button>
            )}
          </div>
        )}
      </main>

      {notice && (
        <div
          className={`notice notice--${noticeTone(notice.kind)}`}
          role="status"
          aria-live="polite"
        >
          <Mascot name={noticeFace(notice.kind)} size="sm" decorative />
          <p className="notice__message">{notice.message}</p>
          <button
            type="button"
            className="notice__close"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      {detail && (
        <TaskFrame
          item={detail}
          today={view?.today ?? ""}
          busy={busy}
          onClose={() => setDetail(null)}
          onComplete={() => void act(() => api.act(detail.id, "complete"))}
          onPin={() => void act(() => api.act(detail.id, "pin"))}
          onDrop={() => void act(() => api.act(detail.id, "drop"))}
        />
      )}

      {/*
        The composer is the sentence path. In Manual mode on the chat tab the form owns input, so
        the free-text box would be a second, contradictory way in — hidden there. Everywhere else
        it stays as quick capture, routing through whatever mode is set.
      */}
      {!(tab === "chat" && mode === "manual") && (
        <div className="composer">
          <div className="composer__inner">
            <div className="composer__field">
              <label className="visually-hidden" htmlFor="say">
                Say something to Cooper
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
      )}
    </div>
  );
}
