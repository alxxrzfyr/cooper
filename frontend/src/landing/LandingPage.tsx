import { useRef, useState, type KeyboardEvent, type ReactNode, type WheelEvent } from "react";

import { Mascot } from "../Mascot";
import { AuthCard } from "./AuthCard";

interface LandingProps {
  busy: boolean;
  error: string | null;
  authEnabled?: boolean;
  authLoading?: boolean;
  onSignIn: () => void;
}

const PANELS = [
  { id: "untangle", label: "Untangle" },
  { id: "prioritize", label: "Prioritize" },
  { id: "room", label: "Make room" },
  { id: "start", label: "Start" },
] as const;

function panelId(id: string): string {
  return `landing-${id}`;
}

function WindowChrome({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="landing__product-window">
      <div className="landing__window-bar">
        <span className="landing__window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>{label}</span>
        <span className="landing__window-status">Cooper</span>
      </div>
      {children}
    </div>
  );
}

function TodayMock() {
  return (
    <WindowChrome label="Today">
      <div className="landing__today-mock">
        <aside className="landing__mock-rail" aria-hidden="true">
          <span className="landing__mock-avatar">C</span>
          <span className="landing__mock-rail-line landing__mock-rail-line--active" />
          <span className="landing__mock-rail-line" />
          <span className="landing__mock-rail-line" />
          <span className="landing__mock-rail-line landing__mock-rail-line--short" />
        </aside>
        <div className="landing__mock-day">
          <div className="landing__mock-day-head">
            <div>
              <span className="landing__mock-kicker">Monday, August 31</span>
              <strong>Good evening</strong>
            </div>
            <span className="landing__mock-pill">3 open</span>
          </div>
          <div className="landing__mock-task landing__mock-task--focus">
            <span className="landing__mock-check" aria-hidden="true" />
            <span>
              <strong>Write the quarterly report</strong>
              <small>Work · 90 min · due Friday</small>
            </span>
            <em>next</em>
          </div>
          <div className="landing__mock-task">
            <span className="landing__mock-check" aria-hidden="true" />
            <span>
              <strong>Practice university presentation</strong>
              <small>Academics · 30 min</small>
            </span>
          </div>
          <div className="landing__mock-task landing__mock-task--muted">
            <span className="landing__mock-check" aria-hidden="true" />
            <span>
              <strong>Gym</strong>
              <small>Personal · Sun 7:00 PM</small>
            </span>
          </div>
        </div>
      </div>
    </WindowChrome>
  );
}

function ChatMock() {
  return (
    <WindowChrome label="Cooper chat">
      <div className="landing__chat-mock">
        <div className="landing__chat-line landing__chat-line--you">clear my Friday afternoon</div>
        <div className="landing__chat-line landing__chat-line--cooper">
          <Mascot name="cooper_avatar" size="xs" decorative loading="eager" />
          <span>There’s room at 2:00 PM. I’ll keep the morning clear.</span>
        </div>
        <div className="landing__chat-result">
          <span className="landing__mock-kicker">Suggested block</span>
          <strong>Friday · 2:00–3:30 PM</strong>
          <small>around your calendar, inside your working hours</small>
        </div>
      </div>
    </WindowChrome>
  );
}

function CalendarMock() {
  return (
    <WindowChrome label="Calendar">
      <div className="landing__calendar-mock">
        <div className="landing__calendar-head">
          <strong>September 2026</strong>
          <span>Week 36</span>
        </div>
        <div className="landing__calendar-grid" aria-hidden="true">
          {["M", "T", "W", "T", "F"].map((day, index) => (
            <span key={`${day}-${index}`} className="landing__calendar-day">
              {day}
            </span>
          ))}
          <span>31</span>
          <span>1</span>
          <span>2</span>
          <span className="landing__calendar-event">CS101</span>
          <span>4</span>
          <span>7</span>
          <span className="landing__calendar-event landing__calendar-event--cooper">Report</span>
          <span>9</span>
          <span>10</span>
          <span>11</span>
        </div>
        <div className="landing__calendar-note">
          <span className="landing__mock-check" aria-hidden="true" />
          <span>
            <strong>Cooper’s block</strong>
            <small>Only the time Cooper placed is writable.</small>
          </span>
        </div>
      </div>
    </WindowChrome>
  );
}

