import { useCallback, useEffect, useRef, useState } from "react";

import "./theme.css";
import { api } from "./api";
import { HoursSheet } from "./HoursSheet";
import { Mascot } from "./Mascot";
import { Row } from "./Row";
import { ApiError, type Reply, type ReplyKind, type View } from "./types";

/** What the reply strip is showing. Errors and questions are replies too, not exceptions. */
type Shown = { kind: ReplyKind; message: string; chip?: string[] };

const EXAMPLES = [
  "write the quarterly report, 90m, important, due friday",
  "dentist thursday 3pm",
  "plan my day",
];

/** Word for the score, so the number is not the only explanation. */
function urgency(score: number): string {
  if (score >= 0.6) return "do this first";
  if (score >= 0.35) return "worth doing today";
  return "can wait";
}

export default function App() {
  const [view, setView] = useState<View | null>(null);
  const [reply, setReply] = useState<Shown | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
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
        input.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  const run = useCallback(
    async (work: () => Promise<Reply | { view: View }>) => {
      setBusy(true);
      try {
        const result = await work();
        if ("kind" in result) setReply(result);
        setView(result.view);
        setFailure(null);
      } catch (error) {
        if (error instanceof ApiError) {
          // A 409 means the words matched more than one thing, which is a question, not a fault.
          setReply({ kind: error.status === 409 ? "question" : "note", message: error.message });
        } else {
          setFailure(error instanceof Error ? error.message : "Something went wrong.");
        }
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  function send(sentence?: string) {
    const said = (sentence ?? text).trim();
    if (!said || busy) return;
    setText("");
    void run(() => api.say(said));
  }

  const shortlist = view?.shortlist ?? [];
  const scheduled = view?.scheduled ?? [];
  const top = shortlist[0];
  const totalMinutes = shortlist.reduce((sum, item) => sum + (item.minutes ?? 0), 0);

  return (
    <div className="shell">
      <header className="topbar">
        <img className="topbar__mark" src="/assets/brand/cadence_logo.webp" alt="Cadence" />
        <div className="topbar__spacer" />
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => setHoursOpen(true)}>
          Hours
        </button>
        {view?.undo && (
          <button
            type="button"
            className="btn btn--quiet btn--sm"
            disabled={busy}
            onClick={() => void run(() => api.undo())}
          >
            Undo
          </button>
        )}
      </header>

      {failure && (
        <div className="banner banner--bad" role="alert">
          <div className="banner__body">
            <span className="banner__title">Cadence is not running</span>
            <span className="banner__text">
              {failure}. Start it with <code>uv run uvicorn cadence.app:app --host 127.0.0.1</code>.
            </span>
          </div>
          <button type="button" className="btn btn--sm" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {view && !view.calendar.connected && view.calendar.configured && (
        <div className="banner banner--warn">
          <Mascot name="credential_expired_state" className="banner__art" decorative />
          <div className="banner__body">
            <span className="banner__title">Google Calendar is off</span>
            <span className="banner__text">Connect it and scheduled work shows up there too.</span>
          </div>
          <button
            type="button"
            className="btn btn--sm btn--accent"
            onClick={() => void api.connect().then(({ url }) => (window.location.href = url))}
          >
            Connect
          </button>
        </div>
      )}

      {top ? (
        <section className="hero">
          <Mascot name="task_active" className="hero__mascot" decorative />
          <div className="hero__body">
            <span className="hero__eyebrow">Up next</span>
            <h1 className="hero__title">{top.title}</h1>
            <span className="hero__meta">
              {[
                top.minutes ? `${top.minutes} min` : null,
                urgency(top.score),
                shortlist.length > 1 ? `${shortlist.length - 1} more waiting` : null,
              ]
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
          <Mascot name="profile_icon" className="empty__art" decorative />
          <h1 className="empty__title">Tell me what is on your plate</h1>
          <p className="empty__text">
            Write it the way you would say it. I will work out the task, the time, and what
            deserves doing first.
          </p>
          <div className="empty__examples">
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

      {reply && (
        <div
          className={`reply ${
            reply.kind === "question"
              ? "reply--ask"
              : reply.kind === "note"
                ? "reply--bad"
                : "reply--good"
          }`}
          role="status"
          aria-label="Cadence reply"
        >
          <span className="reply__dot" aria-hidden="true" />
          <div className="reply__body">
            <div className="reply__text">{reply.message}</div>
            {"chip" in reply && reply.chip && <div className="reply__sub">{reply.chip.join(" · ")}</div>}
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

      {shortlist.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">What to work on</h2>
            <span className="section__note">
              {totalMinutes > 0 && `${Math.round(totalMinutes / 60)}h of work · `}
              ranked for you
            </span>
          </div>
          <div className="stack">
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
            className="btn btn--accent"
            style={{ alignSelf: "flex-start" }}
            disabled={busy}
            onClick={() => void run(() => api.schedule())}
          >
            Put these in my calendar
          </button>
        </section>
      )}

      {scheduled.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2 className="section__title">Booked</h2>
            <span className="section__note">
              {view?.calendar.connected ? "synced to Google" : "on this device"}
            </span>
          </div>
          <div className="stack">
            {scheduled.map((item) => (
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
      )}

      <div className="composer">
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
        <p className="composer__hint">
          {view?.using_model === false
            ? "Running offline. Add a Gemini key for messier sentences."
            : "⌘K to jump here"}
        </p>
      </div>

      {hoursOpen && view && (
        <HoursSheet
          hours={view.hours}
          onClose={() => setHoursOpen(false)}
          onSave={(hours) =>
            void run(async () => {
              const result = await api.setHours(hours);
              setHoursOpen(false);
              return result;
            })
          }
        />
      )}
    </div>
  );
}
