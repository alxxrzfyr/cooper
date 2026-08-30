import { Fragment, useEffect, useRef } from "react";

import { Mascot, type MascotName } from "./Mascot";
import type { Item, ReplyKind } from "./types";

/** How a message was sent. Manual is the rules parser, AI is the model. */
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

const STORE_KEY = "cooper.chat.v1";
const MODE_KEY = "cooper.mode.v1";
const KEEP = 60;

/** Quiet longer than this earns a timestamp above the next group. */
const STAMP_AFTER_MS = 15 * 60_000;
/** Turns from the same side closer together than this share one group. */
const GROUP_WITHIN_MS = 5 * 60_000;

/**
 * The colour of a reply, which is the reply's meaning.
 *
 * One rule, applied everywhere in the app: green is something gained or finished, red is
 * something removed, blue is an answer rather than an action, amber wants your attention, and
 * plain is information. This is why the four categories are purple, blue, orange and teal —
 * green and red are spoken for.
 */
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

/**
 * Collapse a flat list of turns into the runs a messages app shows: consecutive bubbles from one
 * side sit tight together with a single tail and a single avatar, and a timestamp appears only
 * after a real pause rather than beside every line.
 */
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

/**
 * The conversation.
 *
 * This is the point of the app: you talk to it. The list of tasks is a consequence, not the
 * interface. Your words on the right in blue, Cooper's on the left in whatever colour matches
 * what he just did, so a scroll back through the thread reads as a history of changes.
 */
export function Chat({
  turns,
  thinking,
  mode,
  canUseAi,
  manualForm,
  onMode,
  onExample,
}: {
  turns: Turn[];
  thinking: boolean;
  mode: Mode;
  canUseAi: boolean;
  manualForm: React.ReactNode;
  onMode: (mode: Mode) => void;
  onExample: (text: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Guarded because jsdom has no scrollIntoView, and an older browser may not either. Failing
    // to auto-scroll is a cosmetic loss; throwing here would take the whole view down.
    end.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [turns.length, thinking]);

  const switcher = <ModeSwitch mode={mode} canUseAi={canUseAi} onMode={onMode} />;

  // Manual is a form now, not a sentence. AI is where you talk. The switch at the top chooses
  // which of the two surfaces is shown, and the mode is remembered between visits.
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
              <div
                className="bubble bubble--plain bubble--tail bubble--thinking"
                aria-label="Thinking"
              >
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        )}

        <div ref={end} />
      </div>
    </div>
  );
}

/**
 * Manual or AI, chosen per message.
 *
 * Manual is the default and does the work offline, because the model has a daily limit and most
 * sentences do not need it. AI is for questions about your own tasks.
 */
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
        aria-label="How to read what you type"
      >
        <span className="modeswitch__thumb" aria-hidden="true" />
        <button
          type="button"
          className="modeswitch__opt"
          aria-pressed={mode === "manual"}
          onClick={() => onMode("manual")}
        >
          Manual
        </button>
        <button
          type="button"
          className="modeswitch__opt"
          aria-pressed={mode === "ai"}
          disabled={!canUseAi}
          title={canUseAi ? undefined : "Set COOPER_GEMINI_API_KEY to use AI mode"}
          onClick={() => onMode("ai")}
        >
          AI
        </button>
      </div>
      <span className="modebar__hint">
        {!canUseAi
          ? "No model key, so Manual is the only mode"
          : mode === "manual"
            ? "Offline rules. No quota spent."
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
      <Mascot name="cooper_waving" size="lg" decorative />
      <h2 className="opening__title">
        {mode === "manual" ? "Just tell me what’s on your plate" : "Ask me about your tasks"}
      </h2>
      <p className="opening__text">
        {mode === "manual"
          ? "Write it the way you’d say it out loud. I’ll work out the task, the time, and what deserves doing first."
          : "I can only talk about your own tasks and time. Anything else and I’ll say so."}
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
