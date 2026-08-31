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
  { id: "untangle", label: "Untangle" },
  { id: "prioritize", label: "Prioritize" },
  { id: "room", label: "Make room" },
  { id: "start", label: "Start" },
] as const;

function panelId(id: string): string {
  return `landing-${id}`;
}

function ProductCapture({ source, alt }: { source: string; alt: string }) {
  return (
    <div className="landing__product-window landing__product-window--capture">
      <img src={source} alt={alt} loading="eager" decoding="async" />
    </div>
  );
}

function TodayMock() {
  return (
    <ProductCapture
      source="/assets/landing/cooper-app-home.webp"
      alt="Cooper Home screen with the day view"
    />
  );
}

function ChatMock() {
  return (
    <ProductCapture
      source="/assets/landing/cooper-app-ai.webp"
      alt="Cooper AI chat screen with suggested questions"
    />
  );
}

function CalendarMock() {
  return (
    <ProductCapture
      source="/assets/landing/cooper-app-calendar.webp"
      alt="Cooper Calendar screen with the weekly schedule grid"
    />
  );
}

function IntegrationCard({
  service,
  title,
  detail,
  time,
}: {
  service: "calendar" | "gmail";
  title: string;
  detail: string;
  time: string;
}) {
  return (
    <article className={`landing__integration landing__integration--${service}`}>
      <span className="landing__integration-mark" aria-hidden="true">
        {service === "gmail" ? "M" : "31"}
      </span>
      <div>
        <p>{service === "gmail" ? "Gmail" : "Google Calendar"}</p>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <time>{time}</time>
    </article>
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
          <Mascot name="cooper_avatar" size="sm" decorative loading="eager" />
          <span className="landing__wordmark">Cooper</span>
        </a>
        <nav className="landing__header-nav" aria-label="Product sections">
          <a href="#landing-untangle">Today</a>
          <a href="#landing-prioritize">Ask Cooper</a>
          <a href="#landing-room">Connected time</a>
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
        <section
          className="landing__panel landing__panel--hero landing__panel--untangle"
          id={panelId("untangle")}
        >
          <div className="landing__copy">
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
            <div className="landing__product-layout">
              <TodayMock />
              <div className="landing__support-rail">
                <p className="landing__support-label">Your day, in one place</p>
                <IntegrationCard
                  service="calendar"
                  title="CS101 lecture"
                  detail="Tomorrow · 9:00 AM"
                  time="09:00"
                />
                <Mascot name="cooper_landing_hero" size="md" decorative loading="eager" />
              </div>
            </div>
          </div>
        </section>

        <section
          className="landing__panel landing__panel--how landing__panel--prioritize"
          id={panelId("prioritize")}
        >
          <div className="landing__stage landing__stage--chat">
            <div className="landing__product-layout">
              <ChatMock />
              <div className="landing__support-rail">
                <p className="landing__support-label">From thought to next step</p>
                <IntegrationCard
                  service="gmail"
                  title="Presentation details"
                  detail="Inbox · University"
                  time="2m"
                />
                <Mascot name="cooper_landing_sort" size="sm" decorative />
              </div>
            </div>
          </div>
          <div className="landing__copy landing__copy--narrow">
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
            <div className="landing__product-layout">
              <CalendarMock />
              <div className="landing__support-rail">
                <p className="landing__support-label">Only the time Cooper places</p>
                <IntegrationCard
                  service="gmail"
                  title="Room booked"
                  detail="Confirmation · Gmail"
                  time="now"
                />
                <Mascot name="cooper_landing_ready" size="sm" decorative />
              </div>
            </div>
          </div>
        </section>

        <section
          className="landing__panel landing__panel--auth landing__panel--start auth-screen"
          id={panelId("start")}
        >
          <div className="landing__copy landing__copy--narrow">
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
    </div>
  );
}

export const Landing = LandingPage;
