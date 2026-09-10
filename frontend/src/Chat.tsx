import { Fragment, useEffect, useRef, useState } from "react";

import { Mascot, type MascotName } from "./Mascot";
import type { Item, ReplyKind } from "./types";

/** How Cooper should handle the next request. Form is structured capture, Ask uses the model. */
export type Mode = "manual" | "ai";

/** One turn in the conversation. */
export interface Turn {
  id: string;
  who: "you" | "otter";
  text: string;
  kind?: ReplyKind;
  item?: Item;
  lines?: string[];
  at: number;
}

export type StepStatus = "pending" | "running" | "done" | "error";
export type StepIcon =
  | "spark"
  | "search"
  | "connect"
  | "calc"
  | "write"
  | "calendar"
  | "mail";

/** One step shown in the agent trace while thinking. */
export interface AgentStep {
  id: string;
  /** Present-tense active title. */
  title: string;
  /** Integration source badge (e.g. Gmail, Google Calendar, Tasks). */
  source: string;
  /** Action type icon. */
  icon: StepIcon;
  /** Execution status. */
  status: StepStatus;
  /** Muted subtext showing concrete result once complete. */
  subtext?: string | null;
  /** Error message if failed. */
  error?: string | null;
}

const STORE_KEY = "cooper.chat.v1";
const MODE_KEY = "cooper.mode.v1";
const KEEP = 60;

/** Quiet longer than this earns a timestamp above the next group. */
const STAMP_AFTER_MS = 15 * 60_000;
/** Turns from the same side closer together than this share one group. */
const GROUP_WITHIN_MS = 5 * 60_000;

/** Return the semantic colour for a reply. */
function tone(kind: ReplyKind | undefined): string {
  switch (kind) {
    case "added":
    case "completed":
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

/** Which Cooper goes with a reply. */
function face(kind: ReplyKind | undefined): MascotName {
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
    case "shown":
      return "cooper_reading";
    default:
      return "cooper_done";
  }
}

export function loadTurns(): Turn[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-KEEP) : [];
  } catch {
    return [];
  }
}

export function saveTurns(turns: Turn[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(turns.slice(-KEEP)));
  } catch {
    /* a full or blocked storage is not worth failing over */
  }
}

export function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "ai" ? "ai" : "manual";
  } catch {
    return "manual";
  }
}

