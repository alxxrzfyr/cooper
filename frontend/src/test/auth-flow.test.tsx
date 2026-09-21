import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const firebaseMock = vi.hoisted(() => {
  type TestFirebaseUser = {
    uid: string;
    email: string | null;
    getIdToken: () => Promise<string>;
  };
  type AuthCallback = (user: TestFirebaseUser | null) => void;

  let observer: AuthCallback | null = null;

  return {
    authMode: "local" as "local" | "firebase",
    configured: false,
    currentUser: null as TestFirebaseUser | null,
    signInWithGoogle: vi.fn<() => Promise<void>>(async () => undefined),
    signOutUser: vi.fn<() => Promise<void>>(async () => undefined),
    reset() {
      this.authMode = "local";
      this.configured = false;
      this.currentUser = null;
      observer = null;
      this.signInWithGoogle.mockClear();
      this.signOutUser.mockClear();
    },
    user(token: string, email = "friend@example.com", uid = token): TestFirebaseUser {
      return {
        uid,
        email,
        getIdToken: () => Promise.resolve(token),
      };
    },
    subscribe(callback: AuthCallback) {
      observer = callback;
      return () => {
        if (observer === callback) observer = null;
      };
    },
    emit(user: TestFirebaseUser | null) {
      this.currentUser = user;
      observer?.(user);
    },
  };
});

vi.mock("../firebase", () => ({
  get clientAuthMode() {
    return firebaseMock.authMode;
  },
  get firebaseConfigured() {
    return firebaseMock.authMode === "firebase" && firebaseMock.configured;
  },
  get firebaseConfigError() {
    return firebaseMock.authMode === "firebase" && !firebaseMock.configured
      ? "Firebase auth is selected, but the public Firebase config is incomplete."
      : null;
  },
  get auth() {
    if (firebaseMock.authMode !== "firebase" || !firebaseMock.configured) return null;
    return {
      get currentUser() {
        return firebaseMock.currentUser;
      },
    };
  },
  signInWithGoogle: firebaseMock.signInWithGoogle,
  signOutUser: firebaseMock.signOutUser,
  subscribeToAuth: firebaseMock.subscribe,
}));

import App from "../App";
import type { Reply, View } from "../types";

function view(overrides: Partial<View> = {}): View {
  return {
    now: "2026-08-31T01:00:00+00:00",
    today: "2026-08-31",
    timezone: "Asia/Manila",
    shortlist: [],
    scheduled: [],
    events: [],
    planning: {
      generated_at: "2026-08-31T01:00:00+00:00",
      today: "2026-08-31",
      timezone: "Asia/Manila",
      complete: true,
      source_health: [],
      commitments: [],
      tasks: [],
      focus: { now_id: null, next_id: null },
      risks: [],
      metrics: {
        scheduled_count: 0,
        occupied_minutes: 0,
        remaining_effort_minutes: 0,
        current_free_block_minutes: 0,
        largest_free_block_minutes: 0,
        conflict_count: 0,
      },
    },
    undo: null,
    using_model: false,
    hours: {
      start_hour: 9,
      end_hour: 18,
      weekdays: [0, 1, 2, 3, 4],
      max_per_day: 4,
    },
    calendar: { configured: false, connected: false, email: null },
    icloud: { configured: false, connected: false, email: null, error: null },
    gmail: {
      configured: false,
      connected: false,
      last_checked: null,
      last_error: null,
      imported: 0,
      skipped: 0,
    },
    ...overrides,
  };
}

