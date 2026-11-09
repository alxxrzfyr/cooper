import { useCallback, useEffect, useRef, useState } from "react";

import "./theme.css";
import { applyAppearance, type Appearance, readAppearance, saveAppearance } from "./appearance";
import { api } from "./api";
import { Calendar } from "./Calendar";
import {
  Chat,
  loadMode,
  loadTurns,
  saveMode,
  saveTurns,
  type AgentStep,
  type Mode,
  type Turn,
} from "./Chat";
import {
  firebaseConfigError,
  firebaseConfigured,
  auth,
  registerWithEmail,
  refreshCurrentUser,
  resendVerificationEmail,
  resetPassword,
  signInWithEmail,
  signInWithGoogle,
  signOutUser,
  subscribeToAuth,
  type FirebaseUser,
} from "./firebase";
import { Home } from "./Home";
import { Form } from "./Form";
import { PublicRoutes, readPublicRoute } from "./landing/PublicRoutes";
import { Mascot, type MascotName } from "./Mascot";
import { Nav, type Tab } from "./Nav";
import {
  finishOnboarding,
  Onboarding,
  type OnboardingProgress,
  onboardingDone,
} from "./Onboarding";
import { Row } from "./Row";
import { Settings, type BrowserPermission } from "./Settings";
import { CalendarEventFrame, TaskFrame } from "./Frame";
import {
  ApiError,
  type AskIntent,
  type Item,
  type CalendarEvent,
  type NewItem,
  type Ranked,
  type Reply,
  type ReplyKind,
  type View,
} from "./types";

const PUBLIC_AUTH_PATHS = new Set(["/", "/landing", "/login", "/signup"]);

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function purgeLegacyModelKeys(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key === "cooper.gemini_key.v1" || key?.startsWith("cooper.gemini_key.v1:")) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // A blocked store must not prevent local planning.
  }
}

interface PendingSubmission {
  text: string;
  intent?: AskIntent;
  logicalRequestId: string;
  message: string;
  persisted: boolean;
}

function pendingStorageKey(owner: string): string {
  return `cooper.ai.pending.v1:${owner}`;
}

function restorePendingSubmission(owner: string): PendingSubmission | null {
  try {
    const raw = sessionStorage.getItem(pendingStorageKey(owner));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("text" in value) ||
      typeof value.text !== "string" ||
      !value.text.trim() ||
      !("logicalRequestId" in value) ||
      typeof value.logicalRequestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value.logicalRequestId,
      )
    )
      return null;
    const intents: AskIntent[] = [
      "focus_week",
      "remaining_today",
      "work_next",
      "fit_duration",
      "deadline_summary",
      "overload_check",
    ];
    const intent =
      "intent" in value ? intents.find((candidate) => candidate === value.intent) : undefined;
    if ("intent" in value && value.intent !== undefined && !intent) return null;
    return {
      text: value.text,
      intent,
      logicalRequestId: value.logicalRequestId,
      message: "Cooper has not confirmed this request yet.",
      persisted: true,
    };
  } catch {
    return null;
  }
}

function persistPendingSubmission(
  owner: string,
  request: Pick<PendingSubmission, "text" | "intent" | "logicalRequestId">,
): boolean {
  try {
    sessionStorage.setItem(pendingStorageKey(owner), JSON.stringify(request));
    return true;
  } catch {
    // Retry remains available in memory; reload recovery depends on browser storage.
    return false;
  }
}

function clearPendingSubmission(owner: string): void {
  try {
    sessionStorage.removeItem(pendingStorageKey(owner));
  } catch {
    // A later reload may safely replay the completed request using its original ID.
  }
}

function googleEventKey(event: CalendarEvent): string {
  return `${event.event_id ?? `${event.start_at}-${event.end_at}`}|${event.title}`;
}

function googleEventMessage(event: CalendarEvent, timeZone: string): string {
  const when = event.all_day
    ? "all day"
    : new Date(event.start_at).toLocaleString(undefined, {
        timeZone: event.time_zone ?? timeZone,
        dateStyle: "medium",
        timeStyle: "short",
      });
  return `Google Calendar: ${event.title} · ${when}`;
}

/** The three local phases are always truthful: none claims an external integration ran. */
function initialAgentSteps(): AgentStep[] {
  return [
    {
      id: "understand",
      title: "Understanding your request",
      source: "Cooper",
      icon: "spark",
      status: "running",
    },
    {
      id: "check",
      title: "Checking your plan",
      source: "Tasks",
      icon: "search",
      status: "pending",
    },
    {
      id: "answer",
      title: "Preparing your response",
      source: "Cooper",
      icon: "write",
      status: "pending",
    },
  ];
}

function id(): string {
  return Math.random().toString(36).slice(2, 10);
}

