import { useEffect, useRef, type KeyboardEvent } from "react";
import Lenis from "lenis";

import { Mascot } from "../Mascot";
import type { AuthIntent } from "./AuthCard";

interface LandingProps {
  busy: boolean;
  error: string | null;
  authEnabled?: boolean;
  authLoading?: boolean;
  onSignIn: () => void;
  onEmailAuth?: (email: string, password: string, intent: AuthIntent) => Promise<void>;
}

const PANELS = [
  { id: "meet", label: "Meet Cooper" },
  { id: "features", label: "Features" },
  { id: "uses", label: "Uses" },
  { id: "proof", label: "How Cooper plans" },
  { id: "start", label: "Try it" },
] as const;

function panelId(id: string): string {
  return `landing-${id}`;
}

function ProductCapture({ source, alt }: { source: string; alt: string }) {
  return (
    <div className="landing__product-window landing__product-window--capture">
      <img src={source} alt={alt} loading="lazy" decoding="async" width="1440" height="900" />
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

function HandArrow({ flip = false, tall = false }: { flip?: boolean; tall?: boolean }) {
  return (
    <svg
      className={`landing__hand-arrow${flip ? " landing__hand-arrow--flip" : ""}${
        tall ? " landing__hand-arrow--tall" : ""
      }`}
      viewBox={tall ? "0 0 112 76" : "0 0 90 42"}
      aria-hidden="true"
    >
      {tall ? (
        <>
          <path d="M7 62C11 32 39 8 92 12" />
          <path d="m83 5 13 7-13 9" />
        </>
      ) : (
        <>
          <path d="M4 10c19-8 46-5 68 16" />
          <path d="m62 25 12 3-2-12" />
        </>
      )}
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

export function LandingPage(_props: LandingProps) {
  const track = useRef<HTMLDivElement>(null);
  const lenis = useRef<Lenis | null>(null);
  const activeIndex = useRef(0);
  const wakeScroll = useRef(() => {});

  useEffect(() => {
    const matchMedia = window.matchMedia?.bind(window);
    if (!matchMedia) return;
    const media = matchMedia("(min-width: 900px)");
    let frame = 0;
    let unsubscribe = (): void => {};
    let observer: IntersectionObserver | undefined;

    const animate = (time: number): void => {
      lenis.current?.raf(time);
      frame = lenis.current?.isScrolling ? requestAnimationFrame(animate) : 0;
    };
    const wake = (): void => {
      if (!frame) frame = requestAnimationFrame(animate);
    };
    wakeScroll.current = wake;

    const setupScroll = (): void => {
      unsubscribe();
      lenis.current?.destroy();
      observer?.disconnect();

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
        syncTouch: false,
        lerp: 0.075,
        syncTouchLerp: 0.06,
        anchors: true,
        autoRaf: false,
        respectReducedMotion: true,
      });

      lenis.current = instance;
      unsubscribe = instance.on("virtual-scroll", wake);
      if (typeof IntersectionObserver !== "undefined") {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              entry.target.classList.toggle("is-in-view", entry.isIntersecting);
              if (!entry.isIntersecting) continue;
              const index = PANELS.findIndex((panel) => panelId(panel.id) === entry.target.id);
              if (index >= 0) activeIndex.current = index;
            }
          },
          { root: horizontal ? track.current : null, threshold: 0.3 },
        );
        track.current
          ?.querySelectorAll(".landing__panel")
          .forEach((panel) => observer?.observe(panel));
      }
    };

    setupScroll();
    media.addEventListener("change", setupScroll);

    return () => {
      cancelAnimationFrame(frame);
      media.removeEventListener("change", setupScroll);
      unsubscribe();
      observer?.disconnect();
      lenis.current?.destroy();
      lenis.current = null;
      wakeScroll.current = () => {};
    };
  }, []);

  function moveTo(id: string): void {
    const nextIndex = PANELS.findIndex((panel) => panel.id === id);
    if (nextIndex >= 0) activeIndex.current = nextIndex;
    const target = document.getElementById(panelId(id));
    if (!target) return;
    if (lenis.current) {
      lenis.current.scrollTo(target, { immediate: lenis.current.prefersReducedMotion });
      wakeScroll.current();
      return;
    }
    target.scrollIntoView({ behavior: "auto", block: "nearest", inline: "start" });
  }

  function moveBy(delta: number): void {
    const nextIndex = Math.min(Math.max(activeIndex.current + delta, 0), PANELS.length - 1);
    moveTo(PANELS[nextIndex].id);
  }

  function trackKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, select, [contenteditable]")
    )
      return;
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
          className="landing__panel landing__panel--hero landing__panel--meet landing__panel--hero-v2"
          id={panelId("meet")}
        >
          <div className="landing__hero-copy-v2">
            <h1>
              Hi, I&rsquo;m <span>Cooper.</span>
            </h1>
            <p className="landing__lede">
              The one place for everything taking your time. Tell me what&rsquo;s on your mind and
              I&rsquo;ll help turn it into a day you can actually do.
            </p>
            <div className="landing__cta-row">
              <a
                className="landing__primary"
                href="#landing-features"
                onClick={(event) => {
                  event.preventDefault();
                  moveTo("features");
                }}
              >
                See how Cooper helps
              </a>
              <a className="landing__secondary" href="/signup">
                Create your account
              </a>
            </div>
            <p className="landing__hero-assurance">Tasks, events, and errands in one calm place.</p>
          </div>
          <div
            className="landing__hero-proof"
            role="img"
            aria-label="An example of Cooper turning a sentence into a ninety-minute calendar block"
          >
            <div className="landing__hero-spread">
              <div className="landing__hero-thought">
                <span>You say</span>
                <p>Send the proposal Thursday. It needs about 90 minutes.</p>
                <div className="landing__hero-thought-facts" aria-hidden="true">
                  <b>Task</b>
                  <b>Thursday</b>
                  <b>90 min</b>
                </div>
              </div>
              <div className="landing__hero-plan">
                <div className="landing__hero-plan-heading">
                  <div>
                    <span>Cooper made room</span>
                    <strong>Proposal</strong>
                  </div>
                  <b>Thursday</b>
                </div>
                <div className="landing__hero-day" aria-hidden="true">
                  <time>1:00</time>
                  <span className="landing__hero-day-event">Class</span>
                  <time>2:00</time>
                  <span className="landing__hero-day-task">
                    <strong>Proposal</strong>
                    <small>90 min</small>
                  </span>
                  <time>3:30</time>
                  <span className="landing__hero-day-open">Open</span>
                </div>
                <div className="landing__hero-plan-meta">
                  <span>Exact duration</span>
                  <span>Inside your hours</span>
                </div>
              </div>
            </div>
            <img
              className="landing__hero-cooper"
              src="/assets/mascot/cooper_landing_hero.webp"
              alt=""
              loading="eager"
              decoding="async"
            />
            <p className="landing__hero-hand-note" aria-hidden="true">
              Messy is fine. I&rsquo;ll find the fit.
            </p>
          </div>
        </section>

        <section
          className="landing__panel landing__panel--features landing__panel--story"
          id={panelId("features")}
        >
          <header className="landing__story-heading">
            <h2>
              One thought in. <span>A clear day out.</span>
            </h2>
            <p>
              No boards to groom or system to maintain. Cooper turns ordinary words into a useful
              next step.
            </p>
          </header>
          <div
            className="landing__feature-grid landing__feature-grid--notes"
            aria-label="How Cooper helps"
          >
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
              <ServiceChip service="luma" note="planned" />
              <ServiceChip service="meetup" note="planned" />
              <ServiceChip service="teams" note="planned" />
              <ServiceChip service="classroom" note="planned" />
            </div>
            <div className="landing__hand-note landing__hand-note--connected">
              <HandArrow />
              connected calendars protect busy time
            </div>
            <Mascot name="cooper_syncing" size="md" decorative />
          </div>
          <div className="landing__copy landing__copy--narrow landing__week-margin">
            <h2>
              For the week that changes by <span>Tuesday.</span>
            </h2>
            <div className="landing__week-sheet">
              <div className="landing__use-list">
                <article>
                  <span className="landing__use-verb">Keep visible</span>
                  <div>
                    <strong>Classes &amp; deadlines</strong>
                    <span>Keep your tasks visible without booking over connected events.</span>
                  </div>
                </article>
                <article>
                  <span className="landing__use-verb">Make room</span>
                  <div>
                    <strong>Work &amp; errands</strong>
                    <span>Give focused work a block; leave quick errands on the list.</span>
                  </div>
                </article>
                <article>
                  <span className="landing__use-verb">Reserve time</span>
                  <div>
                    <strong>Events from your inbox</strong>
                    <span>
                      Supported Gmail confirmations can reserve their time when connected.
                    </span>
                  </div>
                </article>
              </div>
              <div className="landing__privacy-note">
                <Mascot name="cooper_secure" size="xs" decorative />
                <div>
                  <strong>Private by design</strong>
                  <span>Connected calendars are read-only. New blocks stay in Cooper.</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing__panel landing__panel--proof" id={panelId("proof")}>
          <div className="landing__proof-shell">
            <div className="landing__proof-copy">
              <h2>
                Messy thought in. <span>Realistic time out.</span>
              </h2>
              <p>
                Cooper handles the small planning decisions between remembering something and seeing
                it fit your actual day.
              </p>
            </div>

            <div
              className="landing__proof-grid"
              aria-label="How Cooper turns a thought into a workable plan"
            >
              <article className="landing__proof-card landing__proof-card--capture">
                <div className="landing__proof-visual" aria-hidden="true">
                  <span className="landing__proof-message">
                    Finish the proposal by Thursday. About 90 minutes.
                  </span>
                  <span className="landing__proof-caret" />
                </div>
                <h3>Say it naturally</h3>
                <p>One sentence is enough to capture the task, deadline, and duration.</p>
              </article>

              <article className="landing__proof-card landing__proof-card--priority">
                <div className="landing__proof-visual" aria-hidden="true">
                  <span className="landing__rank landing__rank--first">
                    <b>1</b>
                    <i />
                    <em>due soon</em>
                  </span>
                  <span className="landing__rank">
                    <b>2</b>
                    <i />
                  </span>
                  <span className="landing__rank">
                    <b>3</b>
                    <i />
                  </span>
                </div>
                <h3>Know what comes first</h3>
                <p>Every priority keeps a plain reason you can inspect.</p>
              </article>

              <article className="landing__proof-card landing__proof-card--duration">
                <div className="landing__proof-visual" aria-hidden="true">
                  <div className="landing__time-ruler">
                    <span>9</span>
                    <span>10</span>
                    <span>11</span>
                    <i />
                    <strong>90 min</strong>
                  </div>
                </div>
                <h3>Keep the real duration</h3>
                <p>A ninety-minute task gets a ninety-minute block—not a guess.</p>
              </article>

              <article className="landing__proof-card landing__proof-card--hours">
                <div className="landing__proof-visual" aria-hidden="true">
                  <div className="landing__hours-bar">
                    <span />
                    <strong>9:00–17:00</strong>
                    <span />
                  </div>
                  <small>Your working hours</small>
                </div>
                <h3>Your hours stay yours</h3>
                <p>Cooper only considers the availability you configured.</p>
              </article>

              <article className="landing__proof-card landing__proof-card--protected">
                <div className="landing__proof-visual" aria-hidden="true">
                  <div className="landing__mini-day">
                    <span className="landing__mini-event">Class</span>
                    <span className="landing__mini-gap" />
                    <span className="landing__mini-task">Proposal</span>
                  </div>
                </div>
                <h3>Busy time stays protected</h3>
                <p>New work fits around connected commitments instead of over them.</p>
              </article>

              <article className="landing__proof-card landing__proof-card--undo">
                <div className="landing__proof-visual" aria-hidden="true">
                  <div className="landing__undo-row">
                    <span>Scheduled proposal</span>
                    <strong>Undo</strong>
                  </div>
                  <span className="landing__undo-return">Back where it was</span>
                </div>
                <h3>Take it back in one step</h3>
                <p>The last change stays reversible, including a scheduling run.</p>
              </article>
            </div>
          </div>
        </section>

        <section
          className="landing__panel landing__panel--start landing__panel--closing"
          id={panelId("start")}
        >
          <div className="landing__closing-stage">
            <div className="landing__closing-copy">
              <h2>Ready for a calmer day?</h2>
              <p>
                Give your tasks, events, and errands one private place to land. Start with one
                thought and let Cooper help with the rest.
              </p>
              <div className="landing__closing-actions">
                <a className="landing__closing-primary" href="/signup">
                  Create your account
                </a>
                <a className="landing__closing-secondary" href="/login">
                  Log in
                </a>
              </div>
              <p className="landing__closing-assurance">
                <span>Private workspace</span>
                <span>Works before you connect Google</span>
              </p>
            </div>
            <div className="landing__closing-visual" aria-hidden="true">
              <span className="landing__closing-note">One thought is enough to begin.</span>
              <span className="landing__closing-thought-card">
                <small>You bring</small>
                <strong>Send the proposal Thursday</strong>
              </span>
              <span className="landing__closing-plan-card">
                <small>Cooper makes room</small>
                <strong>Thursday · 2:00–3:30</strong>
                <em>Inside your hours</em>
              </span>
              <img src="/assets/mascot/cooper_waving.webp" alt="" loading="lazy" decoding="async" />
              <span className="landing__closing-line" />
            </div>
          </div>
          <footer className="landing__footer landing__closing-footer">
            <span className="landing__footer-signature">
              <span>
                <span className="public-brand-name">Cooper</span> © 2026
              </span>
              <span>· for your own words and your own time.</span>
            </span>
            <nav aria-label="Legal">
              <a href="/privacy" target="_blank" rel="noopener noreferrer">
                Privacy
              </a>
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                Terms
              </a>
            </nav>
          </footer>
        </section>
      </div>
    </div>
  );
}

export const Landing = LandingPage;
