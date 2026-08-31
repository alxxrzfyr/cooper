import { useRef, useState, type WheelEvent } from "react";

import { Mascot } from "./Mascot";

import "./Landing.css";

type AuthIntent = "signup" | "login";

interface LandingProps {
  busy: boolean;
  error: string | null;
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

export function Landing({ busy, error, onSignIn }: LandingProps) {
  const [intent, setIntent] = useState<AuthIntent>("signup");
  const track = useRef<HTMLDivElement>(null);
  const authCard = useRef<HTMLElement>(null);

  function moveTo(id: string, nextIntent?: AuthIntent): void {
    if (nextIntent) setIntent(nextIntent);

    const target = document.getElementById(panelId(id));
    if (!target || typeof target.scrollIntoView !== "function") return;
    target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
  }

  function focusAuth(nextIntent: AuthIntent): void {
    setIntent(nextIntent);
    const card = authCard.current;
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }

  function horizontalWheel(event: WheelEvent<HTMLDivElement>): void {
    const element = track.current;
    if (!element || typeof window === "undefined") return;

    const wide = window.matchMedia?.("(min-width: 900px)").matches ?? false;
    if (!wide || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: "auto" });
  }

  return (
    <div className="landing">
      <header className="landing__header">
        <button
          type="button"
          className="landing__brand"
          aria-label="Cooper home"
          onClick={() => moveTo("top")}
        >
          <Mascot name="cooper_avatar" size="xs" decorative />
          <span className="landing__wordmark">Cooper</span>
        </button>

        <nav className="landing__nav" aria-label="Landing sections">
          {PANELS.slice(1, 4).map((panel) => (
            <button
              type="button"
              className="landing__nav-link"
              key={panel.id}
              onClick={() => moveTo(panel.id)}
            >
              {panel.label}
            </button>
          ))}
        </nav>

        <div className="landing__actions">
          <button type="button" className="landing__quiet" onClick={() => focusAuth("login")}>
            Log in
          </button>
          <button type="button" className="landing__header-cta" onClick={() => focusAuth("signup")}>
            Create account
          </button>
        </div>
      </header>

      <div
        className="landing__track"
        ref={track}
        role="region"
        aria-label="Cooper overview"
        tabIndex={0}
        onWheel={horizontalWheel}
      >
        <section className="landing__panel landing__panel--hero" id={panelId("top")}>
          <div className="landing__copy">
            <p className="landing__eyebrow">A calmer day starts here</p>
            <h1>A calmer place for everything that takes your time.</h1>
            <p className="landing__lede">
              Capture a thought, find what matters, and give your day room to breathe.
            </p>
            <div className="landing__cta-row">
              <button
                type="button"
                className="landing__primary"
                onClick={() => focusAuth("signup")}
              >
                Create your account
              </button>
              <button type="button" className="landing__secondary" onClick={() => moveTo("how")}>
                See how it works
              </button>
            </div>
            <p className="landing__hint">Google sign-in creates your account the first time.</p>
          </div>

          <div className="landing__hero-art">
            <Mascot name="cooper_landing_hero" size="lg" decorative />
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

          <aside className="landing__auth-card" ref={authCard} aria-labelledby="landing-auth-title">
            <span className="landing__auth-kicker">Your first step</span>
            <h2 id="landing-auth-title">
              {intent === "signup" ? "Create your Cooper account" : "Log in to Cooper"}
            </h2>
            <p>
              Use your approved Google account. The first sign-in creates your account; returning
              users log in the same way.
            </p>
            <div className="landing__auth-switch" role="group" aria-label="Account action">
              <button
                type="button"
                aria-pressed={intent === "signup"}
                onClick={() => setIntent("signup")}
              >
                Create account
              </button>
              <button
                type="button"
                aria-pressed={intent === "login"}
                onClick={() => setIntent("login")}
              >
                Log in
              </button>
            </div>
            <button type="button" className="landing__google" disabled={busy} onClick={onSignIn}>
              {busy ? "Opening Google…" : "Continue with Google"}
            </button>
            {error && (
              <p className="landing__error" role="alert">
                {error}
              </p>
            )}
            <p className="landing__fineprint">No password to remember. Sign out any time.</p>
          </aside>
        </section>
      </div>

      <div className="landing__scroll-cue" aria-hidden="true">
        <span>Scroll to explore</span>
        <span>→</span>
      </div>
    </div>
  );
}