function reply(overrides: Partial<Reply> = {}): Reply {
  return {
    kind: "answered",
    message: "Added secret from A.",
    source: "rules",
    view: view({ using_model: true }),
    ...overrides,
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function emitFirebaseUser(user: Parameters<typeof firebaseMock.emit>[0]): Promise<void> {
  await act(async () => {
    firebaseMock.emit(user);
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app");
  firebaseMock.reset();
  vi.stubEnv("VITE_COOPER_KEY", "test-key");
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("public auth flow", () => {
  test("public legal routes do not load the protected workspace", () => {
    window.history.replaceState({}, "", "/privacy");
    const fetch = vi.fn(async () => json(view()));
    vi.stubGlobal("fetch", fetch);

    render(<App />);

    expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  test("local mode keeps the shared key header", async () => {
    const calls: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Headers(init?.headers));
        return json(view());
      }),
    );

    render(<App />);

    expect(await screen.findByText("Nothing on today")).toBeInTheDocument();
    expect(calls[0]?.get("X-Cooper-Key")).toBe("test-key");
    expect(calls[0]?.has("Authorization")).toBe(false);
  });

  test("Firebase mode waits for auth before loading protected data", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    const fetch = vi.fn(async () => json(view()));
    vi.stubGlobal("fetch", fetch);

    render(<App />);

    expect(screen.getByRole("heading", { name: "Checking your account." })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Checking Firebase account" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await emitFirebaseUser(null);

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("signed-out Firebase users are sent to login when opening /app", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    const fetch = vi.fn(async () => json(view()));
    vi.stubGlobal("fetch", fetch);

    render(<App />);
    await emitFirebaseUser(null);

    expect(window.location.pathname).toBe("/login");
    expect(await screen.findByRole("heading", { name: "Log in to Cooper" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("a signed-in visitor from the public root is moved to the workspace", async () => {
    window.history.replaceState({}, "", "/");
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    const fetch = vi.fn(async () => json(view()));
    vi.stubGlobal("fetch", fetch);

    render(<App />);
    await emitFirebaseUser(firebaseMock.user("firebase-id-token"));

    expect(await screen.findByText("Nothing on today")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app");
    expect(screen.getAllByRole("navigation", { name: "Sections" })).not.toHaveLength(0);
  });

  test("signed-out Firebase users can start Google sign-in", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(view())),
    );

    render(<App />);
    await emitFirebaseUser(null);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(firebaseMock.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
    expect(document.querySelector(".auth-page__note .mascot")).toHaveAttribute(
      "src",
      "/assets/mascot/cooper_waving.webp",
    );
  });

  test("signed-in Firebase requests use the bearer token", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    const calls: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(new Headers(init?.headers));
        return json(view());
      }),
    );

    render(<App />);
    await emitFirebaseUser(firebaseMock.user("firebase-id-token"));

    expect(await screen.findByText("Nothing on today")).toBeInTheDocument();
    expect(calls[0]?.get("Authorization")).toBe("Bearer firebase-id-token");
    expect(calls[0]?.has("X-Cooper-Key")).toBe(false);
  });

  test("an expired Firebase token returns to sign-in", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ detail: "Invalid authentication token" }, 401)),
    );

    render(<App />);
    await emitFirebaseUser(firebaseMock.user("expired-token"));

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(firebaseMock.signOutUser).toHaveBeenCalledTimes(1);
  });

  // Regression: after Google login, a misconfigured API must not bounce back to the landing.
  test("a reachable auth session stays in the workspace when the API is misconfigured", async () => {
    window.history.replaceState({}, "", "/");
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><title>Cooper</title>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );

    render(<App />);
    await emitFirebaseUser(firebaseMock.user("firebase-id-token"));

    expect(window.location.pathname).toBe("/app");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Cooper API is not configured/i);
    expect(firebaseMock.signOutUser).not.toHaveBeenCalled();
    expect(screen.getAllByRole("navigation", { name: "Sections" })).not.toHaveLength(0);
  });

  test("Firebase mode with incomplete config fails closed", () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = false;
    const fetch = vi.fn(async () => json(view()));
    vi.stubGlobal("fetch", fetch);

    render(<App />);

    expect(screen.getByRole("alert")).toHaveTextContent("Check Firebase setup");
    expect(screen.getByText(/public Firebase config is incomplete/)).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("switching Firebase accounts clears the prior chat", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        return url.includes("/api/say") ? json(reply()) : json(view({ using_model: true }));
      }),
    );

    render(<App />);
    const user = userEvent.setup();
    localStorage.setItem("cooper.gemini_key.v1:uid-a", "test-gemini-key");
    await emitFirebaseUser(firebaseMock.user("token-a", "a@example.com", "uid-a"));

    await user.click((await screen.findAllByRole("button", { name: /Chat|Cooper/ }))[0]);
    await user.click(await screen.findByRole("button", { name: /AI|Ask/ }));
    await user.type(screen.getByLabelText("Say something to Cooper"), "secret from A{Enter}");

    expect(await screen.findByText("secret from A")).toBeInTheDocument();
    expect(localStorage.getItem("cooper.chat.v1")).toContain("secret from A");

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    await emitFirebaseUser(firebaseMock.user("token-b", "b@example.com", "uid-b"));

    await waitFor(() => {
      expect(localStorage.getItem("cooper.chat.v1")).not.toContain("secret from A");
    });

    await user.click((await screen.findAllByRole("button", { name: /Chat|Cooper/ }))[0]);
    await user.click(await screen.findByRole("button", { name: /AI|Ask/ }));

    expect(screen.queryByText("secret from A")).not.toBeInTheDocument();
    expect(localStorage.getItem("cooper.chat.v1")).not.toContain("secret from A");
  }, 10_000);

  test("Google Connect 401 returns Firebase users to sign-in", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/google/connect")) {
          return json({ detail: "Invalid authentication token" }, 401);
        }
        return json(view({ calendar: { configured: true, connected: false, email: null } }));
      }),
    );

    render(<App />);
    const user = userEvent.setup();
    await emitFirebaseUser(firebaseMock.user("expired-token"));

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);
    await user.click(await screen.findByRole("button", { name: "Connect Google" }));

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(firebaseMock.signOutUser).toHaveBeenCalledTimes(1);
  });
});