function browserPermission(): BrowserPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return window.Notification.permission;
}

function noticeTone(kind: ReplyKind): "good" | "bad" | "answer" | "attention" | "plain" {
  switch (kind) {
    case "added":
    case "completed":
    case "pinned":
    case "rescheduled":
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

function noticeFace(kind: ReplyKind): MascotName {
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
    default:
      return "cooper_done";
  }
}

interface Notice {
  kind: ReplyKind;
  message: string;
}

type AuthState =
  | { kind: "local" }
  | { kind: "config-error"; message: string }
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "verification-pending"; user: FirebaseUser }
  | { kind: "signed-in"; user: FirebaseUser };

function firebaseAuthMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Firebase is not configured")) {
    return "Email and password are ready to use, but this local app needs Firebase configuration to finish sign-in.";
  }
  if (code.includes("email-already-in-use")) {
    return "That email already has an account. Try logging in.";
  }
  if (
    code.includes("invalid-credential") ||
    code.includes("wrong-password") ||
    code.includes("user-not-found")
  ) {
    return "Email or password did not match.";
  }
  if (code.includes("weak-password")) return "Use at least 6 characters for the password.";
  if (code.includes("invalid-email")) return "That does not look like an email address.";
  if (code.includes("too-many-requests")) return "Too many attempts. Wait a moment and try again.";
  if (code.includes("operation-not-allowed")) {
    return "Email sign-in is not enabled for this deployment. Ask the Cooper maintainer to enable it in Firebase.";
  }
  if (code.includes("network-request-failed")) {
    return "Cooper could not reach Firebase. Check your connection and try again.";
  }
  return "Cooper could not start that account action. Check the details and try again.";
}

function AuthSetupErrorSurface({ message }: { message: string }) {
  return (
    <div className="scroll auth-screen" role="alert">
      <Mascot name="cooper_tired" size="lg" decorative />
      <h1 className="largetitle">Check Firebase setup</h1>
      <p className="empty__text">{message}</p>
    </div>
  );
}

const LOADING_LABEL: Record<Exclude<Tab, "chat">, string> = {
  home: "Loading Cooper’s day",
  calendar: "Loading Cooper’s calendar",
  settings: "Loading Cooper’s settings",
};

