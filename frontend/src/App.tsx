import { useCallback, useEffect, useRef, useState } from "react";

import "./theme.css";
import { applyAppearance, type Appearance, readAppearance, saveAppearance } from "./appearance";
import { api } from "./api";
import { Calendar } from "./Calendar";
import { AvailabilitySettings } from "./AvailabilitySettings";
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
import { CalendarEventFrame, TaskFrame } from "./Frame";
import {
  ApiError,
  type Item,
  type CalendarEvent,
  type NewItem,
  type Ranked,
  type Reply,
  type ReplyKind,
  type View,
} from "./types";

/** Appearance choices shown in Settings. */
const APPEARANCES: Array<{ id: Appearance; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** Event sources planned but not yet wired up. Shown so people know what's coming, not to imply
 *  they can connect one today. */
const COMING_SOON_SOURCES: Array<{ id: string; label: string }> = [
  { id: "teams", label: "Microsoft Teams" },
  { id: "classroom", label: "Google Classroom" },
];

const GEMINI_KEY = "cooper.gemini_key.v1";
const SIDEBAR_COLLAPSED_KEY = "cooper.sidebar.collapsed.v1";
type GeminiKeyStatus = "saved" | "empty" | "cleared" | null;

const PUBLIC_AUTH_PATHS = new Set(["/", "/landing", "/login", "/signup"]);

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function geminiStorageKey(uid?: string | null): string | null {
  if (firebaseConfigured) return uid ? `${GEMINI_KEY}:${uid}` : null;
  return GEMINI_KEY;
}

function loadGeminiKey(uid?: string | null): string {
  const storageKey = geminiStorageKey(uid);
  if (!storageKey) return "";
  try {
    return localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

function saveGeminiKey(value: string, uid?: string | null): void {
  const storageKey = geminiStorageKey(uid);
  if (!storageKey) return;
  try {
    const key = value.trim();
    if (key) localStorage.setItem(storageKey, key);
    else localStorage.removeItem(storageKey);
  } catch {
    /* a blocked store is not worth failing over; the key still applies this session */
  }
}

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

function saveSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch {
    // The rail can still collapse for this session when browser storage is blocked.
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
export function initialAgentSteps(): AgentStep[] {
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

function formatChecked(value: string): string {
  const checked = new Date(value);
  if (Number.isNaN(checked.getTime())) return value;
  return checked.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function id(): string {
  return Math.random().toString(36).slice(2, 10);
}

type BrowserPermission = NotificationPermission | "unsupported";

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

/** Explain priority using the item's deadline and score details. */
function why(item: Item): string {
  if (!item.due) return "no deadline";
  const day = item.due.slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  if (day < today) return "overdue";
  if (day === today) return "due today";
  const days = Math.round((new Date(day).getTime() - new Date(today).getTime()) / 86_400_000);
  if (days === 1) return "due tomorrow";
  return `due in ${days} days`;
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsed);
  const [tab, setTab] = useState<Tab>("home");
  const [view, setView] = useState<View | null>(null);
  const [loadResolved, setLoadResolved] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentSteps, setAgentSteps] = useState<AgentStep[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [geminiKey, setGeminiKey] = useState(loadGeminiKey);
  const [geminiKeyDraft, setGeminiKeyDraft] = useState(loadGeminiKey);
  const [geminiKeyStatus, setGeminiKeyStatus] = useState<GeminiKeyStatus>(null);
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
  const modeAvailabilityChecked = useRef(false);
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );
  const pathnameRef = useRef(pathname);
  /** The one task a frame is open on, if any. Plan and Calendar share the component. */
  const [detail, setDetail] = useState<Item | Ranked | CalendarEvent | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canUseAi =
    Boolean(geminiKey.trim()) || Boolean(view?.using_model && authState.kind === "local");
  const canCompose = canUseAi || authState.kind === "local";
  const canAsk = canUseAi || authState.kind === "local";
  const signedInUser =
    authState.kind === "signed-in" || authState.kind === "verification-pending"
      ? authState.user
      : null;
  const signedInUid = signedInUser?.uid ?? null;
  const saveGeminiKeyFromSettings = useCallback(() => {
    const key = geminiKeyDraft.trim();
    if (!key) {
      setGeminiKeyStatus("empty");
      return;
    }
    saveGeminiKey(key, signedInUid);
    setGeminiKey(key);
    setGeminiKeyDraft(key);
    setGeminiKeyStatus("saved");
  }, [geminiKeyDraft, signedInUid]);
  const canLoadProtectedData = authState.kind === "local" || authState.kind === "signed-in";
  const publicRoute = readPublicRoute(pathname);
  const normalizedPathname = normalizePathname(pathname);
  const isWorkspacePath = normalizedPathname === "/app";
  const publicSurface = !isWorkspacePath || (firebaseConfigured && authState.kind !== "signed-in");
  const publicLandingSurface = publicSurface && publicRoute === "landing";
  const workspaceVisible = canLoadProtectedData && !publicSurface;
  const signedInEmail = signedInUser?.email ?? null;

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
        const nextKey = loadGeminiKey(nextSubject);
        setGeminiKey(nextKey);
        setGeminiKeyDraft(nextKey);
        setGeminiKeyStatus(null);
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
  }, [clearConversation, navigate]);

  const signOutOfFirebase = useCallback(() => {
    if (!firebaseConfigured) return;
    authEpoch.current += 1;
    firebaseSubject.current = null;
    clearConversation();
    setView(null);
    setAuthState({ kind: "signed-out" });
    setLoadResolved(true);
    if (normalizePathname(pathnameRef.current) === "/app") {
      navigate("/login");
    }
    void signOutUser();
  }, [clearConversation, navigate]);

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
    setBusy(true);
    void signInWithGoogle()
      .catch((error: unknown) => {
        setFailure(firebaseAuthMessage(error));
      })
      .finally(() => setBusy(false));
  }, []);

  const startEmailAuth = useCallback(
    async (email: string, password: string, intent: "login" | "signup") => {
      setFailure(null);
      setBusy(true);
      try {
        if (intent === "login") await signInWithEmail(email, password);
        else await registerWithEmail(email, password);
      } catch (error: unknown) {
        setFailure(firebaseAuthMessage(error));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const checkVerification = useCallback(async () => {
    setFailure(null);
    setBusy(true);
    try {
      const user = await refreshCurrentUser();
      if (!user || user.emailVerified === false) {
        setFailure(
          "Your email is not verified yet. Open the latest email from Cooper and try again.",
        );
        return;
      }
      setAuthState({ kind: "signed-in", user });
      const nextKey = loadGeminiKey(user.uid);
      setGeminiKey(nextKey);
      setGeminiKeyDraft(nextKey);
      navigate("/app");
    } catch (error: unknown) {
      setFailure(firebaseAuthMessage(error));
    } finally {
      setBusy(false);
    }
  }, [navigate]);

  const resendVerification = useCallback(async () => {
    setFailure(null);
    setBusy(true);
    try {
      if (!auth?.currentUser) throw new Error("No account is signed in.");
      await resendVerificationEmail(auth.currentUser);
      setFailure("Verification email sent. Check your inbox and spam folder.");
    } catch (error: unknown) {
      setFailure(firebaseAuthMessage(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const sendPasswordReset = useCallback(async (email: string) => {
    setFailure(null);
    setBusy(true);
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
      setBusy(false);
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

  useEffect(() => {
    if (!loadResolved || modeAvailabilityChecked.current) return;
    modeAvailabilityChecked.current = true;
    if (!canUseAi && mode === "ai") {
      setMode("manual");
      saveMode("manual");
    }
  }, [canUseAi, loadResolved, mode]);

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
    async (sentence: string) => {
      const said = sentence.trim();
      if (!said || busy) return;
      const requestEpoch = authEpoch.current;
      if (!canCompose) return;
      const openAsk = canUseAi || mode === "ai";
      if (openAsk) {
        setMode("ai");
        saveMode("ai");
        setTab("chat");
      }

      setText("");
      setTurns((current) => [...current, { id: id(), at: Date.now(), who: "you", text: said }]);
      setAgentSteps(initialAgentSteps());
      setBusy(true);

      const advanceAgentStep = (completedId: string, runningId: string) => {
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
        const result = await api.say(said, openAsk ? "ai" : "manual", geminiKey);
        if (requestEpoch !== authEpoch.current) return;
        setView(result.view);
        setFailure(null);
        announce(result.kind, result.message, !openAsk);

        if (result.kind === "shown") {
          const list = result.view.shortlist.slice(0, 4);
          reply({
            text: list.length
              ? `Start with ${list[0].title}.`
              : "Nothing waiting. Tell me what's on your plate.",
            kind: "shown",
            lines: list.map(
              (row, index) =>
                `${index + 1}. ${row.title}${row.minutes ? ` · ${row.minutes}m` : ""} · ${why(row)}`,
            ),
          });
        } else {
          reply({
            text: result.message,
            kind: result.kind,
            item: result.item,
            lines: [
              ...(result.tools?.map(
                (tool) =>
                  `${tool.ok ? "Checked" : "Could not check"} ${tool.name.replaceAll("_", " ")}`,
              ) ?? []),
              ...(result.chip ?? []),
            ],
          });
        }
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
          setFailure(message);
          announce("note", message);
        }
      } finally {
        agentPhaseTimers.current.forEach((timer) => window.clearTimeout(timer));
        agentPhaseTimers.current = [];
        setAgentSteps(null);
        setBusy(false);
      }
    },
    [announce, busy, canCompose, canUseAi, geminiKey, handleApiAuthFailure, mode],
  );

  /** Buttons elsewhere in the app update the source screen and show a transient notice. */
  const act = useCallback(
    async (work: () => Promise<Reply | { view: View }>): Promise<boolean> => {
      const requestEpoch = authEpoch.current;
      setBusy(true);
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
        setBusy(false);
      }
      return true;
    },
    [announce, handleApiAuthFailure],
  );

  const connectGoogle = useCallback(async () => {
    const requestEpoch = authEpoch.current;
    setBusy(true);
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
      setBusy(false);
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
  const hours = view?.hours;
  const loadingTab: Exclude<Tab, "chat"> | null = tab === "chat" ? null : tab;
  const guideProgress: OnboardingProgress = {
    hasItem:
      hasCreatedItem ||
      Boolean(
        view?.shortlist.some((item) => item.source === "me") ||
        view?.scheduled.some((item) => item.source === "me"),
      ),
    hasGeminiKey: canUseAi,
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

  const openSettings = useCallback(() => {
    setTab("settings");
    window.setTimeout(() => document.getElementById("gemini-key")?.focus(), 0);
  }, []);

  return (
    <div
      className={`app${publicSurface ? " app--public" : ""}${
        publicLandingSurface ? " app--landing" : ""
      }${!publicSurface && sidebarCollapsed ? " app--rail-collapsed" : ""}`}
    >
      {!publicSurface && (
        <Nav
          current={tab}
          todo={shortlist.length}
          booked={view?.planning.metrics.scheduled_count ?? 0}
          collapsed={sidebarCollapsed}
          onChange={(next) => {
            setTab(next);
            if (guideVisible && next === "chat" && !guideProgress.hasItem) {
              setMode("manual");
              saveMode("manual");
            }
          }}
          onToggleCollapsed={() => {
            setSidebarCollapsed((current) => {
              const next = !current;
              saveSidebarCollapsed(next);
              return next;
            });
          }}
        />
      )}

      <main className="main">
        {publicSurface ? (
          <PublicRoutes
            route={publicRoute}
            busy={busy}
            error={failure ?? (authState.kind === "config-error" ? authState.message : null)}
            authEnabled={firebaseConfigured}
            authLoading={authState.kind === "loading"}
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

            {firebaseConfigured && authState.kind === "loading" && <LoadingSurface tab="home" />}

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

            {workspaceVisible && firebaseConfigured && tab === "home" && view && !canUseAi && (
              <div className="home-ask-setup" role="status" aria-labelledby="home-ask-title">
                <Mascot name="cooper_thinking" size="sm" decorative />
                <div className="home-ask-setup__body">
                  <h2 id="home-ask-title">Ask is one small setup away</h2>
                  <p>
                    Add your Gemini API key in Settings when you want natural-language help. Form
                    works offline.
                  </p>
                </div>
                <div className="home-ask-setup__actions">
                  <button
                    type="button"
                    className="btn btn--accent"
                    onClick={() => {
                      setTab("chat");
                      setMode("manual");
                    }}
                  >
                    Add with Form
                  </button>
                  <button type="button" className="btn btn--quiet" onClick={openSettings}>
                    Set up Ask
                  </button>
                </div>
              </div>
            )}

            {workspaceVisible && tab === "home" && view && (
              <Home
                view={view}
                busy={busy}
                onComplete={(itemId) => void act(() => api.act(itemId, "complete"))}
                onOpen={setDetail}
                onSchedule={() => void act(() => api.schedule())}
                onGoToChat={() => {
                  if (canUseAi) {
                    setTab("chat");
                    setMode("ai");
                    saveMode("ai");
                    window.setTimeout(() => input.current?.focus(), 0);
                  } else if (authState.kind === "local") {
                    window.setTimeout(() => input.current?.focus(), 0);
                  } else {
                    setTab("chat");
                    setMode("manual");
                  }
                }}
              />
            )}

            {workspaceVisible && !loadResolved && !view && loadingTab && (
              <LoadingSurface tab={loadingTab} />
            )}

            {workspaceVisible && tab === "chat" && (
              <Chat
                turns={turns}
                thinking={busy}
                agentSteps={agentSteps ?? undefined}
                mode={mode}
                canUseAi={canAsk}
                manualForm={<Form busy={busy} onSubmit={addFromForm} />}
                onMode={(next) => {
                  setMode(next);
                  saveMode(next);
                }}
                onExample={(example) => void say(example)}
              />
            )}

            {workspaceVisible && tab === "calendar" && view && (
              <Calendar
                view={view}
                busy={busy}
                onComplete={(itemId) => void act(() => api.act(itemId, "complete"))}
                onPin={(itemId) => void act(() => api.act(itemId, "pin"))}
                onDrop={(itemId) => void act(() => api.act(itemId, "drop"))}
              />
            )}

            {workspaceVisible && tab === "settings" && hours && view && (
              <div className="scroll">
                <h1 className="largetitle">
                  Settings
                  <span className="largetitle__sub">{view.timezone}</span>
                </h1>

                <section className="group">
                  <div className="group__label">Appearance</div>
                  <div className="inset">
                    <div className="segmented" role="group" aria-label="Appearance">
                      {APPEARANCES.map(({ id: choice, label }) => (
                        <button
                          key={choice}
                          type="button"
                          className="segment"
                          aria-pressed={appearance === choice}
                          onClick={() => chooseAppearance(choice)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <p className="hint">
                    Light unless you say otherwise. System follows whatever your machine is doing.
                  </p>
                </section>

                {firebaseConfigured && (
                  <section className="group">
                    <div className="group__label">Account</div>
                    <div className="inset">
                      <div className="field">
                        <span className="field__label">Signed in</span>
                        <span className="tag">{signedInEmail ?? "Google account"}</span>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          onClick={signOutOfFirebase}
                        >
                          Sign out
                        </button>
                      </div>
                    </div>
                  </section>
                )}

                <section className="group">
                  <div className="group__label">Guide</div>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => {
                      setTab("home");
                      setGuideSessionDismissed(false);
                      setGuideVisible(true);
                    }}
                  >
                    Show getting-started guide
                  </button>
                </section>

                <section className="group">
                  <AvailabilitySettings
                    hours={hours}
                    busy={busy}
                    onSave={(next) => act(() => api.setHours(next))}
                  />
                  {view.source_health
                    ?.filter((source) => source.status === "unavailable")
                    .map((source) => (
                      <p className="hint" key={source.source}>
                        {source.source}:{" "}
                        {source.message ??
                          "Calendar unavailable. New tasks are saved and wait for a reliable availability check."}
                      </p>
                    ))}
                </section>

                <section className="group">
                  <div className="group__label" data-tour="calendar-connections">
                    Google Calendar + Gmail
                  </div>
                  <div className="inset">
                    <div className="field">
                      <span className="field__label">Account</span>
                      <span className="tag">
                        {view.calendar.connected
                          ? (view.calendar.email ?? "Connected")
                          : view.calendar.configured
                            ? "Not connected"
                            : "Not set up"}
                      </span>
                      {view.calendar.connected ? (
                        <button
                          type="button"
                          className="btn btn--quiet"
                          onClick={() => void act(() => api.disconnect())}
                        >
                          Disconnect
                        </button>
                      ) : view.calendar.configured ? (
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={busy}
                          onClick={() => void connectGoogle()}
                        >
                          Connect Google
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <p className="hint">
                    {view.calendar.connected
                      ? "Google events appear in Cooper and protect busy time. New work stays in Cooper's calendar."
                      : view.calendar.configured
                        ? "Not connected. Cooper is using its own calendar, which works on its own."
                        : "Cooper has its own calendar and needs nothing to work. Connect Google Calendar + Gmail when you want both services included."}
                  </p>
                </section>

                <section className="group">
                  <div className="group__label">iCloud Calendar</div>
                  {view.icloud.connected ? (
                    <div className="inset">
                      <div className="field">
                        <span className="field__label">Account</span>
                        <span className="tag">{view.icloud.email ?? "Connected"}</span>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={busy}
                          onClick={() => void act(() => api.disconnectICloud())}
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  ) : (
                    <form
                      className="inset"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void connectICloud();
                      }}
                    >
                      <label className="field">
                        <span className="field__label">Apple ID</span>
                        <input
                          type="email"
                          autoComplete="username"
                          value={icloudEmail}
                          onChange={(event) => setIcloudEmail(event.target.value)}
                          placeholder="you@icloud.com"
                        />
                      </label>
                      <label className="field">
                        <span className="field__label">App-specific password</span>
                        <input
                          type="password"
                          autoComplete="current-password"
                          value={icloudPassword}
                          onChange={(event) => setIcloudPassword(event.target.value)}
                          placeholder="xxxx-xxxx-xxxx-xxxx"
                        />
                      </label>
                      <button
                        type="submit"
                        className="btn btn--quiet"
                        disabled={busy || !view.icloud.configured}
                      >
                        Connect iCloud
                      </button>
                    </form>
                  )}
                  <p className={`hint ${view.icloud.error ? "hint--error" : ""}`}>
                    {view.icloud.error
                      ? view.icloud.error
                      : view.icloud.connected
                        ? "Read-only iCloud events now block scheduling through CalDAV."
                        : view.icloud.configured
                          ? "Use an Apple app-specific password. Cooper keeps iCloud read-only."
                          : "Server encryption is required before iCloud can be connected."}
                  </p>
                </section>

                <section className="group">
                  <div className="group__label">Gmail confirmations</div>
                  <div className="inset">
                    <div className="field">
                      <span className="field__label">Status</span>
                      <span className="tag">
                        {view.gmail.connected
                          ? "Connected"
                          : view.gmail.configured
                            ? "Not connected"
                            : "Not configured"}
                      </span>
                      <button
                        type="button"
                        className="btn btn--quiet"
                        disabled={busy || !view.gmail.connected}
                        onClick={() => void act(() => api.syncGoogle())}
                      >
                        {busy ? "Syncing…" : "Sync now"}
                      </button>
                    </div>
                    <div className="field">
                      <span className="field__label">Last checked</span>
                      <span className="tag">
                        {view.gmail.last_checked
                          ? formatChecked(view.gmail.last_checked)
                          : "Not yet"}
                      </span>
                    </div>
                    <div className="field">
                      <span className="field__label">Recent messages</span>
                      <span className="tag">
                        {view.gmail.imported} imported · {view.gmail.skipped} skipped
                      </span>
                    </div>
                  </div>
                  <p className={`hint ${view.gmail.last_error ? "hint--error" : ""}`}>
                    {view.gmail.last_error
                      ? view.gmail.last_error
                      : view.gmail.connected
                        ? "Read-only confirmations from Luma, Meetup, and Eventbrite block scheduling."
                        : view.gmail.configured
                          ? "Connect Google Calendar + Gmail above to enable Gmail confirmations."
                          : "Cooper works without Google. Connect both Google services to import known Gmail confirmations."}
                  </p>
                </section>

                <section className="group">
                  <div className="group__label">More sources</div>
                  <div className="inset">
                    {COMING_SOON_SOURCES.map((source) => (
                      <div className="field" key={source.id}>
                        <span className="field__label">{source.label}</span>
                        <span className="tag">Coming soon</span>
                      </div>
                    ))}
                  </div>
                  <p className="hint">Planned event sources. None of these connect yet.</p>
                </section>

                <section className="group">
                  <div className="group__label">Parsing</div>
                  <div className="inset">
                    <div className="field">
                      <span className="field__label">{canUseAi ? "Gemini" : "Offline rules"}</span>
                      <span className="tag">
                        {geminiKey.trim()
                          ? firebaseConfigured
                            ? "this account"
                            : "this browser"
                          : "no key"}
                      </span>
                    </div>
                    <div className="field field--stacked">
                      <label className="field__label" htmlFor="gemini-key">
                        Gemini API key
                      </label>
                      <div className="field__secret">
                        <input
                          id="gemini-key"
                          data-tour="gemini-key"
                          type="password"
                          autoComplete="off"
                          maxLength={256}
                          spellCheck={false}
                          value={geminiKeyDraft}
                          aria-describedby="gemini-key-hint"
                          onChange={(event) => {
                            const value = event.target.value;
                            setGeminiKeyDraft(value);
                            setGeminiKeyStatus(null);
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn--quiet"
                          onClick={saveGeminiKeyFromSettings}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={!geminiKeyDraft}
                          onClick={() => {
                            setGeminiKey("");
                            setGeminiKeyDraft("");
                            saveGeminiKey("", signedInUid);
                            setGeminiKeyStatus("cleared");
                            setLoadResolved(false);
                            void load();
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>
                  {geminiKeyStatus === "saved" && (
                    <p className="hint" role="status">
                      Saved. Ask is ready to use.
                    </p>
                  )}
                  {geminiKeyStatus === "empty" && (
                    <p className="hint hint--error" role="alert">
                      Enter a Gemini API key before saving.
                    </p>
                  )}
                  {geminiKeyStatus === "cleared" && (
                    <p className="hint" role="status">
                      Key cleared. Ask is disabled until you save another key.
                    </p>
                  )}
                  <p className="hint" id="gemini-key-hint">
                    {canUseAi
                      ? "Your key stays in this browser and is sent only when you use Ask. Form stays offline."
                      : "Add a Gemini API key to talk to Cooper in Ask. Form stays offline and never needs a key."}
                  </p>
                </section>

                <section className="group">
                  <div className="group__label">Notifications</div>
                  <div className="inset">
                    <div className="field">
                      <span className="field__label">Browser alerts</span>
                      <span className="tag">
                        {browserAlerts === "unsupported"
                          ? "Not available"
                          : browserAlerts === "granted"
                            ? "On"
                            : browserAlerts === "denied"
                              ? "Blocked"
                              : "Off"}
                      </span>
                      {browserAlerts === "default" && (
                        <button
                          type="button"
                          className="btn btn--quiet"
                          onClick={() => void enableBrowserAlerts()}
                        >
                          Enable
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="hint">
                    Cooper shows a small in-app notice for each change. Browser alerts appear only
                    when this app is in the background.
                  </p>
                </section>

                {turns.length > 0 && (
                  <button type="button" className="btn btn--full" onClick={clearConversation}>
                    Clear conversation
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {workspaceVisible && view && guideVisible && (
        <Onboarding
          progress={guideProgress}
          tab={tab}
          mode={mode}
          onOpenForm={() => {
            setTab("chat");
            setMode("manual");
            saveMode("manual");
          }}
          onOpenSettings={() => setTab("settings")}
          onDismiss={dismissGuide}
        />
      )}

      {notice && (
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
            item={detail}
            today={view?.today ?? ""}
            busy={busy}
            onClose={() => setDetail(null)}
            onComplete={() => void act(() => api.act(detail.id, "complete"))}
            onPin={() => void act(() => api.act(detail.id, "pin"))}
            onDrop={() => void act(() => api.act(detail.id, "drop"))}
            onSchedule={() => {
              void act(() => api.act(detail.id, "schedule"));
              setDetail(null);
            }}
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
                ref={input}
                className="composer__input"
                placeholder="Tell me what's on your plate…"
                value={text}
                autoComplete="off"
                enterKeyHint="send"
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && void say(text)}
              />
              <button
                type="button"
                className="composer__send"
                aria-label="Send"
                disabled={busy || !text.trim()}
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
