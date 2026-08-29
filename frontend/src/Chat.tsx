import { useEffect, useRef } from "react";

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

function time(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
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

  return (
    <div className="chat" role="log" aria-label="Conversation" aria-live="polite">
      {turns.map((turn) =>
        turn.who === "you" ? (
          <div className="turn turn--you" key={turn.id}>
            <div className="bubble bubble--you">{turn.text}</div>
            <span className="turn__time">{time(turn.at)}</span>
          </div>
        ) : (
          <div className="turn turn--otter" key={turn.id}>
            <Mascot name={face(turn.kind)} size="sm" decorative />
            <div className="turn__stack">
              <div className={`bubble ${turn.kind === "note" ? "bubble--warn" : ""}`}>
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
            </div>
          </div>
        ),
      )}

      {thinking && (
        <div className="turn turn--otter">
          <Mascot name="task_active" size="sm" decorative />
          <div className="bubble bubble--thinking" aria-label="Thinking">
            <span />
            <span />
            <span />
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