export function LandingPage({
  busy,
  error,
  authEnabled = true,
  authLoading = false,
  onSignIn,
}: LandingProps) {
  const track = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  function moveTo(id: string): void {
    const nextIndex = PANELS.findIndex((panel) => panel.id === id);
    if (nextIndex >= 0) setActiveIndex(nextIndex);
    const target = document.getElementById(panelId(id));
    if (!target || typeof target.scrollIntoView !== "function") return;
    target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  function moveBy(delta: number): void {
    const nextIndex = Math.min(Math.max(activeIndex + delta, 0), PANELS.length - 1);
    moveTo(PANELS[nextIndex].id);
  }

  function horizontalWheel(event: WheelEvent<HTMLDivElement>): void {
    const element = track.current;
    if (!element || typeof window === "undefined") return;
    const wide = window.matchMedia?.("(min-width: 900px)").matches ?? false;
    if (!wide || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: "auto" });
  }

  function trackKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveBy(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveBy(-1);
    }
  }

  function trackScroll(): void {
    const element = track.current;
    if (!element || element.clientWidth <= 0) return;
    const nextIndex = Math.round(element.scrollLeft / element.clientWidth);
    setActiveIndex(Math.min(Math.max(nextIndex, 0), PANELS.length - 1));
  }

  return (
    <div className="landing landing--keeby">
      <header className="landing__header">
        <a className="landing__brand" href="/" aria-label="Cooper home">
          <Mascot name="cooper_avatar" size="xs" decorative loading="eager" />
          <span className="landing__wordmark">Cooper</span>
        </a>
        <p className="landing__header-note">A calmer way to keep your promises to yourself.</p>
        <div className="landing__actions">
          <a className="landing__quiet" href="/login">
            Log in
          </a>
          <a className="landing__header-cta" href="/signup">
            Create account
          </a>
        </div>
      </header>

      <div
        className="landing__track"
        ref={track}
        role="region"
        aria-label="Cooper overview"
        tabIndex={0}
        onWheel={horizontalWheel}
        onKeyDown={trackKeyDown}
        onScroll={trackScroll}
      >
        <section
          className="landing__panel landing__panel--hero landing__panel--untangle"
          id={panelId("untangle")}
        >
          <div className="landing__copy">
            <p className="landing__eyebrow">01 / Untangle</p>
            <h1>Your day, untangled.</h1>
            <p className="landing__lede">
              Say what needs doing. Cooper gives it a place, a reason, and a next step you can see.
            </p>
            <a className="landing__primary" href="/signup">
              Create your account
            </a>
            <p className="landing__hint">Google sign-in creates your account the first time.</p>
          </div>
          <div className="landing__stage landing__stage--today">
            <TodayMock />
            <Mascot name="cooper_landing_hero" size="lg" decorative loading="eager" />
            <span className="landing__stage-caption">One quiet place for the whole day.</span>
          </div>
        </section>

        <section
          className="landing__panel landing__panel--how landing__panel--prioritize"
          id={panelId("prioritize")}
        >
          <div className="landing__stage landing__stage--chat">
            <ChatMock />
            <Mascot name="cooper_landing_sort" size="md" decorative />
          </div>
          <div className="landing__copy landing__copy--narrow">
            <p className="landing__eyebrow">02 / Prioritize</p>
            <h2>Say it once. See what matters.</h2>
            <p className="landing__body">
              Cooper keeps the useful parts of a thought, then shows why one thing belongs before
              the next.
            </p>
            <div className="landing__proof-line">
              <strong>Capture → reason → next</strong>
              <span>No dashboards to maintain. No new system to learn.</span>
            </div>
          </div>
        </section>

        <section
          className="landing__panel landing__panel--connected landing__panel--room"
          id={panelId("room")}
        >
          <div className="landing__copy landing__copy--narrow">
            <p className="landing__eyebrow">03 / Make room</p>
            <h2>Make room around what is already booked.</h2>
            <p className="landing__body">
              Calendar events and Gmail confirmations block time without becoming another list to
              maintain.
            </p>
            <div className="landing__boundary">
              <div>
                <strong>Read-only by default</strong>
                <span>Cooper reads commitments and writes only the blocks it schedules.</span>
              </div>
              <div>
                <strong>Works without Google</strong>
                <span>Local capture, ranking, and scheduling stay useful on their own.</span>
              </div>
            </div>
          </div>
          <div className="landing__stage landing__stage--calendar">
            <CalendarMock />
            <Mascot name="cooper_landing_ready" size="md" decorative />
          </div>
        </section>

        <section
          className="landing__panel landing__panel--auth landing__panel--start auth-screen"
          id={panelId("start")}
        >
          <div className="landing__copy landing__copy--narrow">
            <p className="landing__eyebrow">04 / Start</p>
            <h2>Start with a calmer next step.</h2>
            <p className="landing__body">
              Your tasks stay yours. Your schedule gets a little easier to see.
            </p>
            <Mascot name="cooper_waving" size="md" decorative />
          </div>
          <AuthCard
            intent="signup"
            busy={busy}
            error={error}
            authEnabled={authEnabled}
            authLoading={authLoading}
            onSignIn={onSignIn}
          />
        </section>
      </div>

      <div className="landing__navigation">
        <div className="landing__progress" role="group" aria-label="Landing sections">
          {PANELS.map((panel, index) => (
            <button
              type="button"
              key={panel.id}
              className="landing__progress-dot"
              aria-label={`Go to ${panel.label}`}
              aria-current={activeIndex === index ? "page" : undefined}
              onClick={() => moveTo(panel.id)}
            >
              <span aria-hidden="true" />
              <span className="visually-hidden">{panel.label}</span>
            </button>
          ))}
        </div>
        <div className="landing__pager">
          <button
            type="button"
            aria-label="Previous section"
            disabled={activeIndex === 0}
            onClick={() => moveBy(-1)}
          >
            ←
          </button>
          <span>
            {String(activeIndex + 1).padStart(2, "0")} / {String(PANELS.length).padStart(2, "0")}
          </span>
          <button
            type="button"
            aria-label="Next section"
            disabled={activeIndex === PANELS.length - 1}
            onClick={() => moveBy(1)}
          >
            →
          </button>
        </div>
      </div>
    </div>
  );
}

export const Landing = LandingPage;
