import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import Lenis from "lenis";

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
  { id: "meet", label: "Meet Cooper" },
  { id: "features", label: "Features" },
  { id: "uses", label: "Uses" },
  { id: "start", label: "Try it" },
] as const;

const LANDING_EASING = (value: number): number => 1 - Math.pow(1 - value, 3);

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

function CalendarMock() {
  return (
    <ProductCapture
      source="/assets/landing/cooper-app-calendar.webp"
      alt="Cooper calendar showing protected working hours"
    />
  );
}

type Service = "calendar" | "gmail" | "luma" | "meetup" | "teams" | "classroom";

const SERVICE_LABEL: Record<Service, string> = {
  calendar: "Google Calendar",
  gmail: "Gmail",
  luma: "Luma",
  meetup: "Meetup",
  teams: "Microsoft Teams",
  classroom: "Google Classroom",
};

function ServiceIcon({ service }: { service: Service }) {
  if (service === "gmail" || service === "calendar") {
    return (
      <img
        className="landing__service-icon"
        src={`/assets/brand/${service === "gmail" ? "gmail-2026" : "google-calendar-2026"}.svg`}
        alt=""
        aria-hidden="true"
      />
    );
  }

  if (service === "luma") {
    return (
      <img
        className="landing__service-icon landing__service-icon--luma"
        src="/assets/brand/luma-2026.png"
        alt=""
        aria-hidden="true"
      />
    );
  }

  if (service === "teams" || service === "classroom") {
    return (
      <img
        className={`landing__service-icon landing__service-icon--${service}`}
        src={`/assets/brand/${service === "teams" ? "microsoft-teams" : "google-classroom"}.svg`}
        alt=""
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className={`landing__service-icon landing__service-icon--mask landing__service-icon--${service}`}
      aria-hidden="true"
    />
  );
}

function HandArrow({ flip = false }: { flip?: boolean }) {
  return (
    <svg
      className={`landing__hand-arrow${flip ? " landing__hand-arrow--flip" : ""}`}
      viewBox="0 0 90 42"
      aria-hidden="true"
    >
      <path d="M4 10c19-8 46-5 68 16" />
      <path d="m62 25 12 3-2-12" />
    </svg>
  );
}

function IntegrationCard({
  service,
  title,
  detail,
}: {
  service: Service;
  title: string;
  detail: string;
}) {
  return (
    <article className={`landing__integration landing__integration--${service}`}>
      <ServiceIcon service={service} />
      <div>
        <p>{SERVICE_LABEL[service]}</p>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
    </article>
  );
}

function ServiceChip({ service, note }: { service: Service; note: string }) {
  return (
    <article
      className={`landing__integration landing__service-chip landing__service-chip--${service}`}
    >
      <ServiceIcon service={service} />
      <div>
        <p>{SERVICE_LABEL[service]}</p>
        <strong>{note === "planned" ? "Planned source" : "Event invitations"}</strong>
        <span>{note === "planned" ? "Coming next" : "Arrives through Gmail"}</span>
      </div>
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
  const lenis = useRef<Lenis | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const matchMedia = window.matchMedia?.bind(window);
    if (!matchMedia) return;
    const media = matchMedia("(min-width: 900px)");
    let frame = 0;
    let unsubscribe = (): void => {};

    const setupScroll = (): void => {
      unsubscribe();
      lenis.current?.destroy();

      const horizontal = media.matches;
      const wrapper = horizontal ? track.current : window;
      if (!wrapper) return;

      const instance = new Lenis({
        wrapper,
        content: horizontal ? (track.current ?? undefined) : document.documentElement,
        eventsTarget: horizontal ? (track.current ?? undefined) : window,
        orientation: horizontal ? "horizontal" : "vertical",
        gestureOrientation: horizontal ? "both" : "vertical",
        smoothWheel: true,
        syncTouch: true,
        lerp: 0.1,
        duration: 0.85,
        easing: LANDING_EASING,
        anchors: true,
        autoRaf: false,
        respectReducedMotion: true,
      });

      lenis.current = instance;
      unsubscribe = instance.on("scroll", ({ scroll }) => {
        const element = track.current;
        if (!horizontal || !element || element.clientWidth <= 0) return;
        const nextIndex = Math.round(scroll / element.clientWidth);
        setActiveIndex(Math.min(Math.max(nextIndex, 0), PANELS.length - 1));
      });
    };

    const animate = (time: number): void => {
      lenis.current?.raf(time);
      frame = requestAnimationFrame(animate);
    };

    setupScroll();
    frame = requestAnimationFrame(animate);
    media.addEventListener("change", setupScroll);

    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", setupScroll);
      unsubscribe();
      lenis.current?.destroy();
      lenis.current = null;
    };
  }, []);

  function moveTo(id: string): void {
    const nextIndex = PANELS.findIndex((panel) => panel.id === id);
    if (nextIndex >= 0) setActiveIndex(nextIndex);
    const target = document.getElementById(panelId(id));
    if (!target) return;
    if (lenis.current) {
      lenis.current.scrollTo(target, { immediate: lenis.current.prefersReducedMotion });
      return;
    }
    target.scrollIntoView({ behavior: "auto", block: "nearest", inline: "start" });
  }

  function moveBy(delta: number): void {
    const nextIndex = Math.min(Math.max(activeIndex + delta, 0), PANELS.length - 1);
    moveTo(PANELS[nextIndex].id);
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

  return (
    <div className="landing landing--keeby">
      <header className="landing__header">
        <p className="landing__beta-status">
          Cooper is currently in public beta · The app is still under construction
        </p>
      </header>

      <div
        className="landing__track"
        ref={track}
        role="region"
        aria-label="Cooper overview"
        tabIndex={0}
        onKeyDown={trackKeyDown}
      >
        <section
          className="landing__panel landing__panel--hero landing__panel--meet"
          id={panelId("meet")}
        >
          <div className="landing__copy">
            <svg className="landing__paper-doodles" viewBox="0 0 680 430" aria-hidden="true">
              <path d="m24 82 3 15 15 3-15 3-3 15-3-15-15-3 15-3Z" />
              <path d="m648 286 2.5 12 12 2.5-12 2.5-2.5 12-2.5-12-12-2.5 12-2.5Z" />
              <path d="m625 72 1.5 8 8 1.5-8 1.5-1.5 8-1.5-8-8-1.5 8-1.5Z" />
              <path className="landing__paper-squiggle" d="M14 340c16-13 30 13 46 0s30 13 46 0" />
            </svg>
            <p className="landing__eyebrow">Meet your calm little timekeeper</p>
            <h1>
              Hi, I&rsquo;m <span>Cooper.</span>
            </h1>
            <p className="landing__lede">
              The one place for everything taking your time. Tell me what&rsquo;s on your mind and
              I&rsquo;ll help turn it into a day you can actually do.
            </p>
            <div className="landing__cta-row">
              <a className="landing__primary" href="#landing-features">
                See how Cooper helps
              </a>
              <a className="landing__secondary" href="/signup">
                Try the beta
              </a>
            </div>
          </div>
          <div className="landing__stage landing__stage--today">
            <div className="landing__cooper-hello">
              <svg className="landing__avatar-doodles" viewBox="0 0 590 570" aria-hidden="true">
                <path className="landing__doodle-orbit" d="M72 210C82 98 184 34 298 38" />
                <path className="landing__doodle-orbit" d="M506 346c-28 106-128 170-239 166" />
                <path
                  className="landing__doodle-spark"
                  d="m103 119 3 15 15 3-15 3-3 15-3-15-15-3 15-3Z"
                />
                <path
                  className="landing__doodle-spark"
                  d="m491 392 2 11 11 2-11 2-2 11-2-11-11-2 11-2Z"
                />
                <path className="landing__doodle-wave" d="M88 391c18-14 35 14 53 0s35 14 53 0" />
              </svg>
              <div className="landing__cooper-portrait">
                <Mascot name="cooper_avatar" size="lg" decorative loading="eager" />
              </div>
              <div className="landing__hello-note">
                <HandArrow flip />
                <span>Hi! Give me the messy version. We&rsquo;ll sort it out together.</span>
              </div>
              <div className="landing__intro-slips" aria-hidden="true">
                <span>tasks</span>
                <span>events</span>
                <span>errands</span>
              </div>
            </div>
          </div>
        </section>

        <section className="landing__panel landing__panel--features" id={panelId("features")}>
          <div className="landing__copy landing__copy--narrow">
            <p className="landing__eyebrow">What Cooper actually does</p>
            <h2>One thought in. A clear day out.</h2>
            <p className="landing__body">
              No boards to groom or system to maintain. Cooper turns ordinary words into a useful
              next step.
            </p>
            <div className="landing__hand-note landing__hand-note--features">
              <HandArrow flip />
              the boring planning bits, handled
            </div>
          </div>
          <div className="landing__feature-grid" aria-label="Cooper features">
            <article className="landing__feature-card landing__feature-card--capture">
              <span className="landing__feature-number">01</span>
              <Mascot name="cooper_landing_capture" size="sm" decorative />
              <h3>Catch it</h3>
              <p>Type the thought once, naturally. Cooper keeps the task, deadline, and detail.</p>
              <span className="landing__scribble">before it slips away</span>
            </article>
            <article className="landing__feature-card landing__feature-card--sort">
              <span className="landing__feature-number">02</span>
              <Mascot name="cooper_landing_sort" size="sm" decorative />
              <h3>Know what&rsquo;s next</h3>
              <p>See what matters first and the plain-English reason it earned that spot.</p>
              <span className="landing__scribble">no mystery score ✓</span>
            </article>
            <article className="landing__feature-card landing__feature-card--room">
              <span className="landing__feature-number">03</span>
              <Mascot name="cooper_calendar" size="sm" decorative />
              <h3>Give it real time</h3>
              <p>Fit work inside your hours and around commitments already on the calendar.</p>
              <span className="landing__scribble">never outside your hours</span>
            </article>
          </div>
        </section>

        <section className="landing__panel landing__panel--uses" id={panelId("uses")}>
          <div className="landing__uses-board">
            <div className="landing__uses-window">
              <CalendarMock />
            </div>
            <div className="landing__service-stack" aria-label="Connected and planned services">
              <IntegrationCard
                service="gmail"
                title="Event confirmation"
                detail="Read-only · known senders"
              />
              <IntegrationCard
                service="calendar"
                title="Your existing schedule"
                detail="Busy time stays protected"
              />
            </div>
            <div className="landing__service-chip-grid" aria-label="More event sources">
              <svg
                className="landing__service-connectors"
                viewBox="0 0 760 430"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="service-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="7"
                    markerHeight="7"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                <path d="M 132 188 C 126 183, 121 174, 116 166" markerEnd="url(#service-arrow)" />
                <path d="M 245 78 C 245 69, 245 62, 245 55" markerEnd="url(#service-arrow)" />
                <path d="M 176 274 C 176 290, 168 305, 158 316" markerEnd="url(#service-arrow)" />
                <path d="M 362 274 C 366 290, 370 305, 370 316" markerEnd="url(#service-arrow)" />
              </svg>
              <ServiceChip service="luma" note="via Gmail" />
              <ServiceChip service="meetup" note="via Gmail" />
              <ServiceChip service="teams" note="planned" />
              <ServiceChip service="classroom" note="planned" />
            </div>
            <div className="landing__hand-note landing__hand-note--connected">
              <HandArrow />
              these block time automatically
            </div>
            <Mascot name="cooper_syncing" size="md" decorative />
          </div>
          <div className="landing__copy landing__copy--narrow">
            <p className="landing__eyebrow">Where it fits into real life</p>
            <h2>For the week that changes by Tuesday.</h2>
            <div className="landing__use-list">
              <article>
                <strong>Classes &amp; deadlines</strong>
                <span>Keep assignments visible without booking over lectures.</span>
              </article>
              <article>
                <strong>Work &amp; errands</strong>
                <span>Give focused work a block; leave quick errands on the list.</span>
              </article>
              <article>
                <strong>Events from your inbox</strong>
                <span>Luma, Meetup, and Eventbrite confirmations can reserve their time.</span>
              </article>
            </div>
            <div className="landing__privacy-note">
              <Mascot name="cooper_secure" size="xs" decorative />
              <div>
                <strong>Private by design</strong>
                <span>Gmail is read-only. Cooper writes only blocks it scheduled.</span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="landing__panel landing__panel--auth landing__panel--start auth-screen"
          id={panelId("start")}
        >
          <div className="landing__copy landing__copy--narrow">
            <p className="landing__eyebrow">Ready when you are</p>
            <h2>
              Give <span className="public-brand-name">Cooper</span> one thing to remember.
            </h2>
            <p className="landing__body">
              Start small. Add one task, see why it matters, and let{" "}
              <span className="public-brand-name">Cooper</span> find it a sensible place.
            </p>
            <ul className="landing__start-checks" aria-label="What you get">
              <li>Private workspace</li>
              <li>Works before you connect Google</li>
              <li>No password to remember</li>
            </ul>
            <div className="landing__start-art">
              <Mascot name="cooper_waving" size="md" decorative />
              <span className="landing__scribble">I&rsquo;ll take it from here →</span>
            </div>
          </div>
          <div className="landing__start-column">
            <AuthCard
              intent="signup"
              busy={busy}
              error={error}
              authEnabled={authEnabled}
              authLoading={authLoading}
              onSignIn={onSignIn}
            />
            <div className="landing__setup-note">
              <HandArrow />
              about two minutes to get settled
            </div>
            <footer className="landing__footer">
              <span>
                <span className="public-brand-name">Cooper</span> © 2026
              </span>
              <nav aria-label="Legal">
                <a href="/privacy">Privacy</a>
                <a href="/terms">Terms</a>
              </nav>
            </footer>
          </div>
        </section>
      </div>
    </div>
  );
}

export const Landing = LandingPage;
