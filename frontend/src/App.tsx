import { useCallback, useEffect, useRef, useState } from "react";

import "./theme.css";
import { applyAppearance, type Appearance, readAppearance, saveAppearance } from "./appearance";
import { api } from "./api";
import { Calendar } from "./Calendar";
import { Chat, loadMode, loadTurns, saveMode, saveTurns, type Mode, type Turn } from "./Chat";
import {
  firebaseConfigError,
  firebaseConfigured,
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
import { Row } from "./Row";
import { TaskFrame } from "./Frame";
import {
  ApiError,
  type Item,
  type NewItem,
  type Ranked,
  type Reply,
  type ReplyKind,
  type View,
} from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Appearance choices shown in Settings. */
const APPEARANCES: Array<{ id: Appearance; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

/** Event sources planned but not yet wired up. Shown so people know what's coming, not to imply
 *  they can connect one today. */
const COMING_SOON_SOURCES: Array<{ id: string; label: string }> = [
  { id: "luma", label: "Luma" },
  { id: "meetup", label: "Meetup" },
  { id: "teams", label: "Microsoft Teams" },
  { id: "classroom", label: "Google Classroom" },
];

const GEMINI_KEY = "cooper.gemini_key.v1";

const PUBLIC_AUTH_PATHS = new Set(["/", "/landing", "/login", "/signup"]);

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function loadGeminiKey(): string {
  try {
    return localStorage.getItem(GEMINI_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveGeminiKey(value: string): void {
  try {
    const key = value.trim();
    if (key) localStorage.setItem(GEMINI_KEY, key);
    else localStorage.removeItem(GEMINI_KEY);
  } catch {
    /* a blocked store is not worth failing over; the key still applies this session */
  }
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
  | { kind: "signed-in"; user: FirebaseUser };

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
  const [serverModelAvailable, setServerModelAvailable] = useState(false);
  const [loadResolved, setLoadResolved] = useState(false);
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<Appearance>(readAppearance);
  const [geminiKey, setGeminiKey] = useState(loadGeminiKey);
  const [mode, setMode] = useState<Mode>(loadMode);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [browserAlerts, setBrowserAlerts] = useState<BrowserPermission>(browserPermission);
  const noticeTimer = useRef<number | null>(null);
  const firebaseSubject = useRef<string | null>(null);
  const authEpoch = useRef(0);
  const [pathname, setPathname] = useState(() =>
    typeof window === "undefined" ? "/" : window.location.pathname,
  );
  const pathnameRef = useRef(pathname);
  /** The one task a frame is open on, if any. Plan and Calendar share the component. */
  const [detail, setDetail] = useState<Item | Ranked | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const canUseAi = Boolean(geminiKey.trim()) || serverModelAvailable;
  const canLoadProtectedData = authState.kind === "local" || authState.kind === "signed-in";
  const publicRoute = readPublicRoute(pathname);
  const normalizedPathname = normalizePathname(pathname);
  const isWorkspacePath = normalizedPathname === "/app";
  const publicSurface = !isWorkspacePath || (firebaseConfigured && authState.kind !== "signed-in");
  const publicLandingSurface = publicSurface && publicRoute === "landing";
  const workspaceVisible = canLoadProtectedData && !publicSurface;
  const signedInEmail = authState.kind === "signed-in" ? authState.user.email : null;

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
      if (user && PUBLIC_AUTH_PATHS.has(currentPath)) {
        navigate("/app");
      }
      if (!user && currentPath === "/app") {
        navigate("/login");
      }
      const nextSubject = user?.uid ?? null;
      if (firebaseSubject.current !== nextSubject) {
        firebaseSubject.current = nextSubject;
        authEpoch.current += 1;
        clearConversation();
      }
      setAuthState(user ? { kind: "signed-in", user } : { kind: "signed-out" });
      setView(null);
      setLoadResolved(user === null);
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

  const startSignIn = useCallback(() => {
    setFailure(null);
    setBusy(true);
    void signInWithGoogle().catch((error: unknown) => {
      setBusy(false);
      setFailure(error instanceof Error ? error.message : "Could not start sign in.");
    });
  }, []);

  const announce = useCallback(
    (kind: ReplyKind, message: string, showToast = true) => {
      if (showToast && tab !== "chat") {
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
    [browserAlerts, tab],
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
    if (loadResolved && !canUseAi && mode === "ai") {
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
      setView(nextView);
      setServerModelAvailable(nextView.using_model);
      setFailure(null);
    } catch (error) {
      if (requestEpoch !== authEpoch.current) return;
      if (error instanceof ApiError && error.status === 401 && returnToSignIn()) return;
      // Stay in the workspace for config/network failures (502, CORS, cold start).
      // Signing out here made successful Google login look like it "did nothing".
      setFailure(error instanceof Error ? error.message : "Cannot reach Cooper.");
    } finally {
      if (requestEpoch === authEpoch.current) setLoadResolved(true);
    }
  }, [returnToSignIn, workspaceVisible]);

  useEffect(() => {
    if (workspaceVisible) void load();
  }, [load, workspaceVisible]);

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

      setTab("chat");
      setText("");
      setTurns((current) => [...current, { id: id(), at: Date.now(), who: "you", text: said }]);
      setBusy(true);

      try {
        const result = await api.say(said, mode, geminiKey);
        if (requestEpoch !== authEpoch.current) return;
        setView(result.view);
        setFailure(null);
        announce(result.kind, result.message, false);

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
            lines: result.chip,
          });
        }
      } catch (error) {
        if (requestEpoch !== authEpoch.current) return;
        if (error instanceof ApiError) {
          if (error.status === 401 && returnToSignIn()) return;
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
        setBusy(false);
      }
    },
    [announce, busy, geminiKey, mode, returnToSignIn],
  );

  /** Buttons elsewhere in the app update the source screen and show a transient notice. */
  const act = useCallback(
    async (work: () => Promise<Reply | { view: View }>) => {
      const requestEpoch = authEpoch.current;
      setBusy(true);
      try {
        const result = await work();
        if (requestEpoch !== authEpoch.current) return;
        setView(result.view);
        setFailure(null);
        if ("kind" in result) {
          announce(result.kind, result.message);
        }
      } catch (error) {
        if (requestEpoch !== authEpoch.current) return;
        if (error instanceof ApiError) {
          if (error.status === 401 && returnToSignIn()) return;
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
    },
    [announce, returnToSignIn],
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
        if (error.status === 401 && returnToSignIn()) return;
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
  }, [announce, returnToSignIn]);

  /** Manual mode's form: post the fields and let Cooper narrate it into the conversation. */
  const addFromForm = useCallback(
    async (item: NewItem) => {
      await act(() => api.createItem(item));
    },
    [act],
  );

  const shortlist = view?.shortlist ?? [];
  const scheduled = view?.scheduled ?? [];
  const hours = view?.hours;
  const loadingTab: Exclude<Tab, "chat"> | null = tab === "chat" ? null : tab;

  return (
    <div
      className={`app${publicSurface ? " app--public" : ""}${
        publicLandingSurface ? " app--landing" : ""
      }`}
    >
      {!publicSurface && (
        <Nav
          current={tab}
          todo={shortlist.length}
          booked={scheduled.length}
          undo={view?.undo ?? null}
          busy={busy}
          onChange={setTab}
          onUndo={() => void act(() => api.undo())}
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

            {workspaceVisible && tab === "home" && view && (
              <Home
                view={view}
                busy={busy}
                onComplete={(itemId) => void act(() => api.act(itemId, "complete"))}
                onOpen={setDetail}
                onSchedule={() => void act(() => api.schedule())}
                onGoToChat={() => {
                  setTab("chat");
                  input.current?.focus();
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
                mode={mode}
                canUseAi={canUseAi}
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
                  <div className="group__label">Working hours</div>
                  <div className="inset">
                    <div className="field">
                      <span className="field__label">Start</span>
                      <select
                        aria-label="Day starts at"
                        value={hours.start_hour}
                        onChange={(event) =>
                          void act(() =>
                            api.setHours({
                              ...hours,
                              start_hour: Number(event.target.value),
                            }),
                          )
                        }
                      >
                        {Array.from({ length: 24 }, (_, hour) => (
                          <option key={hour} value={hour}>
                            {String(hour).padStart(2, "0")}:00
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <span className="field__label">End</span>
                      <select
                        aria-label="Day ends at"
                        value={hours.end_hour}
                        onChange={(event) =>
                          void act(() =>
                            api.setHours({
                              ...hours,
                              end_hour: Number(event.target.value),
                            }),
                          )
                        }
                      >
                        {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                          <option key={hour} value={hour}>
                            {String(hour).padStart(2, "0")}:00
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="daypick">
                      {DAYS.map((name, index) => (
                        <button
                          key={name}
                          type="button"
                          className="day"
                          aria-pressed={hours.weekdays.includes(index)}
                          onClick={() =>
                            void act(() =>
                              api.setHours({
                                ...hours,
                                weekdays: hours.weekdays.includes(index)
                                  ? hours.weekdays.filter((day) => day !== index)
                                  : [...hours.weekdays, index].sort((a, b) => a - b),
                              }),
                            )
                          }
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                    <div className="field">
                      <span className="field__label">Most blocks a day</span>
                      <input
                        type="number"
                        aria-label="Most blocks a day"
                        min={1}
                        max={10}
                        value={hours.max_per_day}
                        onChange={(event) =>
                          void act(() =>
                            api.setHours({
                              ...hours,
                              max_per_day: Number(event.target.value),
                            }),
                          )
                        }
                      />
                    </div>
                  </div>
                  <p className="hint">Nothing is ever booked outside these hours.</p>
                </section>

                <section className="group">
                  <div className="group__label">Google Calendar + Gmail</div>
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
                          Connect
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <p className="hint">
                    {view.calendar.connected
                      ? "Booked work is written to Google. Your own events block scheduling."
                      : view.calendar.configured
                        ? "Not connected. Cooper is using its own calendar, which works on its own."
                        : "Cooper has its own calendar and needs nothing to work. Connect Google Calendar + Gmail when you want both services included."}
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
                        {serverModelAvailable
                          ? "configured"
                          : geminiKey.trim()
                            ? "this browser"
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
                          type="password"
                          autoComplete="off"
                          maxLength={256}
                          spellCheck={false}
                          value={geminiKey}
                          aria-describedby="gemini-key-hint"
                          onChange={(event) => {
                            const value = event.target.value;
                            setGeminiKey(value);
                            saveGeminiKey(value);
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn--quiet"
                          disabled={!geminiKey}
                          onClick={() => {
                            setGeminiKey("");
                            saveGeminiKey("");
                            setLoadResolved(false);
                            void load();
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="hint" id="gemini-key-hint">
                    {canUseAi
                      ? "Your key stays in this browser and is sent only when you use Ask. Form stays offline."
                      : "Works fine without a key. Add one for messier sentences. Ranking never uses a model."}
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

      {workspaceVisible && detail && (
        <TaskFrame
          item={detail}
          today={view?.today ?? ""}
          busy={busy}
          onClose={() => setDetail(null)}
          onComplete={() => void act(() => api.act(detail.id, "complete"))}
          onPin={() => void act(() => api.act(detail.id, "pin"))}
          onDrop={() => void act(() => api.act(detail.id, "drop"))}
        />
      )}

      {/*
        The composer is the sentence path. In Manual mode on the chat tab the form owns input, so
        the free-text box would be a second, contradictory way in — hidden there. Everywhere else
        it stays as quick capture, routing through whatever mode is set.
      */}
      {workspaceVisible && !(tab === "chat" && mode === "manual") && (
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
