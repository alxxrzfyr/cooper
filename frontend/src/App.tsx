import { useCallback, useEffect, useMemo, useState } from "react";

import "./styles.css";
import { api } from "./api";
import { CaptureBar, type CaptureFeedback } from "./components/CaptureBar";
import { Sidebar, type SystemStatus, type ViewName } from "./components/Sidebar";
import { ActivityView } from "./views/ActivityView";
import { BacklogView } from "./views/BacklogView";
import { StateGallery } from "./views/StateGallery";
import { TodayView } from "./views/TodayView";
import { WindowsView } from "./views/WindowsView";
import {
  ApiError,
  type AuthStatus,
  type Block,
  type FocusWindow,
  type Plan,
  type RankedTask,
} from "./types";

const EMPTY_PLAN: Plan = {
  generated_at: new Date().toISOString(),
  shortlist: [],
  backlog: [],
  blocked: [],
  degraded: false,
};

function todayIso(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function App() {
  const [view, setView] = useState<ViewName>("today");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [windows, setWindows] = useState<FocusWindow[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<CaptureFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const today = todayIso();

  const refresh = useCallback(async () => {
    try {
      const [nextPlan, status, nextWindows, nextBlocks, authStatus] = await Promise.all([
        api.today(8),
        api.providerStatus(),
        api.listWindows(),
        api.blocks(14),
        api.authStatus(),
      ]);
      setPlan(nextPlan);
      setDegraded(status.degraded);
      setWindows(nextWindows);
      setBlocks(nextBlocks.blocks);
      setAuth(authStatus);
      setConnectionError(null);
    } catch (error) {
      // Surfaced, never swallowed: an unreachable backend must not look like an empty plan.
      setConnectionError(error instanceof Error ? error.message : "Cannot reach the backend");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      try {
        await action();
        await refresh();
      } catch (error) {
        if (error instanceof ApiError && error.isAmbiguous) {
          setFeedback({ kind: "question", message: error.message, candidates: error.candidates });
        } else {
          setFeedback({
            kind: "error",
            message: error instanceof Error ? error.message : "Something went wrong",
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const onCapture = useCallback(
    (utterance: string) =>
      void run(async () => {
        const result = await api.capture(utterance);
        if (result.question) {
          setFeedback({
            kind: "question",
            message: result.question,
            candidates: result.candidates,
          });
        } else if (result.chip) {
          setFeedback({ kind: "parsed", result });
        } else {
          setFeedback(null);
        }
        setDegraded(result.degraded);
      }),
    [run],
  );

  const onUndo = useCallback(
    (mutationId: string) =>
      void run(async () => {
        const result = await api.undo(mutationId);
        setFeedback({
          kind: "undone",
          message: result.task ? `Restored “${result.task.title}”` : "Change reversed",
        });
      }),
    [run],
  );

  const onRename = useCallback(
    (taskId: string, title: string) =>
      void run(async () => {
        const task = await api.updateTask(taskId, { title });
        setFeedback({ kind: "undone", message: `Renamed to “${task.title}”` });
      }),
    [run],
  );

  const onComplete = useCallback(
    (taskId: string) => void run(async () => void (await api.completeTask(taskId))),
    [run],
  );

  const onDrop = useCallback(
    (taskId: string) => void run(async () => void (await api.dropTask(taskId))),
    [run],
  );

  const onTogglePin = useCallback(
    (entry: RankedTask) =>
      void run(async () => {
        await api.pinTask(entry.task.id, entry.is_pinned ? null : today);
      }),
    [run, today],
  );

  const onSchedule = useCallback(
    () =>
      void run(async () => {
        const applied = await api.applySchedule(8);
        const unplaced = applied.unplaced.length;
        setFeedback({
          kind: "undone",
          message:
            applied.placed.length === 0
              ? "Nothing could be placed. Check your windows and effort estimates."
              : `Scheduled ${applied.placed.length} block${applied.placed.length === 1 ? "" : "s"}` +
                ` (${applied.scheduled_minutes}m)` +
                (unplaced > 0 ? `, ${unplaced} did not fit` : ""),
        });
      }),
    [run],
  );

  const status: SystemStatus = useMemo(() => {
    const calendar = !auth?.configured
      ? { label: "Not configured", tone: "warn" as const }
      : !auth.connected
        ? { label: "Not connected", tone: "warn" as const }
        : auth.healthy
          ? { label: "Connected", tone: "ok" as const }
          : { label: "Needs attention", tone: "bad" as const };

    return {
      ai: connectionError
        ? { label: "Unknown", tone: "bad" as const }
        : degraded === null
          ? { label: "Checking", tone: "warn" as const }
          : degraded
            ? { label: "Offline parser", tone: "warn" as const }
            : { label: "Normal", tone: "ok" as const },
      calendar,
      credentials: auth?.connected
        ? auth.healthy
          ? { label: "Healthy", tone: "ok" as const }
          : { label: "Re-auth needed", tone: "bad" as const }
        : { label: "None stored", tone: "warn" as const },
    };
  }, [auth, connectionError, degraded]);

  const activePlan = plan ?? EMPTY_PLAN;

  return (
    <div className="app">
      <Sidebar current={view} onNavigate={setView} status={status} />

      <main className="main">
        <CaptureBar
          onSubmit={onCapture}
          onUndo={onUndo}
          onRename={onRename}
          feedback={feedback}
          busy={busy}
        />

        {connectionError && (
          <div className="view" style={{ paddingBottom: 0 }}>
            <div className="banner banner--bad" role="alert">
              <div className="banner__text">
                <span className="banner__title">Backend unreachable</span>
                <div>
                  {connectionError}. Start it with{" "}
                  <code>uv run uvicorn cadence.main:app --host 127.0.0.1</code> and confirm{" "}
                  <code>VITE_CADENCE_SHARED_SECRET</code> matches your <code>.env</code>.
                </div>
              </div>
              <button type="button" className="button" onClick={() => void refresh()}>
                Retry
              </button>
            </div>
          </div>
        )}

        {degraded && !connectionError && (
          <div className="view" style={{ paddingBottom: 0 }}>
            <div className="banner">
              <div className="banner__text">
                <span className="banner__title">Offline parsing</span>
                <div>
                  No model is configured, so capture uses the rule-based parser. Ranking and
                  scheduling are unaffected because neither needed a model.
                </div>
              </div>
            </div>
          </div>
        )}

        {auth?.connected === false && auth.configured && !connectionError && (
          <div className="view" style={{ paddingBottom: 0 }}>
            <div className="banner">
              <div className="banner__text">
                <span className="banner__title">Calendar not connected</span>
                <div>{auth.hint ?? "Connect Google Calendar to project blocks into it."}</div>
              </div>
              <button
                type="button"
                className="button"
                onClick={() =>
                  void api.authStart().then((start) => {
                    window.location.href = start.authorization_url;
                  })
                }
              >
                Connect
              </button>
            </div>
          </div>
        )}

        {auth?.connected && !auth.healthy && auth.hint && !connectionError && (
          <div className="view" style={{ paddingBottom: 0 }}>
            <div className="banner banner--bad" role="alert">
              <div className="banner__text">
                <span className="banner__title">Calendar needs attention</span>
                <div>{auth.hint}</div>
              </div>
            </div>
          </div>
        )}

        {view === "today" && (
          <TodayView
            plan={activePlan}
            today={today}
            windows={windows}
            blocks={blocks}
            onComplete={onComplete}
            onTogglePin={onTogglePin}
            onSchedule={onSchedule}
            busy={busy}
          />
        )}
        {view === "backlog" && (
          <BacklogView
            entries={activePlan.backlog}
            blocked={activePlan.blocked}
            today={today}
            onComplete={onComplete}
            onDrop={onDrop}
            busy={busy}
          />
        )}
        {view === "windows" && <WindowsView onChanged={() => void refresh()} />}
        {view === "activity" && <ActivityView onChanged={() => void refresh()} />}
        {view === "states" && <StateGallery />}
      </main>
    </div>
  );
}
