import { useCallback, useEffect, useState } from "react";

import { api } from "../api";
import { MASCOTS } from "../assets";
import { Mascot } from "../components/Mascot";
import type { Activity, Batch } from "../types";

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The activity feed.
 *
 * With autonomy set to full, this is the only place the user's oversight can live, so it favours
 * legibility over completeness: every row says what changed in plain words, and every batch can
 * be reversed as a unit.
 */
export function ActivityView({ onChanged }: { onChanged: () => void }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setActivity(await api.activity(40));
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load activity");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function undo(batchId: string) {
    setBusy(batchId);
    try {
      await api.undoBatch(batchId);
      await refresh();
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not undo");
    } finally {
      setBusy(null);
    }
  }

  const digest = activity?.digest;
  const batches = activity?.batches ?? [];

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Activity</h1>
          <p className="view__subtitle">
            Every change, grouped into batches you can reverse as a unit.
          </p>
        </div>
      </header>

      {error && (
        <div className="banner banner--bad" role="alert">
          <div className="banner__text">
            <span className="banner__title">Problem</span>
            <div>{error}</div>
          </div>
        </div>
      )}

      {digest && (
        <section className="section" aria-labelledby="digest-label">
          <span className="section__label" id="digest-label">
            Today&rsquo;s digest
            <span className="table__meta">What happened while you were not looking.</span>
          </span>
          <div className="card digest">
            <Mascot asset={MASCOTS.activitySummary} className="digest__art" decorative />
            <div className="digest__stats">
              <Stat value={digest.blocks_scheduled} caption="blocks scheduled" />
              <Stat value={digest.blocks_released} caption="blocks released" />
              <Stat value={digest.ai_batches} caption="AI actions" />
              <Stat value={digest.user_batches} caption="your actions" />
              <Stat value={digest.tasks_touched} caption="tasks touched" />
            </div>
          </div>
        </section>
      )}

      <section className="section" aria-labelledby="history-label">
        <span className="section__label" id="history-label">
          History
        </span>

        {batches.length === 0 ? (
          <div className="card empty">
            <Mascot asset={MASCOTS.activityHistory} className="empty__art" />
            <div className="empty__body">
              <h2 className="empty__title">Nothing has happened yet</h2>
              <p className="empty__text">
                Capture a task or schedule your shortlist, and every change will appear here with
                an undo beside it.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {batches.map((batch) => (
              <BatchCard
                key={batch.batch_id}
                batch={batch}
                busy={busy === batch.batch_id}
                onUndo={() => void undo(batch.batch_id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ value, caption }: { value: number; caption: string }) {
  return (
    <div className="digest__stat">
      <span className="digest__number">{value}</span>
      <span className="digest__caption">{caption}</span>
    </div>
  );
}

function BatchCard({
  batch,
  busy,
  onUndo,
}: {
  batch: Batch;
  busy: boolean;
  onUndo: () => void;
}) {
  return (
    <article className="card batch">
      <div className="batch__head">
        <span className="batch__time">
          {day(batch.ts)} {time(batch.ts)}
        </span>
        <span className={`badge ${batch.actor === "ai" ? "badge--ai" : ""}`}>
          {batch.actor === "ai" ? "AI scheduler" : "You"}
        </span>
        <span className="table__meta">
          {batch.intent_kind} · {batch.size} change{batch.size === 1 ? "" : "s"}
        </span>
        <span style={{ marginLeft: "auto" }}>
          {batch.undone ? (
            <span className="pill">undone</span>
          ) : (
            <button type="button" className="button" disabled={busy} onClick={onUndo}>
              Undo batch
            </button>
          )}
        </span>
      </div>
      <ul className="batch__list">
        {batch.mutations.map((mutation) => (
          <li className="batch__row" key={mutation.id}>
            <span className="batch__op">{mutation.op}</span>
            <span style={{ textDecoration: mutation.undone ? "line-through" : undefined }}>
              {mutation.label}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
