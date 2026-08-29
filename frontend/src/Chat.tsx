import { Fragment, useEffect, useRef } from "react";

import { Mascot } from "./Mascot";
import type { Item, ReplyKind } from "./types";

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

const STORE_KEY = "cadence.chat.v1";
const KEEP = 60;

/** Quiet longer than this earns a timestamp above the next group. */
const STAMP_AFTER_MS = 15 * 60_000;
/** Turns from the same side closer together than this share one group. */
const GROUP_WITHIN_MS = 5 * 60_000;

/** Which face the otter wears for a given reply. */
function face(kind: ReplyKind | undefined): string {
  switch (kind) {
    case "question":
      return "parse_ambiguity_state";
    case "note":
      return "degraded_mode_state";
    case "scheduled":
      return "empty_state_windows";
    case "undone":
      return "activity_history";
    case "shown":
      return "activity_summary";
    default:
      return "task_active";
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

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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
  const day = then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
    else groups.push({ who: turn.who, turns: [turn], stamp: paused ? stamp(turn.at) : null });

    previousAt = turn.at;
  }

  return groups;
}

/**
 * The conversation.
 *
 * This is the point of the app: you talk to it. The list of tasks is a consequence, not the
 * interface. Your words on the right, the otter's on the left, and when it changes something the
 * reply carries a small card showing exactly what it understood so a wrong parse is obvious.
 */
export function Chat({
  turns,
  thinking,
  onExample,
}: {
  turns: Turn[];
  thinking: boolean;
  onExample: (text: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Guarded because jsdom has no scrollIntoView, and an older browser may not either. Failing
    // to auto-scroll is a cosmetic loss; throwing here would take the whole view down.
    end.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [turns.length, thinking]);

  if (turns.length === 0) {
    return (
      <div className="chat">
        <Opening onExample={onExample} />
        <div ref={end} />
      </div>
    );
  }

  const groups = groupTurns(turns);

  return (
    <div className="chat" role="log" aria-label="Conversation" aria-live="polite">
      {groups.map((group, index) => {
        const last = group.turns[group.turns.length - 1];
        const closing = index === groups.length - 1 && !thinking;

        return (
          <Fragment key={group.turns[0].id}>
            {group.stamp && <div className="stamp">{group.stamp}</div>}

            <div className={`run run--${group.who}`}>
              {group.who === "otter" && <Mascot name={face(last.kind)} size="sm" decorative />}

              <div className="run__stack">
                {group.turns.map((turn) => {
                  const attached = Boolean(turn.item || turn.lines?.length);
                  const tail = turn.id === last.id && !attached;

                  return (
                    <Fragment key={turn.id}>
                      <div
                        className={[
                          "bubble",
                          group.who === "you" ? "bubble--you" : "bubble--them",
                          turn.kind === "note" ? "bubble--warn" : "",
                          tail ? "bubble--tail" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        {turn.text}
                      </div>

                      {turn.item && <Understood item={turn.item} />}

                      {turn.lines && turn.lines.length > 0 && (
                        <ul className="slots">
                          {turn.lines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </Fragment>
                  );
                })}

                {group.who === "you" && closing && <span className="receipt">Delivered</span>}
              </div>
            </div>
          </Fragment>
        );
      })}

      {thinking && (
        <div className="run run--otter">
          <Mascot name="task_active" size="sm" decorative />
          <div className="run__stack">
            <div className="bubble bubble--them bubble--tail bubble--thinking" aria-label="Thinking">
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      )}

      <div ref={end} />
    </div>
  );
}

/** The compact card showing what the otter understood. Makes a wrong parse obvious at a glance. */
function Understood({ item }: { item: Item }) {
  const bits = [
    item.kind === "event" ? "Event" : "Task",
    item.minutes ? `${item.minutes} min` : null,
    item.due ? `due ${new Date(item.due).toLocaleDateString(undefined, { weekday: "short" })}` : null,
    item.start_at
      ? new Date(item.start_at).toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })
      : null,
    item.importance !== 3 ? `importance ${item.importance}` : null,
  ].filter(Boolean);

  return (
    <div className="understood">
      <span className="understood__title">{item.title}</span>
      <span className="understood__bits">{bits.join(" · ")}</span>
    </div>
  );
}

const EXAMPLES = [
  "write the quarterly report, 90m, important, due friday",
  "dentist thursday 3pm",
  "what should I do first",
  "plan my day",
];

function Opening({ onExample }: { onExample: (text: string) => void }) {
  return (
    <div className="opening">
      <Mascot name="first_run_state" size="lg" shape="squircle" decorative />
      <h2 className="opening__title">Just tell me what&rsquo;s on your plate</h2>
      <p className="opening__text">
        Write it the way you&rsquo;d say it out loud. I&rsquo;ll work out the task, the time, and
        what deserves doing first — then put it in your calendar.
      </p>
      <div className="examples">
        {EXAMPLES.map((example) => (
          <button key={example} type="button" className="example" onClick={() => onExample(example)}>
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}
