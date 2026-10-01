import { useState } from "react";

import type { RecoveryPreview } from "./types";

const UNPLACED: Record<string, string> = {
  overdue: "overdue",
  unknown_estimate: "needs an estimate",
  no_feasible_slot: "no free time in the next 7 days",
};

function when(at: string, timeZone: string): string {
  return new Date(at).toLocaleString(undefined, {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Review-then-apply for missed blocks. A reply-style panel, never a modal. */
export function RecoveryPanel({
  timeZone,
  busy,
  onPreview,
  onApply,
}: {
  timeZone: string;
  busy: boolean;
  onPreview: () => Promise<RecoveryPreview | null>;
  onApply: (fingerprint: string) => Promise<boolean>;
}) {
  const [preview, setPreview] = useState<RecoveryPreview | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    setPreview(await onPreview());
    setNote(null);
    setLoading(false);
  }

  async function apply(fingerprint: string) {
    setLoading(true);
    if (await onApply(fingerprint)) {
      setPreview(null);
      setNote(null);
    } else {
      setPreview(await onPreview());
      setNote("Your plan changed. Here’s the updated preview.");
    }
    setLoading(false);
  }

  if (!preview) {
    return (
      <button
        type="button"
        className="btn btn--quiet"
        disabled={busy || loading}
        onClick={() => void open()}
      >
        Review recovery
      </button>
    );
  }

  const canApply = preview.complete && preview.moves.length > 0;
  return (
    <section className="home-recovery" aria-label="Recovery preview">
      {note && <p className="home-recovery__note">{note}</p>}
      {!preview.complete && (
        <p className="home-recovery__note">
          A connected calendar couldn’t be checked, so nothing will move.
        </p>
      )}
      {preview.complete && preview.moves.length === 0 && (
        <p className="home-recovery__note">Nothing can be moved right now.</p>
      )}
      <ul className="home-recovery__list">
        {preview.moves.map((move) => (
          <li key={move.item_id}>
            <strong>{move.title}</strong>: {when(move.old_start, timeZone)} →{" "}
            {when(move.start, timeZone)}
          </li>
        ))}
        {preview.kept.map((row) => (
          <li key={row.item_id}>
            <strong>{row.title}</strong> stays (pinned)
          </li>
        ))}
        {preview.unplaced.map((row) => (
          <li key={row.item_id}>
            <strong>{row.title}</strong> isn’t placed: {UNPLACED[row.reason] ?? row.reason}
          </li>
        ))}
      </ul>
      <div className="home-recovery__actions">
        <button
          type="button"
          className="btn btn--accent"
          disabled={!canApply || busy || loading}
          onClick={() => void apply(preview.fingerprint)}
        >
          Apply recovery
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          disabled={loading}
          onClick={() => {
            setPreview(null);
            setNote(null);
          }}
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}
