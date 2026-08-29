import { useEffect, useRef, useState } from "react";

import type { CaptureResult } from "../types";

/**
 * The persistent capture bar and its parsed chip.
 *
 * There is no confirmation dialog here by design. The chip is the correction path: it shows
 * what the system understood, and offers edit and undo inline so a wrong parse costs one
 * click rather than a modal on every capture.
 */

export interface CaptureFeedback {
  kind: "parsed" | "question" | "error" | "undone";
  result?: CaptureResult;
  message?: string;
  candidates?: string[];
}

export function CaptureBar({
  onSubmit,
  onUndo,
  onRename,
  feedback,
  busy,
}: {
  onSubmit: (utterance: string) => void;
  onUndo: (mutationId: string) => void;
  onRename: (taskId: string, title: string) => void;
  feedback: CaptureFeedback | null;
  busy: boolean;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const utterance = value.trim();
    if (!utterance || busy) {
      return;
    }
    onSubmit(utterance);
    setValue("");
  }

  return (
    <div className="capture">
      <form onSubmit={submit}>
        <div className="capture__field">
          <label className="visually-hidden" htmlFor="capture-input">
            Capture a task or event
          </label>
          <input
            id="capture-input"
            ref={inputRef}
            className="capture__input"
            placeholder="Capture a task or event…"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            enterKeyHint="done"
          />
          <span className="kbd" aria-hidden="true">
            ⌘K
          </span>
        </div>
      </form>

      <div aria-live="polite" role="status" aria-label="Capture result">
        {feedback && (
          <Feedback feedback={feedback} onUndo={onUndo} onRename={onRename} busy={busy} />
        )}
      </div>
    </div>
  );
}

function Feedback({
  feedback,
  onUndo,
  onRename,
  busy,
}: {
  feedback: CaptureFeedback;
  onUndo: (mutationId: string) => void;
  onRename: (taskId: string, title: string) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (feedback.kind === "question") {
    return (
      <div className="chip chip--question">
        <div className="chip__body">
          <span className="chip__kind">Which one?</span>
          <span className="chip__sep">·</span>
          <span>{feedback.message}</span>
          {feedback.candidates?.map((candidate) => (
            <span className="pill" key={candidate}>
              {candidate}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (feedback.kind === "error") {
    return (
      <div className="chip chip--error">
        <div className="chip__body">
          <span className="chip__kind">Not applied</span>
          <span className="chip__sep">·</span>
          <span>{feedback.message}</span>
        </div>
      </div>
    );
  }

  if (feedback.kind === "undone") {
    return (
      <div className="chip">
        <div className="chip__body">
          <span className="chip__kind">Undone</span>
          <span className="chip__sep">·</span>
          <span>{feedback.message}</span>
        </div>
      </div>
    );
  }

  const result = feedback.result;
  const chip = result?.chip;
  if (!chip) {
    return null;
  }

  const task = result?.task ?? null;

  return (
    <div className="chip">
      <div className="chip__body">
        <span className="chip__kind">{readableKind(chip.kind)}</span>
        {chip.fields.map((field) => (
          <span key={`${field.label}-${field.value}`}>
            <span className="chip__sep">·</span> {field.value}
          </span>
        ))}
      </div>

      {editing && task ? (
        <span className="chip__edit">
          <label className="visually-hidden" htmlFor="chip-title">
            Corrected title
          </label>
          <input
            id="chip-title"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="button"
            className="button"
            disabled={busy || !draft.trim()}
            onClick={() => {
              onRename(task.id, draft.trim());
              setEditing(false);
            }}
          >
            Save
          </button>
          <button type="button" className="chip__action" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <>
          {task && (
            <button
              type="button"
              className="chip__action"
              onClick={() => {
                setDraft(task.title);
                setEditing(true);
              }}
            >
              edit
            </button>
          )}
          {result?.mutation_id && (
            <button
              type="button"
              className="chip__action"
              disabled={busy}
              onClick={() => onUndo(result.mutation_id as string)}
            >
              undo
            </button>
          )}
        </>
      )}
    </div>
  );
}

function readableKind(kind: string): string {
  switch (kind) {
    case "CreateTask":
      return "Task";
    case "CreateEvent":
      return "Event";
    case "CompleteTask":
      return "Completed";
    case "DropTask":
      return "Dropped";
    case "PinTask":
      return "Pinned";
    case "UpdateTask":
      return "Updated";
    case "Undo":
      return "Restored";
    default:
      return kind;
  }
}