export function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* the mode still applies for this session */
  }
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Whole days between two moments, counted by midnights so 11pm to 1am is one day. */
function nightsBetween(now: Date, then: Date): number {
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const b = new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

/** The separator text: "Today 3:04 PM", "Yesterday 9:12 AM", "Monday 8:30 PM", "Mar 3 8:30 PM". */
function stamp(at: number): string {
  const then = new Date(at);
  const nights = nightsBetween(new Date(), then);
  if (nights === 0) return `Today ${clock(at)}`;
  if (nights === 1) return `Yesterday ${clock(at)}`;
  if (nights > 1 && nights < 7) {
    return `${then.toLocaleDateString(undefined, { weekday: "long" })} ${clock(at)}`;
  }
  const day = then.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${day} ${clock(at)}`;
}

interface Group {
  who: "you" | "otter";
  turns: Turn[];
  /** Timestamp to show above this group, or null to stay silent. */
  stamp: string | null;
}

/** Group adjacent turns from the same side and add timestamps after pauses. */
export function groupTurns(turns: Turn[]): Group[] {
  const groups: Group[] = [];
  let previousAt = 0;

  for (const turn of turns) {
    const paused = previousAt === 0 || turn.at - previousAt > STAMP_AFTER_MS;
    const last = groups[groups.length - 1];
    const continues =
      last !== undefined &&
      last.who === turn.who &&
      !paused &&
      turn.at - previousAt <= GROUP_WITHIN_MS;

    if (continues) last.turns.push(turn);
    else
      groups.push({
        who: turn.who,
        turns: [turn],
        stamp: paused ? stamp(turn.at) : null,
      });

    previousAt = turn.at;
  }

  return groups;
}

/** Conversation view for sentence requests and questions. */
export function Chat({
  turns,
  thinking,
  agentSteps,
  mode,
  canUseAi,
  manualForm,
  onMode,
  onExample,
}: {
  turns: Turn[];
  thinking: boolean;
  agentSteps?: AgentStep[];
  mode: Mode;
  canUseAi: boolean;
  manualForm: React.ReactNode;
  onMode: (mode: Mode) => void;
  onExample: (text: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [turns.length, thinking]);

  const switcher = <ModeSwitch mode={mode} canUseAi={canUseAi} onMode={onMode} />;

  if (mode === "manual") {
    return (
      <div className="chat">
        {switcher}
        {manualForm}
      </div>
    );
  }

  if (turns.length === 0) {
    return (
      <div className="chat">
        {switcher}
        <Opening mode={mode} onExample={onExample} />
        <div ref={end} />
      </div>
    );
  }

  const groups = groupTurns(turns);

  return (
    <div className="chat">
      {switcher}

      <div className="thread" role="log" aria-label="Conversation" aria-live="polite">
        {groups.map((group, index) => {
          const last = group.turns[group.turns.length - 1];
          const closing = index === groups.length - 1 && !thinking;

          return (
            <Fragment key={group.turns[0].id}>
              {group.stamp && <div className="stamp">{group.stamp}</div>}

              <div className={`run run--${group.who}`}>
                {group.who === "otter" && <Mascot name={face(last.kind)} size="sm" decorative />}

                <div className="run__stack">
                  {group.turns.map((turn) => (
                    <div
                      key={turn.id}
                      className={[
                        "bubble",
                        group.who === "you" ? "bubble--you" : `bubble--${tone(turn.kind)}`,
                        turn.id === last.id ? "bubble--tail" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {turn.text}
                      {turn.item && <Understood item={turn.item} />}
                      {turn.lines && turn.lines.length > 0 && (
                        <ul className="bubble__lines">
                          {turn.lines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}

                  {group.who === "you" && closing && <span className="receipt">Delivered</span>}
                </div>
              </div>
            </Fragment>
          );
        })}

        {thinking && (
          <div className="run run--otter">
            <Mascot name="cooper_thinking" size="sm" decorative />
            <div className="run__stack">
              {agentSteps && agentSteps.length > 0 ? (
                <AgentTrace steps={agentSteps} />
              ) : (
                <div
                  className="bubble bubble--plain bubble--tail bubble--thinking"
                  aria-label="Thinking"
                >
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={end} />
      </div>
    </div>
  );
}

/** Switch between the capture form and Cooper's AI conversation. */
function ModeSwitch({
  mode,
  canUseAi,
  onMode,
}: {
  mode: Mode;
  canUseAi: boolean;
  onMode: (mode: Mode) => void;
}) {
  return (
    <div className="modebar">
      {/*
        Its own control rather than Settings' segmented one: this is two choices in a capsule at
        the top of the conversation, and the thumb slides between them. `data-mode` is what moves
        it, so the animation is one compositor-driven transform rather than per-frame work.
      */}
      <div
        className="modeswitch"
        data-mode={mode}
        role="group"
        aria-label="How do you want to work with Cooper"
      >
        <span className="modeswitch__thumb" aria-hidden="true" />
        <button
          type="button"
          className="modeswitch__opt"
          aria-pressed={mode === "manual"}
          onClick={() => onMode("manual")}
        >
          Form
        </button>
        <button
          type="button"
          className="modeswitch__opt"
          aria-pressed={mode === "ai"}
          disabled={!canUseAi}
          title={canUseAi ? undefined : "Add your Gemini API key in Settings to use Ask"}
          onClick={() => onMode("ai")}
        >
          Ask
        </button>
      </div>
      <span className="modebar__hint">
        {!canUseAi
          ? "No model key, so Form is the only mode. Add your Gemini key in Settings to use Ask."
          : mode === "manual"
            ? "Offline form. No quota spent."
            : "Ask about your tasks. Uses your daily quota."}
      </span>
    </div>
  );
}

/** The facts Cooper took from your sentence, inside his reply so a wrong parse is obvious. */
function Understood({ item }: { item: Item }) {
  const bits = [
    item.kind === "event" ? "Event" : "Task",
    item.category,
    item.minutes ? `${item.minutes} min` : null,
    item.due
      ? `due ${new Date(item.due).toLocaleDateString(undefined, { weekday: "short" })}`
      : null,
    item.start_at
      ? new Date(item.start_at).toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })
      : null,
  ].filter(Boolean);

  return <span className="bubble__meta">{bits.join(" · ")}</span>;
}

const EXAMPLES: Record<Mode, string[]> = {
  manual: [
    "write the quarterly report, 90m, important, due friday",
    "dentist thursday 3pm",
    "done quarterly",
    "plan my day",
  ],
  ai: [
    "what should I focus on this week",
    "how much is left on my plate today",
    "is there room for the gym tomorrow",
    "what is the most urgent thing",
  ],
};

function Opening({ mode, onExample }: { mode: Mode; onExample: (text: string) => void }) {
  return (
    <div className="opening">
      <Mascot name={mode === "ai" ? "cooper_thinking" : "cooper_waving"} size="lg" decorative />
      <h2 className="opening__title">{mode === "manual" ? "Capture something" : "Ask Cooper"}</h2>
      <p className="opening__text">
        {mode === "manual"
          ? "Give me the details and I’ll add it without guessing."
          : "I’m Cooper, your cheerful otter. Ask about your own tasks and time. Anything else and I’ll say so."}
      </p>
      <div className="examples">
        {EXAMPLES[mode].map((example) => (
          <button
            key={example}
            type="button"
            className="example"
            onClick={() => onExample(example)}
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

function StepActionIcon({ icon }: { icon: StepIcon }) {
  switch (icon) {
    case "spark":
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 1.5 9.4 6.6 14.5 8 9.4 9.4 8 14.5 6.6 9.4 1.5 8 6.6 6.6 8 8Z" />
        </svg>
      );
    case "search":
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
      );
    case "connect":
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <path d="M2 7h12M6 10h4" />
        </svg>
      );
    case "calc":
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polygon points="9 1 3 9 8 9 7 15 13 7 8 7 9 1" />
        </svg>
      );
    case "write":
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M11 2a1.5 1.5 0 0 1 2 2L4.5 12.5l-3 .5.5-3L11 2Z" />
        </svg>
      );
    case "calendar":
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="3" width="12" height="11" rx="2" />
          <path d="M2 6h12M5 1.5v3M11 1.5v3" />
        </svg>
      );
    case "mail":
      return (
        <svg
          viewBox="0 0 16 16"
          width="13"
          height="13"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="2" y="3.5" width="12" height="9" rx="1.5" />
          <path d="m2 4.5 6 4.5 6-4.5" />
        </svg>
      );
  }
}

function StepStatusIndicator({ status }: { status: StepStatus }) {
  if (status === "pending") {
    return <span className="agent-step__pending" aria-label="Waiting" />;
  }
  if (status === "running") {
    return (
      <span className="agent-step__spinner" aria-label="In progress">
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6" strokeOpacity="0.25" />
          <path d="M8 2a6 6 0 0 1 6 6" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  if (status === "done") {
    return (
      <span className="agent-step__done" aria-label="Completed">
        <svg
          viewBox="0 0 16 16"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      </span>
    );
  }
  return (
    <span className="agent-step__error" aria-label="Error">
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="4" y1="4" x2="12" y2="12" />
        <line x1="12" y1="4" x2="4" y2="12" />
      </svg>
    </span>
  );
}

/** Step-by-step trace showing real-time agent execution with tool badges and sequential progress. */
export function AgentTrace({
  header = "Putting it all together…",
  steps,
}: {
  header?: string;
  steps: AgentStep[];
}) {
  return (
    <div className="agent-trace" role="status" aria-label="Agent execution trace">
      <div className="agent-trace__head">
        <span className="agent-trace__title">{header}</span>
      </div>

      <div className="agent-trace__steps">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <div
              key={step.id}
              className={`agent-step agent-step--${step.status}`}
              data-status={step.status}
            >
              <div className="agent-step__rail">
                <span className={`agent-step__icon agent-step__icon--${step.icon}`}>
                  <StepActionIcon icon={step.icon} />
                </span>
                {!isLast && <span className="agent-step__line" aria-hidden="true" />}
              </div>

              <div className="agent-step__content">
                <div className="agent-step__main">
                  <span className="agent-step__title">{step.title}</span>
                  {step.source && <span className="agent-step__badge">{step.source}</span>}
                  <StepStatusIndicator status={step.status} />
                </div>

                {step.subtext && <span className="agent-step__subtext">{step.subtext}</span>}
                {step.error && <span className="agent-step__errortext">{step.error}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
