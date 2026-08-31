import { useRef, useState, type KeyboardEvent, type WheelEvent } from "react";

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
  { id: "top", label: "Start" },
  { id: "why", label: "Benefits" },
  { id: "how", label: "How it works" },
  { id: "connected", label: "Connections" },
  { id: "auth", label: "Get started" },
] as const;

function panelId(id: string): string {
  return `landing-${id}`;
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
    <div className="landing">
      <header className="landing__header">
        <a className="landing__brand" href="/" aria-label="Cooper home">
          <Mascot name="cooper_avatar" size="xs" decorative loading="eager" />
          <span className="landing__wordmark">Cooper</span>
        </a>

        <nav className="landing__nav" aria-label="Landing sections">
          {PANELS.map((panel, index) => (
            <button
              type="button"
              className="landing__nav-link"
              key={panel.id}
              aria-current={activeIndex === index ? "page" : undefined}
              onClick={() => moveTo(panel.id)}
            >
              {panel.label}
            </button>
          ))}
        </nav>

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
        <section className="landing__panel landing__panel--hero" id={panelId("top")}>
          <div className="landing__copy">
            <p className="landing__eyebrow">Talk to Cooper about your day</p>
            <h1>Turn one sentence into time you can trust.</h1>
            <p className="landing__lede">
              Tell Cooper what needs doing. It turns your words into a ranked task, then finds a
              real place for it around the commitments you already made.
            </p>
            <div className="landing__flow" aria-label="Example Cooper workflow">
              <div className="landing__flow-row">
                <span className="landing__flow-label">You say</span>
                <span className="landing__flow-value">“write the quarterly report by Friday”</span>
              </div>
              <div className="landing__flow-row">
                <span className="landing__flow-label">Cooper finds</span>
                <span className="landing__flow-value">Task · work · 90 minutes · due Friday</span>
              </div>
              <div className="landing__flow-row">
                <span className="landing__flow-label">Your day gets</span>
                <span className="landing__flow-value">
                  Mon · 10:00 AM, around what is already booked
                </span>
              </div>
            </div>
            <div className="landing__cta-row">
              <a className="landing__primary" href="/signup">
                Create your account
              </a>
              <button type="button" className="landing__secondary" onClick={() => moveTo("how")}>
                See how it works
              </button>
            </div>
            <p className="landing__hint">Google sign-in creates your account the first time.</p>
          </div>

          <div className="landing__hero-art">
            <Mascot name="cooper_landing_hero" size="lg" decorative loading="eager" />
            <div className="landing__art-note">
              <span>Tasks</span>
              <span>Events</span>
              <span>Errands</span>
            </div>
          </div>
        </section>

        <section className="landing__panel landing__panel--why" id={panelId("why")}>
          <div className="landing__copy landing__copy--narrow">
            <h2>Your day, without the detective work.</h2>
            <p className="landing__body">
              Cooper turns scattered commitments into one gentle next step, so you can spend your
              attention on the work itself.
            </p>
          </div>
          <div className="landing__benefits">
            <article>
              <span className="landing__number">01</span>
              <h3>Capture in one breath.</h3>
              <p>Write the thought as it arrives. Cooper keeps the useful parts.</p>
            </article>
            <article>
              <span className="landing__number">02</span>
              <h3>Know what matters next.</h3>
              <p>Every task has a visible reason for where it sits in your day.</p>
            </article>
            <article>
              <span className="landing__number">03</span>
              <h3>Make room for the rest.</h3>
              <p>Work blocks fit inside your hours and around commitments already made.</p>
            </article>
          </div>
        </section>

        <section className="landing__panel landing__panel--how" id={panelId("how")}>
          <div className="landing__copy">
            <h2>From thought to time in three moves.</h2>
            <p className="landing__body">
              The form is quiet when you need certainty. The conversation is there when you need a
              little help.
            </p>
          </div>
          <div className="landing__steps">
            <article>
              <Mascot name="cooper_landing_capture" size="md" decorative />
              <span>01</span>
              <h3>Capture</h3>
              <p>Put the task, event, or errand somewhere you can trust.</p>
            </article>
            <article>
              <Mascot name="cooper_landing_sort" size="md" decorative />
              <span>02</span>
              <h3>Prioritize</h3>
              <p>See what deserves attention first and why it earned that place.</p>
            </article>
            <article>
              <Mascot name="cooper_landing_ready" size="md" decorative />
              <span>03</span>
              <h3>Schedule</h3>
              <p>Give the next work a real time, only inside the hours you chose.</p>
            </article>
          </div>
        </section>

        <section className="landing__panel landing__panel--connected" id={panelId("connected")}>
          <div className="landing__connected-art">
            <Mascot name="cooper_landing_overwhelmed" size="lg" decorative />
          </div>
          <div className="landing__copy landing__copy--narrow">
            <h2>The commitments you already made, in one view.</h2>
            <p className="landing__body">
              Google Calendar events and known Gmail confirmations block time without becoming
              another list to maintain.
            </p>
            <div className="landing__boundary">
              <div>
                <strong>Read-only by default</strong>
                <span>Cooper reads commitments and writes only the blocks it schedules.</span>
              </div>
              <div>
                <strong>Works without Google</strong>
                <span>Local capture, ranking, and scheduling do not depend on an account.</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing__panel landing__panel--auth auth-screen" id={panelId("auth")}>
          <div className="landing__copy landing__copy--narrow">
            <h2>Start with a clearer day.</h2>
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

// Keep the original export name for the landing component's focused tests and existing imports.
export const Landing = LandingPage;