/** Content-shaped placeholders for the data-backed screens while the shared view loads. */
function LoadingSurface({ tab }: { tab: Exclude<Tab, "chat"> }) {
  return (
    <div
      className={`scroll skeleton-screen skeleton-screen--${tab}`}
      role="status"
      aria-label={LOADING_LABEL[tab]}
      aria-busy="true"
    >
      <div className="skeleton-screen__status">
        <span className="loading-spinner" aria-hidden="true" />
        <span>{LOADING_LABEL[tab]}…</span>
      </div>
      <div className="skeleton-screen__heading" aria-hidden="true">
        <span className="skeleton skeleton--title" />
        <span className="skeleton skeleton--subtitle" />
      </div>

      {tab === "calendar" ? (
        <div className="skeleton-screen__calendar" aria-hidden="true">
          <span className="skeleton skeleton--toolbar" />
          <div className="skeleton-screen__calendar-grid">
            {Array.from({ length: 14 }, (_, index) => (
              <span className="skeleton skeleton--calendar-cell" key={index} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {tab === "home" && (
            <div className="skeleton-screen__hero" aria-hidden="true">
              <span className="skeleton skeleton--avatar" />
              <div className="skeleton-screen__copy">
                <span className="skeleton skeleton--eyebrow" />
                <span className="skeleton skeleton--hero-title" />
                <span className="skeleton skeleton--meta" />
              </div>
              <span className="skeleton skeleton--button" />
            </div>
          )}
          <div className="skeleton-screen__sections" aria-hidden="true">
            {Array.from({ length: tab === "settings" ? 4 : 3 }, (_, section) => (
              <div className="skeleton-screen__section" key={section}>
                <span className="skeleton skeleton--label" />
                <div className="skeleton-screen__rows">
                  {Array.from({ length: tab === "settings" ? 2 : 3 }, (_, row) => (
                    <div className="skeleton-screen__row" key={row}>
                      <span className="skeleton skeleton--dot" />
                      <span className="skeleton skeleton--row-title" />
                      <span className="skeleton skeleton--row-meta" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>(
    firebaseConfigError
      ? { kind: "config-error", message: firebaseConfigError }
      : firebaseConfigured
        ? { kind: "loading" }
        : { kind: "local" },
  );
  const [tab, setTab] = useState<Tab>("home");
  const [view, setView] = useState<View | null>(null);
  const [loadResolved, setLoadResolved] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [text, setText] = useState("");
  /** Auth form actions only — never blocks the workspace or Cooper replies. */
  const [authBusy, setAuthBusy] = useState(false);
  /** Dashboard/settings mutations — independent of the conversation request. */
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  /** In-flight /api/say — owns the thinking UI and composer lock. */
  const [chatPending, setChatPending] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [hasAsked, setHasAsked] = useState(false);
  const [retrySubmission, setRetrySubmission] = useState<PendingSubmission | null>(() =>
    firebaseConfigured ? null : restorePendingSubmission("local"),
  );
  useEffect(purgeLegacyModelKeys, []);
  const [icloudEmail, setIcloudEmail] = useState("");
  const [icloudPassword, setIcloudPassword] = useState("");
  const [mode, setMode] = useState<Mode>(loadMode);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [browserAlerts, setBrowserAlerts] = useState<BrowserPermission>(browserPermission);
  const [guideVisible, setGuideVisible] = useState(false);
  const [guideSessionDismissed, setGuideSessionDismissed] = useState(false);
  const [hasCreatedItem, setHasCreatedItem] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const agentPhaseTimers = useRef<number[]>([]);
  const observedGoogleEvents = useRef<Set<string> | null>(null);
  const firebaseSubject = useRef<string | null>(null);
  const authEpoch = useRef(0);
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );
  const pathnameRef = useRef(pathname);
  /** The one task a frame is open on, if any. Plan and Calendar share the component. */
  const [detail, setDetail] = useState<Item | Ranked | CalendarEvent | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canUseAi = view?.ai?.status === "ready";
  const canCompose = authState.kind === "local" || authState.kind === "signed-in";
  const canAsk = canCompose;
  const signedInUser =
    authState.kind === "signed-in" || authState.kind === "verification-pending"
      ? authState.user
      : null;
  const canLoadProtectedData = authState.kind === "local" || authState.kind === "signed-in";
  const publicRoute = readPublicRoute(pathname);
  const normalizedPathname = normalizePathname(pathname);
  const isWorkspacePath = normalizedPathname === "/app";
  const authPending = firebaseConfigured && authState.kind === "loading";
  // /app while auth is unresolved uses the workspace skeleton. Public pages keep their own
  // content and only disable auth controls — never a global account-check takeover.
  const showPublicRoutes =
    !isWorkspacePath || (firebaseConfigured && !authPending && authState.kind !== "signed-in");
  const publicLandingSurface = showPublicRoutes && publicRoute === "landing";
  const workspaceVisible = canLoadProtectedData && isWorkspacePath;

  const navigate = useCallback((nextPath: string) => {
    const next = normalizePathname(nextPath);
    if (typeof window !== "undefined" && window.location.pathname !== next) {
      window.history.replaceState({}, "", next);
    }
    pathnameRef.current = next;
    setPathname(next);
  }, []);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const onPopState = () => {
      const next = normalizePathname(window.location.pathname);
      pathnameRef.current = next;
      setPathname(next);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const clearConversation = useCallback(() => {
    setTurns([]);
    saveTurns([]);
  }, []);

  const resetRequestUi = useCallback(() => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = null;
    agentPhaseTimers.current.forEach((timer) => window.clearTimeout(timer));
    agentPhaseTimers.current = [];
    setAgentSteps(null);
    setChatPending(false);
    setRetrySubmission(null);
    setText("");
    setNotice(null);
    setFailure(null);
    setHasAsked(false);
  }, []);

  useEffect(
    () => () => {
      authEpoch.current += 1;
      agentPhaseTimers.current.forEach((timer) => window.clearTimeout(timer));
      agentPhaseTimers.current = [];
    },
    [],
  );

  useEffect(() => {
    if (firebaseConfigError) {
      setAuthState({ kind: "config-error", message: firebaseConfigError });
      return;
    }
    if (!firebaseConfigured) return;
    return subscribeToAuth((user) => {
      const currentPath = normalizePathname(pathnameRef.current);
      const verified = user ? user.emailVerified !== false : false;
      if (user && verified && PUBLIC_AUTH_PATHS.has(currentPath)) navigate("/app");
      if (user && !verified && currentPath !== "/login") navigate("/login");
      if ((!user || !verified) && currentPath === "/app") navigate("/login");
      const nextSubject = user && verified ? user.uid : null;
      if (firebaseSubject.current !== nextSubject) {
        firebaseSubject.current = nextSubject;
        authEpoch.current += 1;
        clearConversation();
        resetRequestUi();
        if (nextSubject)
          setRetrySubmission(
            restorePendingSubmission(`firebase:${encodeURIComponent(nextSubject)}`),
          );
        setGuideVisible(false);
        setGuideSessionDismissed(false);
        setHasCreatedItem(false);
      }
      setAuthState(
        !user
          ? { kind: "signed-out" }
          : verified
            ? { kind: "signed-in", user }
            : { kind: "verification-pending", user },
      );
      setView(null);
      setLoadResolved(!user || !verified);
    });
  }, [clearConversation, navigate, resetRequestUi]);

  const signOutOfFirebase = useCallback(() => {
    if (!firebaseConfigured) return;
    authEpoch.current += 1;
    firebaseSubject.current = null;
    clearConversation();
    resetRequestUi();
    setView(null);
    setAuthState({ kind: "signed-out" });
    setLoadResolved(true);
    if (normalizePathname(pathnameRef.current) === "/app") {
      navigate("/login");
    }
    void signOutUser();
  }, [clearConversation, navigate, resetRequestUi]);

  const returnToSignIn = useCallback(() => {
    if (!firebaseConfigured) return false;
    setFailure(null);
    signOutOfFirebase();
    return true;
  }, [signOutOfFirebase]);

  const handleApiAuthFailure = useCallback(
    (error: unknown): boolean => {
      if (!(error instanceof ApiError)) return false;
      if (error.status === 401) return returnToSignIn();
      return false;
    },
    [returnToSignIn],
  );

  const startSignIn = useCallback(() => {
    setFailure(null);
    setAuthBusy(true);
    void signInWithGoogle()
      .catch((error: unknown) => {
        setFailure(firebaseAuthMessage(error));
      })
      .finally(() => setAuthBusy(false));
  }, []);

  const startEmailAuth = useCallback(
    async (email: string, password: string, intent: "login" | "signup") => {
      setFailure(null);
      setAuthBusy(true);
      try {
        if (intent === "login") await signInWithEmail(email, password);
        else await registerWithEmail(email, password);
      } catch (error: unknown) {
        setFailure(firebaseAuthMessage(error));
      } finally {
        setAuthBusy(false);
      }
    },
    [],
  );

  const checkVerification = useCallback(async () => {
    setFailure(null);
    setAuthBusy(true);
    try {
      const user = await refreshCurrentUser();
      if (!user || user.emailVerified === false) {
        setFailure(
          "Your email is not verified yet. Open the latest email from Cooper and try again.",
        );
        return;
      }
      setAuthState({ kind: "signed-in", user });
      navigate("/app");
    } catch (error: unknown) {
      setFailure(firebaseAuthMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }, [navigate]);

  const resendVerification = useCallback(async () => {
    setFailure(null);
    setAuthBusy(true);
    try {
      if (!auth?.currentUser) throw new Error("No account is signed in.");
      await resendVerificationEmail(auth.currentUser);
      setFailure("Verification email sent. Check your inbox and spam folder.");
    } catch (error: unknown) {
      setFailure(firebaseAuthMessage(error));
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    setFailure(null);
    setAuthBusy(true);
    try {
      await resetPassword(email.trim());
    } catch (error: unknown) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code.includes("user-not-found")) return;
      const message = error instanceof Error ? error.message : "";
      setFailure(
        message.includes("Firebase is not configured")
          ? "Password reset needs Firebase configuration in this local app."
          : firebaseAuthMessage(error),
      );
      throw error;
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const announce = useCallback(
    (kind: ReplyKind, message: string, showToast = true) => {
      if (showToast && (tab !== "chat" || mode === "manual")) {
        setNotice({ kind, message });
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => {
          setNotice(null);
          noticeTimer.current = null;
        }, 5200);
      }

      if (
        document.visibilityState === "hidden" &&
        browserAlerts === "granted" &&
        "Notification" in window
      ) {
        new window.Notification(message, {
          icon: `/assets/mascot/${noticeFace(kind)}.webp`,
          tag: "cooper-update",
        });
      }
    },
    [browserAlerts, mode, tab],
  );

  const announceNewGoogleEvents = useCallback(
    (nextView: View) => {
      const current = nextView.events.filter((event) => !event.mine).map(googleEventKey);
      const observed = observedGoogleEvents.current;
      observedGoogleEvents.current = new Set(current);
      if (!observed) return;

      nextView.events
        .filter((event) => !event.mine && !observed.has(googleEventKey(event)))
        .slice(0, 3)
        .forEach((event) => announce("shown", googleEventMessage(event, nextView.timezone)));
    },
    [announce],
  );

  const enableBrowserAlerts = useCallback(async () => {
    if (!("Notification" in window)) {
      announce("note", "This browser does not support notifications.");
      return;
    }
    const permission = await window.Notification.requestPermission();
    setBrowserAlerts(permission);
    announce(
      permission === "granted" ? "added" : "note",
      permission === "granted"
        ? "Browser notifications are on."
        : "Browser notifications stay off until you allow them.",
    );
  }, [announce]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  /** Applied from state, so the page and the picker can never disagree. Re-applied on navigation
   *  too: replaceState doesn't reload the page, so leaving /app has to re-decide the theme. */
  useEffect(() => applyAppearance(appearance, pathname), [appearance, pathname]);

  function chooseAppearance(choice: Appearance): void {
    setAppearance(choice);
    saveAppearance(choice);
  }

  useEffect(() => saveTurns(turns), [turns]);

  const load = useCallback(async () => {
    if (!workspaceVisible) return;
    const requestEpoch = authEpoch.current;
    setLoadResolved(false);
    setFailure(null);
    try {
      const nextView = await api.today();
      if (requestEpoch !== authEpoch.current) return;
      announceNewGoogleEvents(nextView);
      setView(nextView);
      setFailure(null);
    } catch (error) {
      if (requestEpoch !== authEpoch.current) return;
      if (handleApiAuthFailure(error)) return;
      // Stay in the workspace for config/network failures (502, CORS, cold start).
      // Signing out here made successful Google login look like it "did nothing".
      setFailure(error instanceof Error ? error.message : "Cannot reach Cooper.");
    } finally {
      if (requestEpoch === authEpoch.current) setLoadResolved(true);
    }
  }, [announceNewGoogleEvents, handleApiAuthFailure, workspaceVisible]);

  useEffect(() => {
    if (workspaceVisible) void load();
  }, [load, workspaceVisible]);

  useEffect(() => {
    if (!workspaceVisible) return;
    const refresh = async () => {
      const requestEpoch = authEpoch.current;
      try {
        const nextView = await api.today();
        if (requestEpoch !== authEpoch.current) return;
        announceNewGoogleEvents(nextView);
        setView(nextView);
      } catch {
        // The normal workspace load owns visible connection errors; polling stays quiet.
      }
    };
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [announceNewGoogleEvents, workspaceVisible]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setTab("chat");
        input.current?.focus();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  function reply(turn: Omit<Turn, "id" | "at" | "who">) {
    setTurns((current) => [...current, { ...turn, id: id(), at: Date.now(), who: "otter" }]);
  }

  /** Send one sentence and let the otter answer. */
  const say = useCallback(
    async (sentence: string, intent?: AskIntent, retryId?: string) => {
      const said = sentence.trim();
      if (!said || chatPending) return;
      const requestEpoch = authEpoch.current;
      if (!canCompose) return;
      const openAsk = canUseAi || mode === "ai" || Boolean(intent) || Boolean(retryId);
      const trackedRequest = openAsk && !intent;
      if (trackedRequest && retrySubmission && !retryId) {
        setRetrySubmission({
          ...retrySubmission,
          message: "Check the pending request before sending another.",
        });
        return;
      }
      const owner =
        authState.kind === "signed-in"
          ? `firebase:${encodeURIComponent(authState.user.uid)}`
          : "local";
      const logicalRequestId = trackedRequest ? (retryId ?? crypto.randomUUID()) : undefined;
      const pendingRequest = logicalRequestId
        ? {
            text: said,
            intent,
            logicalRequestId,
            message: "Cooper has not confirmed this request yet.",
            persisted: persistPendingSubmission(owner, { text: said, intent, logicalRequestId }),
          }
        : null;
      if (pendingRequest) setRetrySubmission(pendingRequest);
      if (openAsk) {
        setMode("ai");
        saveMode("ai");
        setTab("chat");
      }

      if (!retryId) setText("");
      if (!retryId)
        setTurns((current) => [...current, { id: id(), at: Date.now(), who: "you", text: said }]);
      setAgentSteps(initialAgentSteps());
      setChatPending(true);

      const advanceAgentStep = (completedId: string, runningId: string) => {
        if (requestEpoch !== authEpoch.current) return;
        setAgentSteps(
          (current) =>
            current?.map((step) =>
              step.id === completedId
                ? { ...step, status: "done" }
                : step.id === runningId
                  ? { ...step, status: "running" }
                  : step,
            ) ?? null,
        );
      };
      agentPhaseTimers.current = [
        window.setTimeout(() => advanceAgentStep("understand", "check"), 650),
        window.setTimeout(() => advanceAgentStep("check", "answer"), 1_300),
      ];

      try {
        const result = await api.say(said, openAsk ? "ai" : "manual", intent, logicalRequestId);
        if (requestEpoch !== authEpoch.current) return;
        setView(result.view);
        setFailure(null);
        if (result.kind === "pending" && pendingRequest) {
          setRetrySubmission({ ...pendingRequest, message: result.message });
          return;
        }
        if (pendingRequest) {
          clearPendingSubmission(owner);
          setRetrySubmission(null);
        }
        if (result.kind === "answered") setHasAsked(true);
        announce(result.kind, result.message, !openAsk);

        reply({
          text: result.message,
          kind: result.kind,
          item: result.item,
          lines: [
            ...(result.facts ?? []),
            ...(result.warnings ?? []),
            ...(result.receipt?.warnings ?? []),
            ...(result.tools?.map(
              (tool) =>
                `${tool.ok ? "Checked" : "Could not check"} ${tool.name.replaceAll("_", " ")}`,
            ) ?? []),
            ...(result.chip ?? []),
          ],
        });
      } catch (error) {
        if (requestEpoch !== authEpoch.current) return;
        if (error instanceof ApiError) {
          if (handleApiAuthFailure(error)) return;
          const kind = error.status === 409 ? "question" : "note";
          reply({
            text: error.message,
            kind,
          });
          announce(kind, error.message);
        } else {
          const message = error instanceof Error ? error.message : "Something went wrong.";
          if (openAsk) {
            reply({ text: message, kind: "note" });
          }
          setFailure(message);
          announce("note", message);
        }
      } finally {
        if (requestEpoch !== authEpoch.current) return;
        agentPhaseTimers.current.forEach((timer) => window.clearTimeout(timer));
        agentPhaseTimers.current = [];
        setAgentSteps(null);
        setChatPending(false);
      }
    },
    [
      announce,
      authState,
      canCompose,
      canUseAi,
      chatPending,
      handleApiAuthFailure,
      mode,
      retrySubmission,
    ],
  );

  /** Buttons elsewhere in the app update the source screen and show a transient notice. */
  const act = useCallback(
    async (work: () => Promise<Reply | { view: View }>): Promise<boolean> => {
      const requestEpoch = authEpoch.current;
      setWorkspaceBusy(true);
      try {
        const result = await work();
        if (requestEpoch !== authEpoch.current) return false;
        setView(result.view);
        setFailure(null);
        if ("kind" in result) {
          announce(result.kind, result.message);
        }
      } catch (error) {
        if (requestEpoch !== authEpoch.current) return false;
        if (error instanceof ApiError) {
          if (handleApiAuthFailure(error)) return false;
          const kind = error.status === 409 ? "question" : "note";
          announce(kind, error.message);
        } else {
          const message = error instanceof Error ? error.message : "Something went wrong.";
          setFailure(message);
          announce("note", message);
        }
        return false;
      } finally {
        setWorkspaceBusy(false);
      }
      return true;
    },
    [announce, handleApiAuthFailure],
  );

  const connectGoogle = useCallback(async () => {
    const requestEpoch = authEpoch.current;
    setWorkspaceBusy(true);
    try {
      const { url } = await api.connect();
      if (requestEpoch !== authEpoch.current) return;
      setFailure(null);
      window.location.href = url;
    } catch (error) {
      if (requestEpoch !== authEpoch.current) return;
      if (error instanceof ApiError) {
        if (handleApiAuthFailure(error)) return;
        const kind = error.status === 409 ? "question" : "note";
        announce(kind, error.message);
      } else {
        const message = error instanceof Error ? error.message : "Something went wrong.";
        setFailure(message);
        announce("note", message);
      }
    } finally {
      setWorkspaceBusy(false);
    }
  }, [announce, handleApiAuthFailure]);

  const connectICloud = useCallback(async () => {
    const email = icloudEmail.trim();
    const password = icloudPassword.trim();
    if (!email || !password) {
      announce("question", "Enter your Apple ID and app-specific password.");
      return;
    }
    const connected = await act(() => api.connectICloud(email, password));
    setIcloudPassword("");
    if (connected) setIcloudEmail("");
  }, [act, announce, icloudEmail, icloudPassword]);

  /** Manual mode's form: post the fields and let Cooper narrate it into the conversation. */
  const addFromForm = useCallback(
    async (item: NewItem) => {
      const saved = await act(() => api.createItem(item));
      if (saved) setHasCreatedItem(true);
      return saved;
    },
    [act],
  );

  const shortlist = view?.shortlist ?? [];
  const scheduled = view?.scheduled ?? [];
  const loadingTab: Exclude<Tab, "chat"> | null = tab === "chat" ? null : tab;
  const guideProgress: OnboardingProgress = {
    hasItem:
      hasCreatedItem ||
      Boolean(
        view?.shortlist.some((item) => item.source === "me") ||
        view?.scheduled.some((item) => item.source === "me"),
      ),
    hasAsked,
    googleConnected: Boolean(view?.calendar.connected),
    icloudConnected: Boolean(view?.icloud.connected),
  };

  useEffect(() => {
    if (!view || guideSessionDismissed) return;
    if (authState.kind === "signed-in" && !onboardingDone(authState.user.uid)) {
      setGuideVisible(true);
    }
    if (authState.kind === "local" && !guideProgress.hasItem && !onboardingDone("local")) {
      setGuideVisible(true);
    }
  }, [authState, guideProgress.hasItem, guideSessionDismissed, view]);

  const dismissGuide = useCallback(() => {
    if (authState.kind === "signed-in") finishOnboarding(authState.user.uid);
    if (authState.kind === "local") finishOnboarding("local");
    setGuideSessionDismissed(true);
    setGuideVisible(false);
  }, [authState]);

  return (
    <div
      className={`app${showPublicRoutes ? " app--public" : ""}${
        publicLandingSurface ? " app--landing" : ""
      }`}
    >
      {workspaceVisible && (
        <Nav
          current={tab}
          todo={shortlist.length}
          booked={view?.planning?.metrics.scheduled_count ?? scheduled.length}
          onChange={(next) => {
            setTab(next);
            if (guideVisible && next === "chat" && !guideProgress.hasItem) {
              setMode("manual");
              saveMode("manual");
            }
          }}
        />
      )}

      <main className="main">
        {showPublicRoutes ? (
          <PublicRoutes
            route={publicRoute}
            busy={authBusy}
            error={failure ?? (authState.kind === "config-error" ? authState.message : null)}
            authEnabled={firebaseConfigured}
            authLoading={authPending}
            onSignIn={startSignIn}
            onEmailAuth={startEmailAuth}
            authStatus={authState.kind === "verification-pending" ? "verification-pending" : "idle"}
            onCheckVerification={checkVerification}
            onResendVerification={resendVerification}
            onResetPassword={sendPasswordReset}
            onUseAnotherAccount={signOutOfFirebase}
          />
        ) : (
          <>
            {authState.kind === "config-error" && (
              <AuthSetupErrorSurface message={authState.message} />
            )}

            {authPending && <LoadingSurface tab="home" />}

            {workspaceVisible && failure && (
              <div className="banner" role="alert">
                <Mascot name="cooper_tired" size="sm" decorative />
                <div className="banner__body">
                  <span className="banner__title">
                    {firebaseConfigured
                      ? "Cooper can\u2019t reach the API"
                      : "Cooper isn\u2019t running"}
                  </span>
                  <span className="banner__text">
                    {firebaseConfigured ? (
                      failure
                    ) : (
                      <>
                        Start it with <code>uv run uvicorn cooper.app:app --host 127.0.0.1</code>.
                      </>
                    )}
                  </span>
                </div>
                <button type="button" className="btn btn--quiet" onClick={() => void load()}>
                  Retry
                </button>
              </div>
            )}

            {workspaceVisible && tab === "home" && view && (
              <Home
                view={view}
                busy={workspaceBusy}
                onComplete={(itemId) => void act(() => api.act(itemId, "complete"))}
                onOpen={setDetail}
                onSchedule={() => void act(() => api.schedule())}
                onMove={(itemId, start, minutes) =>
                  act(() => api.reschedule(itemId, start, minutes))
                }
                onPreviewRecovery={async () => {
                  try {
                    return await api.recoveryPreview();
                  } catch (error) {
                    if (error instanceof ApiError && handleApiAuthFailure(error)) return null;
                    announce(
                      "note",
                      error instanceof Error ? error.message : "Something went wrong.",
                    );
                    return null;
                  }
                }}
                onApplyRecovery={(fingerprint) => act(() => api.applyRecovery(fingerprint))}
                onLoadWeeklyReview={async () => {
                  try {
                    return await api.weeklyReview();
                  } catch (error) {
                    if (error instanceof ApiError && handleApiAuthFailure(error)) return null;
                    announce(
                      "note",
                      error instanceof Error ? error.message : "Something went wrong.",
                    );
                    return null;
                  }
                }}
                onGoToChat={() => {
                  setTab("chat");
                  setMode("ai");
                  saveMode("ai");
                  window.setTimeout(() => input.current?.focus(), 0);
                }}
              />
            )}

            {workspaceVisible && !loadResolved && !view && loadingTab && (
              <LoadingSurface tab={loadingTab} />
            )}

            {workspaceVisible && tab === "chat" && (
              <Chat
                turns={turns}
                thinking={chatPending}
                agentSteps={agentSteps ?? undefined}
                mode={mode}
                canUseAi={canAsk}
                manualForm={<Form busy={workspaceBusy} onSubmit={addFromForm} />}
                onMode={(next) => {
                  setMode(next);
                  saveMode(next);
                }}
                onExample={(example) => void say(example.label, example.intent)}
              />
            )}

            {workspaceVisible && tab === "calendar" && view && (
              <Calendar
                view={view}
                busy={workspaceBusy}
                onComplete={(itemId) => void act(() => api.act(itemId, "complete"))}
                onPin={(itemId) => void act(() => api.act(itemId, "pin"))}
                onDrop={(itemId) => void act(() => api.act(itemId, "drop"))}
              />
            )}

            {workspaceVisible && tab === "settings" && view?.hours && (
              <Settings
                view={view}
                busy={workspaceBusy}
                appearance={appearance}
                onAppearance={chooseAppearance}
                account={
                  firebaseConfigured
                    ? { email: signedInUser?.email ?? null, onSignOut: signOutOfFirebase }
                    : null
                }
                onShowGuide={() => {
                  setTab("home");
                  setGuideSessionDismissed(false);
                  setGuideVisible(true);
                }}
                onAction={act}
                onConnectGoogle={connectGoogle}
                icloud={{
                  email: icloudEmail,
                  password: icloudPassword,
                  onEmail: setIcloudEmail,
                  onPassword: setIcloudPassword,
                  onConnect: connectICloud,
                }}
                browserAlerts={browserAlerts}
                onEnableAlerts={enableBrowserAlerts}
                hasConversation={turns.length > 0}
                onClearConversation={clearConversation}
              />
            )}
          </>
        )}
      </main>

      {workspaceVisible && view && guideVisible && (
        <Onboarding
          timezone={view.timezone}
          progress={guideProgress}
          tab={tab}
          mode={mode}
          onOpenForm={() => {
            setTab("chat");
            setMode("manual");
            saveMode("manual");
          }}
          onOpenAsk={() => {
            setTab("chat");
            setMode("ai");
            saveMode("ai");
            window.setTimeout(() => input.current?.focus(), 0);
          }}
          onOpenSettings={() => setTab("settings")}
          onDismiss={dismissGuide}
        />
      )}

      {workspaceVisible && retrySubmission && (
        <div className="notice" role="status" aria-live="polite">
          <p>
            {retrySubmission.message}
            {!retrySubmission.persisted &&
              " Retry works in this tab; reload recovery is unavailable while browser storage is blocked."}
          </p>
          <button
            type="button"
            className="btn"
            disabled={chatPending}
            onClick={() =>
              void say(
                retrySubmission.text,
                retrySubmission.intent,
                retrySubmission.logicalRequestId,
              )
            }
          >
            Retry status
          </button>
        </div>
      )}

      {notice && !retrySubmission && (
        <div
          className={`notice notice--${noticeTone(notice.kind)}`}
          role="status"
          aria-live="polite"
        >
          <Mascot name={noticeFace(notice.kind)} size="sm" decorative />
          <p className="notice__message">{notice.message}</p>
          <button
            type="button"
            className="notice__close"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            ×
          </button>
        </div>
      )}

      {workspaceVisible &&
        detail &&
        ("kind" in detail ? (
          <TaskFrame
            key={detail.id}
            item={detail}
            today={view?.planning?.today ?? view?.today ?? ""}
            busy={workspaceBusy}
            onClose={() => setDetail(null)}
            onComplete={() => void act(() => api.act(detail.id, "complete"))}
            onPin={() => void act(() => api.act(detail.id, "pin"))}
            onDrop={() => void act(() => api.act(detail.id, "drop"))}
            onEstimate={async (minutes) => {
              const saved = await act(() => api.edit(detail.id, { minutes }));
              if (saved) announce("note", "Estimate saved. Today’s capacity has been refreshed.");
              return saved;
            }}
            onSchedule={
              view?.planning?.complete
                ? () => {
                    void act(() => api.act(detail.id, "schedule"));
                    setDetail(null);
                  }
                : undefined
            }
          />
        ) : (
          <CalendarEventFrame
            event={detail}
            timeZone={view?.timezone ?? "UTC"}
            onClose={() => setDetail(null)}
          />
        ))}

      {/*
        The composer is the sentence path. In Manual mode on the chat tab the form owns input, so
        the free-text box would be a second, contradictory way in — hidden there. Everywhere else
        it stays as quick capture, routing through whatever mode is set.
      */}
      {workspaceVisible && canCompose && !(tab === "chat" && mode === "manual") && (
        <div className="composer">
          <div className="composer__inner">
            <div className="composer__field">
              <label className="visually-hidden" htmlFor="say">
                Say something to Cooper
              </label>
              <input
                id="say"
                data-tour="ask-composer"
                ref={input}
                className="composer__input"
                placeholder="Tell me what's on your plate…"
                value={text}
                autoComplete="off"
                enterKeyHint="send"
                disabled={chatPending}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && !chatPending && void say(text)}
              />
              <button
                type="button"
                className="composer__send"
                aria-label="Send"
                disabled={chatPending || !text.trim()}
                onClick={() => void say(text)}
              >
                <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
                  <path
                    d="M12 19V6.4l-5.3 5.3a1 1 0 0 1-1.4-1.4l7-7a1 1 0 0 1 1.4 0l7 7a1 1 0 0 1-1.4 1.4L14 6.4V19a1 1 0 0 1-2 0Z"
                    fill="currentColor"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
