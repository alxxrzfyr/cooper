import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const firebaseMock = vi.hoisted(() => {
  type TestFirebaseUser = {
    email: string | null;
    getIdToken: () => Promise<string>;
  };
  type AuthCallback = (user: TestFirebaseUser | null) => void;

  let observer: AuthCallback | null = null;

  return {
    configured: false,
    currentUser: null as TestFirebaseUser | null,
    signInWithGoogle: vi.fn<() => Promise<void>>(async () => undefined),
    signOutUser: vi.fn<() => Promise<void>>(async () => undefined),
    reset() {
      this.configured = false;
      this.currentUser = null;
      observer = null;
      this.signInWithGoogle.mockClear();
      this.signOutUser.mockClear();
    },
    user(token: string, email = "friend@example.com"): TestFirebaseUser {
      return {
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

vi.mock("./firebase", () => ({
  get firebaseConfigured() {
    return firebaseMock.configured;
  },
  get auth() {
    if (!firebaseMock.configured) return null;
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

import App from "./App";
import type { View } from "./types";

function view(): View {
  return {
    now: "2026-08-31T01:00:00+00:00",
    today: "2026-08-31",
    timezone: "Asia/Manila",
    shortlist: [],
    scheduled: [],
    events: [],
    undo: null,
    using_model: false,
    hours: {
      start_hour: 9,
      end_hour: 18,
      weekdays: [0, 1, 2, 3, 4],
      max_per_day: 4,
    },
    calendar: { configured: false, connected: false, email: null },
    gmail: {
      configured: false,
      connected: false,
      last_checked: null,
      last_error: null,
      imported: 0,
      skipped: 0,
    },
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
  firebaseMock.reset();
  vi.stubEnv("VITE_COOPER_KEY", "test-key");
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("public auth flow", () => {
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
    firebaseMock.configured = true;
    const fetch = vi.fn(async () => json(view()));
    vi.stubGlobal("fetch", fetch);

    render(<App />);

    expect(screen.getByRole("status", { name: "Loading Cooper’s day" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await emitFirebaseUser(null);

    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("signed-out Firebase users can start Google sign-in", async () => {
    firebaseMock.configured = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(view())),
    );

    render(<App />);
    await emitFirebaseUser(null);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Continue with Google" }));

    expect(firebaseMock.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".who__name")).toHaveLength(2);
    expect(document.querySelector(".auth-screen .mascot")).toHaveAttribute(
      "src",
      "/assets/mascot/cooper_waving.webp",
    );
  });

  test("signed-in Firebase requests use the bearer token", async () => {
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
    firebaseMock.configured = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ detail: "Invalid authentication token" }, 401)),
    );

    render(<App />);
    await emitFirebaseUser(firebaseMock.user("expired-token"));

    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(firebaseMock.signOutUser).toHaveBeenCalledTimes(1);
  });
});
