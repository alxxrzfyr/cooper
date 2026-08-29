import { useCallback, useEffect, useMemo, useState } from "react";

import "./styles.css";
import { api } from "./api";
import { CaptureBar, type CaptureFeedback } from "./components/CaptureBar";
import { Sidebar, type SystemStatus, type ViewName } from "./components/Sidebar";
import { BacklogView } from "./views/BacklogView";
import { ActivityPreview, WindowsPreview } from "./views/Previews";
import { StateGallery } from "./views/StateGallery";
import { TodayView } from "./views/TodayView";
import { ApiError, type Plan, type RankedTask } from "./types";

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
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<CaptureFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const today = todayIso();

  const refresh = useCallback(async () => {
    try {
      const [nextPlan, status] = await Promise.all([api.today(8), api.providerStatus()]);
      setPlan(nextPlan);
      setDegraded(status.degraded);
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
          setFeedback({
            kind: "question",
            message: error.message,
            candidates: error.candidates,
          });
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

  const status: SystemStatus = useMemo(
    () => ({
      ai: connectionError
        ? { label: "Unknown", tone: "bad" as const }
        : degraded === null
          ? { label: "Checking", tone: "warn" as const }
          : degraded
            ? { label: "Offline parser", tone: "warn" as const }
            : { label: "Normal", tone: "ok" as const },
      calendar: { label: "Phase 3", tone: "warn" as const },
      credentials: { label: "Not connected", tone: "warn" as const },
    }),
    [connectionError, degraded],
  );

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
                  No model is configured, so capture uses the rule-based parser. Ranking is
                  unaffected because it never needed a model.
                </div>
              </div>
            </div>
          </div>
        )}

        {view === "today" && (
          <TodayView
            plan={activePlan}
            today={today}
            onComplete={onComplete}
            onTogglePin={onTogglePin}
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
        {view === "windows" && <WindowsPreview />}
        {view === "activity" && <ActivityPreview />}
        {view === "states" && <StateGallery />}
      </main>
    </div>
  );
}
