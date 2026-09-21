import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App, { initialAgentSteps } from "../App";
import type { CalendarEvent, Item, PlanningSnapshot, Ranked, Reply, View } from "../types";

interface TestFirebaseUser {
  uid: string;
  email: string | null;
  getIdToken: ReturnType<typeof vi.fn<() => Promise<string>>>;
}

const firebaseMock = vi.hoisted(() => ({
  authMode: "local" as "local" | "firebase",
  configured: false,
  currentUser: null as TestFirebaseUser | null,
  observer: null as ((user: TestFirebaseUser | null) => void) | null,
  signInWithGoogle: vi.fn<() => Promise<void>>(async () => undefined),
  signOutUser: vi.fn<() => Promise<void>>(async () => undefined),
  unsubscribe: vi.fn(),
}));

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
    return firebaseMock.authMode === "firebase" && firebaseMock.configured
      ? {
          get currentUser() {
            return firebaseMock.currentUser;
          },
        }
      : null;
  },
  signInWithGoogle: firebaseMock.signInWithGoogle,
  signOutUser: firebaseMock.signOutUser,
  subscribeToAuth: (callback: (user: TestFirebaseUser | null) => void) => {
    firebaseMock.observer = callback;
    return firebaseMock.unsubscribe;
  },
}));

interface GmailHealthFixture {
  configured: boolean;
  connected: boolean;
  last_checked: string | null;
  last_error: string | null;
  imported: number;
  skipped: number;
}

function ranked(overrides: Partial<Ranked> = {}): Ranked {
  return {
    id: "a1",
    owner_id: "local",
    source: "me",
    source_ref: null,
    kind: "task",
    title: "write the quarterly report",
    notes: null,
    minutes: 90,
    importance: 4,
    category: "work",
    due: null,
    start_at: null,
    end_at: null,
    google_event_id: null,
    status: "open",
    pinned: false,
    created_at: "2026-08-29T01:00:00+00:00",
    score: 0.42,
    why: { due: 0, importance: 0.75, age: 0.1, quick: 0.6 },
    ...overrides,
  };
}

function planning(
  shortlist: Ranked[],
  scheduled: Item[],
  events: CalendarEvent[],
  sourceHealth: NonNullable<View["source_health"]> = [],
): PlanningSnapshot {
  const generatedAt = "2026-08-31T01:00:00+00:00";
  const commitments: PlanningSnapshot["commitments"] = [
    ...scheduled.map((item) => ({
      id: `cooper:${item.id}`,
      source: item.source === "gmail" ? "gmail" : "cooper",
      source_id: item.source_ref ?? item.id,
      aliases: [`cooper:${item.id}`],
      title: item.title,
      kind: item.kind,
      start_at: item.start_at ?? item.created_at,
      end_at: item.end_at ?? item.start_at ?? item.created_at,
      all_day: false,
      category: item.category,
      editable: item.source === "me",
      local_item_id: item.id,
      conflict: false,
      item: item.source === "me" ? item : undefined,
    })),
    ...events
      .filter((event) => !event.mine)
      .map((event) => ({
        id: `${event.source}:${event.event_id ?? event.start_at}`,
        source: event.source,
        source_id: event.event_id ?? null,
        aliases: [`${event.source}:${event.event_id ?? event.start_at}`],
        title: event.title,
        kind: "event" as const,
        start_at: event.start_at,
        end_at: event.end_at,
        all_day: event.all_day ?? false,
        category: event.category,
        editable: false,
        local_item_id: null,
        conflict: false,
        event,
      })),
  ];
  for (const commitment of commitments) {
    commitment.conflict = commitments.some(
      (other) =>
        other.id !== commitment.id &&
        new Date(other.start_at).getTime() < new Date(commitment.end_at).getTime() &&
        new Date(commitment.start_at).getTime() < new Date(other.end_at).getTime(),
    );
  }
  const generatedTime = Date.parse(generatedAt);
  const active = commitments.find(
    (commitment) =>
      Date.parse(commitment.start_at) <= generatedTime &&
      generatedTime < Date.parse(commitment.end_at),
  );
  const upcoming = commitments.find(
    (commitment) => Date.parse(commitment.start_at) > generatedTime,
  );
  const recommended = shortlist.find(
    (item) => item.start_at === null && item.minutes !== null && item.minutes > 0,
  );
  return {
    generated_at: generatedAt,
    today: "2026-08-31",
    timezone: "Asia/Singapore",
    complete: sourceHealth.every((source) => source.status === "ok"),
    source_health: sourceHealth,
    commitments,
    tasks: shortlist,
    focus: {
      now_id: active?.id ?? recommended?.id ?? null,
      next_id: upcoming?.id ?? null,
    },
    risks: [],
    metrics: {
      scheduled_count: commitments.length,
      occupied_minutes: 0,
      remaining_effort_minutes: shortlist.reduce((total, item) => total + (item.minutes ?? 0), 0),
      current_free_block_minutes: 0,
      largest_free_block_minutes: 0,
      conflict_count: 0,
    },
  };
}

function view(overrides: Partial<View> = {}): View {
  const merged = {
    now: "2026-08-31T01:00:00+00:00",
    today: "2026-08-31",
    timezone: "Asia/Singapore",
    shortlist: [ranked()],
    scheduled: [],
    hours: {
      start_hour: 9,
      end_hour: 18,
      weekdays: [0, 1, 2, 3, 4],
      max_per_day: 4,
    },
    events: [],
    undo: null,
    using_model: false,
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
  return {
    ...merged,
    planning:
      overrides.planning ??
      planning(merged.shortlist, merged.scheduled, merged.events, merged.source_health ?? []),
  };
}

function reply(overrides: Partial<Reply> = {}): Reply {
  return {
    kind: "added",
    message: "Added “write the report”.",
    // The item is what the reply's meta line renders from, so it belongs in the fixture.
    item: ranked(),
    source: "rules",
    view: view(),
    ...overrides,
  };
}

test("Ask starts with only the first loading status active", () => {
  const steps = initialAgentSteps();

  expect(steps).toHaveLength(3);
  expect(steps.map((step) => step.icon)).toEqual(["spark", "search", "write"]);
  expect(steps.map((step) => step.status)).toEqual(["running", "pending", "pending"]);
});

/** Navigate from the dashboard to the conversation. */
async function openChat(user = userEvent.setup()) {
  await user.click((await screen.findAllByRole("button", { name: /Cooper/ }))[0]);
  return user;
}

/** Navigate to the AI conversation. */
async function openAi(user = userEvent.setup()) {
  await user.click((await screen.findAllByRole("button", { name: /Cooper/ }))[0]);
  await user.click(await screen.findByRole("button", { name: "Ask" }));
  return user;
}

interface Routes {
  itemError?: string;
  view?: View;
  todayView?: View;
  today?: View | { status: number; detail: string };
  say?: Reply | { status: number; detail: string };
  move?: Reply | { status: number; detail: string };
  failView?: boolean;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (!body) return {};
  const parsed: unknown = JSON.parse(String(body));
  return isJsonObject(parsed) ? parsed : {};
}

function stub(routes: Routes) {
  const calls: Array<{
    url: string;
    method: string;
    headers: Headers;
    body: Record<string, unknown>;
  }> = [];
  const json = (payload: unknown, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: requestBody(init?.body),
      });

      const currentView = routes.view ?? view();
      const loadedView = routes.today ?? routes.todayView ?? currentView;
      const withView = (r: Reply): Reply => ({ ...r, view: currentView });

      if (url.includes("/api/today")) {
        if (routes.failView) return json({ detail: "connection refused" }, 500);
        return "status" in loadedView
          ? json({ detail: loadedView.detail }, loadedView.status)
          : json(loadedView);
      }
      if (url.includes("/api/say")) {
        const configured = routes.say ?? reply();
        return "status" in configured
          ? json({ detail: configured.detail }, configured.status)
          : json(withView(configured));
      }
      if (url.includes("/api/schedule")) {
        return json({ placed: [{ item_id: "a1" }], view: currentView });
      }
      if (url.endsWith("/move")) {
        const configured = routes.move ?? reply({ kind: "rescheduled", message: "Moved." });
        return "status" in configured
          ? json({ detail: configured.detail }, configured.status)
          : json(configured);
      }
      if (url.includes("/api/google/sync")) {
        return json({
          summary: { created: 0, updated: 0, dropped: 0, skipped: 0, error: null },
          view: currentView,
        });
      }
      if (url.includes("/api/icloud/")) {
        return json({ view: currentView });
      }
      if (url.includes("/api/undo")) {
        return json(withView(reply({ kind: "undone", message: "Undid: Added." })));
      }
      if (url.includes("/api/hours")) {
        return json({ view: currentView });
      }
      if (url.includes("/api/items/")) {
        return json(withView(reply({ kind: "completed", message: "Completed." })));
      }
      if (url.endsWith("/api/items")) {
        if (routes.itemError) return json({ detail: routes.itemError }, 503);
        // Manual mode's form add: same Reply shape as a parsed add.
        return json(withView(reply({ kind: "added", message: "Added “write the report”." })));
      }
      return json({});
    }),
  );
  return calls;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app");
  vi.stubEnv("VITE_COOPER_KEY", "test-key");
  firebaseMock.authMode = "local";
  firebaseMock.configured = false;
  firebaseMock.currentUser = null;
  firebaseMock.observer = null;
  firebaseMock.signInWithGoogle.mockClear();
  firebaseMock.signOutUser.mockClear();
  firebaseMock.unsubscribe.mockClear();
  // The conversation persists in localStorage, so each test starts from an empty one.
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function firebaseUser(token: string, email = "friend@example.com", uid = token): TestFirebaseUser {
  return {
    uid,
    email,
    getIdToken: vi.fn(async () => token),
  };
}

async function emitFirebaseUser(user: TestFirebaseUser | null): Promise<void> {
  firebaseMock.currentUser = user;
  await act(async () => {
    firebaseMock.observer?.(user);
  });
}

describe("first impression", () => {
  test("desktop sidebar collapses, persists, and keeps navigation available", async () => {
    const user = userEvent.setup();
    stub({});
    const first = render(<App />);

    const hideSidebar = await screen.findByRole("button", { name: "Hide sidebar" });
    await user.click(hideSidebar);

    expect(screen.getByRole("button", { name: "Show sidebar" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(document.querySelector(".app")).toHaveClass("app--rail-collapsed");
    expect(localStorage.getItem("cooper.sidebar.collapsed.v1")).toBe("1");
    expect(screen.getAllByRole("button", { name: "Calendar" }).length).toBeGreaterThan(0);

    first.unmount();
    render(<App />);

    expect(await screen.findByRole("button", { name: "Show sidebar" })).toBeInTheDocument();
    expect(document.querySelector(".app")).toHaveClass("app--rail-collapsed");
  });

  test("does not interrupt a local user who already has an item", async () => {
    stub({});
    render(<App />);

    expect(await screen.findByText("Now")).toBeInTheDocument();
    expect(screen.queryByText("Cooper guide")).not.toBeInTheDocument();
  });

  test("local first-run guide follows Form and Settings and can be reopened", async () => {
    const user = userEvent.setup();
    stub({ view: view({ shortlist: [], scheduled: [] }) });
    render(<App />);

    expect(await screen.findByRole("region", { name: "Add your first item" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open Form" }));
    expect(screen.getByRole("textbox", { name: "What" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(screen.getByLabelText("Gemini API key")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Skip tutorial" }));
    expect(screen.queryByRole("region", { name: "Set up Ask" })).not.toBeInTheDocument();
    expect(localStorage.getItem("cooper.onboarding.done.v1:local")).toBe("1");

    await user.click(screen.getByRole("button", { name: "Show getting-started guide" }));
    expect(screen.getByRole("region", { name: "Add your first item" })).toBeInTheDocument();
  });

  test("local root opens the public landing surface", () => {
    window.history.replaceState({}, "", "/");
    const calls = stub({});

    render(<App />);

    expect(screen.getByRole("heading", { name: "Hi, I’m Cooper." })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
  });

  test("shows a dashboard skeleton while today is loading", async () => {
    let resolveToday!: (response: Response) => void;
    const pendingToday = new Promise<Response>((resolve) => {
      resolveToday = resolve;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes("/api/today")) return pendingToday;
        return new Response(JSON.stringify({}), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    render(<App />);

    const loading = screen.getByRole("status", { name: "Loading Cooper’s day" });
    expect(loading).toHaveAttribute("aria-busy", "true");
    expect(loading.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    expect(screen.queryByText("Now")).not.toBeInTheDocument();

    resolveToday(
      new Response(JSON.stringify(view()), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    expect(await screen.findByText("Now")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading Cooper’s day" })).not.toBeInTheDocument();
  });

  test("opens on the dashboard, not the conversation", async () => {
    stub({});
    render(<App />);

    // Seeing the day should not require asking for it, so the chat is no longer the front door.
    expect(await screen.findByText("Now")).toBeInTheDocument();
    const nav = screen.getAllByRole("navigation", { name: "Sections" })[0];
    expect(within(nav).getByRole("button", { name: /Home/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("AI mode offers real questions to try", async () => {
    stub({ view: view({ shortlist: [], using_model: true }) });
    render(<App />);
    await openAi();

    // Manual is a form now, so the sentence examples live under AI, and they are questions.
    expect(
      await screen.findByRole("button", { name: /what should I focus on/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /what should I work on next/i })).toBeInTheDocument();
  });

  test("empty AI chat uses a different mascot from empty Home", async () => {
    stub({ view: view({ shortlist: [], using_model: true }) });
    render(<App />);

    expect(await screen.findByText("Nothing on today")).toBeInTheDocument();
    expect(document.querySelector(".empty .mascot")).toHaveAttribute(
      "src",
      "/assets/mascot/cooper_waving.webp",
    );

    await openAi();

    expect(document.querySelector(".opening .mascot")).toHaveAttribute(
      "src",
      "/assets/mascot/cooper_thinking.webp",
    );
  });

  test.each([
    ["What should I focus on this week?", "focus_week"],
    ["How much is left on my plate today?", "remaining_today"],
    ["What should I work on next?", "work_next"],
    ["Can I fit a two-hour focus session today?", "fit_duration"],
  ])("suggested question %s sends intent %s", async (label, intent) => {
    const calls = stub({ view: view({ shortlist: [], using_model: true }) });
    render(<App />);
    const user = await openAi();

    await user.click(await screen.findByRole("button", { name: label }));

    await waitFor(() => {
      const said = calls.find((call) => call.url.includes("/api/say"));
      expect(said?.body.mode).toBe("ai");
      expect(said?.body.intent).toBe(intent);
    });
  });

  test("a dead backend says so instead of looking empty", async () => {
    stub({ failView: true });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Cooper isn’t running");
  });

  test("local mode keeps the shared key header", async () => {
    const calls = stub({});

    render(<App />);

    expect(await screen.findByText("Now")).toBeInTheDocument();
    expect(calls[0]?.headers.get("X-Cooper-Key")).toBe("test-key");
    expect(calls[0]?.headers.has("Authorization")).toBe(false);
  });

  test("Firebase mode waits for auth before loading protected data", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    const calls = stub({});

    render(<App />);

    expect(screen.getByRole("heading", { name: "Checking your account." })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Checking Firebase account" })).toBeInTheDocument();
    expect(calls).toHaveLength(0);

    await emitFirebaseUser(null);

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  test("signed-out Firebase users can start Google sign-in", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    const calls = stub({});

    render(<App />);
    await emitFirebaseUser(null);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(firebaseMock.signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(0);
    expect(screen.queryByRole("navigation", { name: "Sections" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(document.querySelector(".auth-page__note .mascot")).toHaveAttribute(
      "src",
      "/assets/mascot/cooper_waving.webp",
    );
  });

  test("signed-in Firebase requests use the bearer token", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    const calls = stub({});

    render(<App />);
    await emitFirebaseUser(firebaseUser("firebase-id-token"));

    expect(await screen.findByText("Now")).toBeInTheDocument();
    expect(calls[0]?.headers.get("Authorization")).toBe("Bearer firebase-id-token");
    expect(calls[0]?.headers.has("X-Cooper-Key")).toBe(false);
  });

  test("an expired Firebase token returns to sign-in", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    stub({ today: { status: 401, detail: "Invalid authentication token" } });

    render(<App />);
    await emitFirebaseUser(firebaseUser("expired-token"));

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(firebaseMock.signOutUser).toHaveBeenCalledTimes(1);
  });

  test("Firebase sign-out uses client auth only", async () => {
    firebaseMock.authMode = "firebase";
    firebaseMock.configured = true;
    stub({});

    render(<App />);
    await emitFirebaseUser(firebaseUser("firebase-id-token", "friend@example.com"));
    await userEvent.setup().click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    expect(await screen.findByText("friend@example.com")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Sign out" }));

    expect(firebaseMock.signOutUser).toHaveBeenCalledTimes(1);
  });

  test("offline parsing is stated under settings without alarm", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    expect(await screen.findByText("Offline rules")).toBeInTheDocument();
    expect(screen.getByText(/Add a Gemini API key to talk to Cooper/)).toBeInTheDocument();
  });

  test("saves a Gemini key in this browser and reports AI as available", async () => {
    const calls = stub({ view: view({ using_model: false }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    const key = await screen.findByLabelText("Gemini API key");
    await user.type(key, "AIza-browser-key");

    expect(localStorage.getItem("cooper.gemini_key.v1")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(localStorage.getItem("cooper.gemini_key.v1")).toBe("AIza-browser-key");
    expect(screen.getByRole("status")).toHaveTextContent("Ask is ready to use");
    await user.click((await screen.findAllByRole("button", { name: /Cooper/ }))[0]);
    expect(await screen.findByRole("button", { name: "Ask" })).not.toBeDisabled();
    expect(calls.every((call) => !call.body?.gemini_api_key)).toBe(true);
  }, 10_000);

  test("does not save an empty Gemini key", async () => {
    stub({});
    const user = await userEvent.setup();
    render(<App />);

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);
    await user.click(await screen.findByRole("button", { name: "Save" }));

    expect(localStorage.getItem("cooper.gemini_key.v1")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a Gemini API key");
  });
});

describe("manual and ai", () => {
  /** The tone class is the colour, so asserting it asserts what the user sees. */
  function bubbleTones(): string[] {
    return Array.from(document.querySelectorAll(".bubble")).flatMap((node) =>
      Array.from(node.classList).filter((name) => name.startsWith("bubble--")),
    );
  }

  test("manual is the mode you start in", async () => {
    stub({});
    render(<App />);
    await openChat();

    expect(await screen.findByRole("button", { name: "Form" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Ask" })).toHaveAttribute("aria-pressed", "false");
    // Manual is also what an omitted mode means on the wire, so the two cannot drift apart.
  });

  test("manual mode says so on the wire", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cooper"), "write the report{Enter}");

    const said = calls.find((call) => call.url.includes("/api/say"));
    expect(said?.body).toEqual({ text: "write the report", mode: "manual" });
  });

  test("choosing AI sends the next message in AI mode", async () => {
    const calls = stub({ view: view({ using_model: true }) });
    render(<App />);
    const user = await openChat();

    await user.click(await screen.findByRole("button", { name: "Ask" }));
    await user.type(screen.getByLabelText("Say something to Cooper"), "what is urgent{Enter}");

    expect(calls.find((call) => call.url.includes("/api/say"))?.body.mode).toBe("ai");
  });

  test("sends the browser key only with an AI sentence", async () => {
    const calls = stub({ view: view({ using_model: false }) });
    localStorage.setItem("cooper.gemini_key.v1", "AIza-browser-key");
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "what is next{Enter}");

    expect(calls.find((call) => call.url.includes("/api/say"))?.body).toEqual({
      text: "what is next",
      mode: "ai",
      gemini_api_key: "AIza-browser-key",
    });
  });

  test("does not discard saved AI mode before model availability loads", async () => {
    localStorage.setItem("cooper.mode.v1", "ai");
    stub({ view: view({ using_model: true }) });
    render(<App />);
    await openChat();

    expect(await screen.findByRole("button", { name: "Ask" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("clearing a browser key refreshes deployment model availability", async () => {
    const calls = stub({
      view: view({ using_model: true }),
      todayView: view({ using_model: false }),
    });
    localStorage.setItem("cooper.gemini_key.v1", "AIza-browser-key");
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "add a note{Enter}");
    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);
    expect(screen.getByText("this browser")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Clear" }));
    await user.click((await screen.findAllByRole("button", { name: /Cooper/ }))[0]);

    await waitFor(() => expect(screen.getByRole("button", { name: "Ask" })).not.toBeDisabled());
    expect(calls.filter((call) => call.url.includes("/api/today")).length).toBeGreaterThan(1);
  });

  test("with no model key, AI cannot be chosen", async () => {
    // The app has to work with no key at all, so the switch disables rather than failing later.
    stub({ view: view({ using_model: false }) });
    render(<App />);
    await openChat();

    expect(await screen.findByRole("button", { name: "Ask" })).not.toBeDisabled();
  });

  test("an answer is blue, not an action", async () => {
    stub({
      view: view({ using_model: true }),
      say: reply({ kind: "answered", message: "Start with the report." }),
    });
    render(<App />);
    const user = await openChat();

    await user.click(await screen.findByRole("button", { name: "Ask" }));
    await user.type(screen.getByLabelText("Say something to Cooper"), "what is urgent{Enter}");
    await screen.findByText("Start with the report.");

    expect(bubbleTones()).toContain("bubble--answer");
  });

  test("creating is green and dropping is red", async () => {
    stub({ view: view({ using_model: true }) });
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "write the report{Enter}");
    await screen.findByText(/Added/);
    expect(bubbleTones()).toContain("bubble--good");

    stub({
      view: view({ using_model: true }),
      say: reply({ kind: "dropped", message: "Dropped “the report”." }),
    });
    await user.type(screen.getByLabelText("Say something to Cooper"), "drop the report{Enter}");
    await screen.findByText(/Dropped/);
    expect(bubbleTones()).toContain("bubble--bad");
  });

  test("completing is green, because green is not just for new things", async () => {
    stub({
      view: view({ using_model: true }),
      say: reply({ kind: "completed", message: "Completed “the report”." }),
    });
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "done report{Enter}");
    await screen.findByText(/Completed/);

    expect(bubbleTones()).toContain("bubble--good");
  });

  test("a question wants your attention rather than celebrating", async () => {
    stub({
      view: view({ using_model: true }),
      say: { status: 409, detail: "“review” matches 2 items" },
    });
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "done review{Enter}");
    await screen.findByText(/matches 2 items/);

    expect(bubbleTones()).toContain("bubble--attention");
  });
});

describe("appearance", () => {
  /** The picker lives under Settings, so every test has to get there first. */
  async function openSettings() {
    const user = userEvent.setup();
    render(<App />);
    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);
    return user;
  }

  test("light is what you get before you choose anything", async () => {
    stub({});
    render(<App />);
    await screen.findByText("Now");

    // Only ever "light" or "dark" reaches the CSS. "System" is resolved before it gets there.
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  test("dark applies at once and is remembered", async () => {
    stub({});
    const user = await openSettings();

    await user.click(await screen.findByRole("button", { name: "Dark" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("cooper.appearance.v1")).toBe("dark");
  });

  test("system asks the machine, and the machine says dark", async () => {
    stub({});
    // jsdom reports no preference, so the dark preference has to be stubbed to test the branch.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("dark"),
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    const user = await openSettings();

    await user.click(await screen.findByRole("button", { name: "System" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("cooper.appearance.v1")).toBe("system");
  });

  test("the chosen option is the pressed one", async () => {
    stub({});
    const user = await openSettings();

    await user.click(await screen.findByRole("button", { name: "Dark" }));

    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "false");
  });

  test.each(["/", "/login", "/signup", "/terms", "/privacy"])(
    "%s stays light even with dark saved",
    async (path) => {
      localStorage.setItem("cooper.appearance.v1", "dark");
      window.history.replaceState({}, "", path);
      stub({});

      render(<App />);
      await waitFor(() => {
        expect(document.documentElement.dataset.theme).toBe("light");
      });
    },
  );
});

describe("the conversation", () => {
  test("the thread says who you are talking to", async () => {
    stub({});
    render(<App />);
    await openChat();

    // The chat tab names its correspondent the way a messages app does: face, then name.
    const who = document.querySelector(".who");
    expect(who).not.toBeNull();
    expect(who?.textContent).toBe("Cooper");
    expect(who?.querySelector('img[src*="cooper_avatar"]')).not.toBeNull();
  });

  test("your sentence appears as your own turn", async () => {
    stub({ view: view({ using_model: true }) });
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "write the report{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText("write the report")).toBeInTheDocument();
  });

  test("Cooper answers, and shows what he understood", async () => {
    stub({ view: view({ using_model: true }) });
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "write the report{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText(/Added/)).toBeInTheDocument();
    // What it understood now sits inside the reply itself rather than on a separate white card,
    // which read as a second message from Cooper.
    expect(within(log).getByText(/Task · work · 90 min/)).toBeInTheDocument();
  });

  test("asking what to do gets answered in the conversation", async () => {
    stub({
      view: view({ using_model: true }),
      say: reply({
        kind: "answered",
        message: "Work on write the quarterly report next because it is marked important.",
        facts: ["write the quarterly report · marked important"],
      }),
    });
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "what should i do{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText(/Work on write the quarterly report next/)).toBeInTheDocument();
    expect(
      within(log).getByText("write the quarterly report · marked important"),
    ).toBeInTheDocument();
    expect(within(log).queryByText(/Start with/)).not.toBeInTheDocument();
  });

  test("the field clears after sending", async () => {
    stub({ view: view({ using_model: true }) });
    render(<App />);
    const user = await openAi();
    const field = screen.getByLabelText("Say something to Cooper");

    await user.type(field, "write the report{Enter}");

    await waitFor(() => expect(field).toHaveValue(""));
  });

  test("send is disabled until something is typed", async () => {
    stub({});
    render(<App />);

    expect(await screen.findByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("an ambiguous reference comes back as a question in the conversation", async () => {
    stub({
      view: view({ using_model: true }),
      say: { status: 409, detail: "“review” matches 2 items: review a, review b" },
    });
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "done review{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText(/matches 2 items/)).toBeInTheDocument();
  });

  test("no dialog ever interrupts the conversation", async () => {
    stub({ view: view({ using_model: true }) });
    render(<App />);
    const user = await openAi();

    await user.type(screen.getByLabelText("Say something to Cooper"), "write it{Enter}");
    await screen.findByRole("log", { name: "Conversation" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("the conversation survives a reload", async () => {
    stub({ view: view({ using_model: true }) });
    const first = render(<App />);
    const user = await openAi();
    await user.type(screen.getByLabelText("Say something to Cooper"), "write the report{Enter}");
    await screen.findByRole("log", { name: "Conversation" });
    first.unmount();

    render(<App />);
    await openAi();

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText("write the report")).toBeInTheDocument();
  });

  test("the composer is reachable by shortcut", async () => {
    stub({ view: view({ using_model: true }) });
    render(<App />);
    const user = await openAi();
    const field = screen.getByLabelText("Say something to Cooper");
    field.blur();

    await user.keyboard("{Meta>}k{/Meta}");

    expect(field).toHaveFocus();
  });
});

describe("the list", () => {
  test("a row opens a frame with the whole task in it", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(
      (await screen.findAllByRole("button", { name: /Open .*quarterly report/ }))[0],
    );

    const frame = await screen.findByRole("dialog", { name: "write the quarterly report" });
    // The facts that were spread across tags in the row are spelled out here.
    expect(within(frame).getByText("90 minutes")).toBeInTheDocument();
  });

  test("the frame covers the whole window, not a column of it", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Open .* quarterly/ }))[0]);

    const backdrop = document.querySelector(".frame");
    expect(backdrop?.parentElement).toBe(document.body);
    expect(backdrop?.closest(".scroll, .chat, .thread, .main")).toBeNull();
  });

  test("the frame closes on Escape and on the backdrop", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Open .* quarterly/ }))[0]);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("completing a task calls the backend", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Mark .* done/ }))[0]);

    await waitFor(() => expect(calls.some((call) => call.url.includes("/complete"))).toBe(true));
  });

  test("pinning happens in the frame, and calls the backend", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Open .* quarterly/ }))[0]);

    await user.click(await screen.findByRole("button", { name: "Pin" }));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/pin"))).toBe(true));
  });

  test("an overdue task is called out", async () => {
    stub({ view: view({ shortlist: [ranked({ due: "2020-01-01T00:00:00+00:00" })] }) });
    render(<App />);

    expect(await screen.findAllByText("overdue")).not.toHaveLength(0);
  });

  test("a booked task shows its time on the calendar tab", async () => {
    const booked: Item = {
      ...ranked(),
      id: "b1",
      title: "review the budget",
      start_at: "2026-08-31T02:00:00+00:00",
      end_at: "2026-08-31T03:00:00+00:00",
    };
    stub({ view: view({ scheduled: [booked] }) });
    render(<App />);
    const user = userEvent.setup();

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /Loading Cooper/i })).not.toBeInTheDocument();
    });
    await user.click((await screen.findAllByRole("button", { name: /Calendar/ }))[0]);

    expect(await screen.findByText("review the budget")).toBeInTheDocument();
  });

  test("leftover work can still be sent to the calendar", async () => {
    const calls = stub({ view: view({ shortlist: [ranked({ minutes: 45, start_at: null })] }) });
    render(<App />);
    const user = userEvent.setup();

    // On Home, an unbooked sized task offers "Plan my day" in the waiting-for-a-time section.
    await user.click(await screen.findByRole("button", { name: /Plan my day/ }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/api/schedule"))).toBe(true),
    );
  });
});

describe("undo", () => {
  test("undo history does not add controls to desktop or mobile navigation", async () => {
    stub({ view: view({ undo: "Added “write the report”" }) });
    render(<App />);
    await screen.findByText("Now");

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    expect(document.querySelector(".rail__undo")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide sidebar" })).toBeInTheDocument();
  });
});

describe("working hours", () => {
  test("settings states the boundary", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    expect(
      await screen.findByText(/Nothing is ever booked outside these hours/),
    ).toBeInTheDocument();
  });

  test("changing the end hour saves it", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    await user.selectOptions(await screen.findByLabelText("Day ends at"), "17");

    await waitFor(() => {
      const put = calls.find((call) => call.method === "PUT");
      expect(put?.body.end_hour).toBe(17);
    });
  });

  test("toggling a day saves the new set", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    await user.click(await screen.findByRole("button", { name: "Sat" }));

    await waitFor(() => {
      const put = calls.find((call) => call.method === "PUT");
      expect(put?.body.weekdays).toEqual([0, 1, 2, 3, 4, 5]);
    });
  });
});

describe("navigation", () => {
  test("all three sections are reachable", async () => {
    stub({});
    render(<App />);

    const nav = (await screen.findAllByRole("navigation", { name: "Sections" }))[0];
    for (const label of ["Home", "Cooper", "Calendar", "Settings"]) {
      expect(within(nav).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  test("Cooper's rail groups the day tools and uses real icons", async () => {
    stub({ view: view({ using_model: true }) });
    render(<App />);

    const rail = (await screen.findAllByRole("navigation", { name: "Sections" }))[0];
    expect(within(rail).getByRole("group", { name: "Your day" })).toBeInTheDocument();
    expect(within(rail).getByRole("group", { name: "Settings" })).toBeInTheDocument();
    expect(within(rail).getByText("Your time, untangled")).toBeInTheDocument();
    expect(within(rail).getByRole("button", { name: "Cooper" }).querySelector("svg")).toBeTruthy();
  });

  test("both a rail and a tab bar exist, so CSS can choose", async () => {
    // Fluid layout with no width listener: the rail shows on wide screens, tabs on narrow.
    stub({});
    render(<App />);

    expect((await screen.findAllByRole("navigation", { name: "Sections" })).length).toBe(2);
  });

  test("each section counts its own contents", async () => {
    const booked = { ...ranked(), id: "b1", start_at: "2026-08-31T02:00:00+00:00" };
    stub({
      view: view({
        shortlist: [ranked()],
        scheduled: [booked],
        events: [
          {
            event_id: "g1",
            title: "Google meeting",
            start_at: "2026-08-31T01:00:00+00:00",
            end_at: "2026-08-31T01:30:00+00:00",
            category: "work",
            mine: false,
            source: "google",
          },
          {
            event_id: "g2",
            title: "Google class",
            start_at: "2026-08-31T03:00:00+00:00",
            end_at: "2026-08-31T04:00:00+00:00",
            category: "academics",
            mine: false,
            source: "google",
          },
          {
            event_id: "i1",
            title: "iCloud appointment",
            source: "icloud",
            start_at: "2026-08-31T05:00:00+00:00",
            end_at: "2026-08-31T06:00:00+00:00",
            category: "personal",
            mine: false,
          },
        ],
      }),
    });
    render(<App />);

    const nav = (await screen.findAllByRole("navigation", { name: "Sections" }))[0];
    expect(within(nav).getByRole("button", { name: /Home/ })).toHaveTextContent("1");
    expect(within(nav).getByRole("button", { name: /Calendar/ })).toHaveTextContent("4");
  });

  test("an empty home explains where things come from", async () => {
    stub({ view: view({ shortlist: [], scheduled: [] }) });
    render(<App />);

    // Home is the landing screen, so no navigation is needed to see the empty state.
    expect(await screen.findByText("Nothing on today")).toBeInTheDocument();
  });
});

describe("the calendar", () => {
  test("shows every hour and shades an overnight custom window on both days", async () => {
    stub({
      view: view({
        scheduled: [
          {
            ...ranked(),
            id: "overnight",
            start_at: "2026-08-31T14:00:00+00:00",
            end_at: "2026-08-31T15:00:00+00:00",
          },
        ],
        hours: {
          start_hour: 9,
          end_hour: 18,
          weekdays: [0, 1, 2, 3, 4],
          max_per_day: 4,
          windows: [[0, 1320, 120]],
        },
      }),
    });
    render(<App />);
    const user = await openCalendar();
    const rows = () => [...document.querySelectorAll(".daygrid__row")];
    const open = (hour: number) => rows()[hour]?.querySelector(".daygrid__slot--open") !== null;

    expect(rows()).toHaveLength(24);
    expect(open(0)).toBe(false);
    expect(open(22)).toBe(true);
    expect(open(23)).toBe(true);

    await user.click(screen.getByRole("button", { name: "Next day" }));
    expect(open(0)).toBe(true);
    expect(open(1)).toBe(true);
    expect(open(2)).toBe(false);
  });

  function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
      title: "Standup with the team",
      start_at: "2026-08-31T01:00:00+00:00",
      end_at: "2026-08-31T01:15:00+00:00",
      category: "personal",
      mine: false,
      source: "google",
      ...overrides,
    };
  }

  async function openCalendar() {
    const user = userEvent.setup();
    // Wait for /api/today before switching tabs. Under CI load, clicking Calendar while the
    // skeleton is up leaves an empty calendar pane and flakes the assertions below.
    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /Loading Cooper/i })).not.toBeInTheDocument();
    });
    await user.click((await screen.findAllByRole("button", { name: /Calendar/ }))[0]);
    await waitFor(() => {
      expect(screen.queryByRole("status", { name: /Loading Cooper/i })).not.toBeInTheDocument();
    });
    return user;
  }

  test("an empty calendar says how to fill it", async () => {
    stub({});
    render(<App />);

    await openCalendar();

    expect(await screen.findByText("Nothing on the calendar")).toBeInTheDocument();
  });

  test("warns when a connected calendar is unavailable", async () => {
    stub({
      view: view({
        source_health: [{ source: "google", status: "unavailable" }],
      }),
    });
    render(<App />);
    await openCalendar();

    expect(
      screen.getByText("google calendar could not be refreshed. Imported events may be missing."),
    ).toBeInTheDocument();
  });

  test("keeps an imported overlap visible beside Cooper's block", async () => {
    const booked = {
      ...ranked(),
      id: "b1",
      start_at: "2026-08-31T01:00:00+00:00",
      end_at: "2026-08-31T02:00:00+00:00",
    };
    stub({ view: view({ scheduled: [booked], events: [event()] }) });
    render(<App />);
    await openCalendar();

    expect(screen.getByText("Overlaps another calendar item")).toBeInTheDocument();
  });

  test("your own Google events show up beside booked work", async () => {
    const booked = {
      ...ranked(),
      id: "b1",
      start_at: "2026-08-31T02:00:00+00:00",
      end_at: "2026-08-31T03:00:00+00:00",
    };
    stub({ view: view({ scheduled: [booked], events: [event()] }) });
    render(<App />);

    await openCalendar();

    expect(await screen.findByText("Standup with the team")).toBeInTheDocument();
    expect(screen.getByText("write the quarterly report")).toBeInTheDocument();
  });

  test("events Cooper created are not listed twice", async () => {
    // Our own blocks come back from Google too. `mine` marks them so only the local copy shows.
    const booked = {
      ...ranked(),
      id: "b1",
      title: "write the report",
      start_at: "2026-08-31T02:00:00+00:00",
      end_at: "2026-08-31T03:00:00+00:00",
    };
    stub({
      view: view({
        scheduled: [booked],
        events: [
          event({
            title: "write the report",
            mine: true,
            start_at: "2026-08-31T02:00:00+00:00",
            end_at: "2026-08-31T03:00:00+00:00",
          }),
        ],
      }),
    });
    render(<App />);

    await openCalendar();

    expect(await screen.findAllByText("write the report")).toHaveLength(1);
  });

  test("the category decides the colour, not the source", async () => {
    // Four categories, four colours. The class is what the stylesheet hangs the colour on, so
    // it is the thing worth asserting.
    const study = {
      ...ranked(),
      id: "s1",
      title: "revise for the midterm",
      category: "academics" as const,
      start_at: "2026-08-31T02:00:00+00:00",
      end_at: "2026-08-31T03:00:00+00:00",
    };
    stub({ view: view({ scheduled: [study], events: [event({ category: "organizations" })] }) });
    render(<App />);

    await openCalendar();

    expect((await screen.findByText("revise for the midterm")).closest(".slot")).toHaveClass(
      "cat--academics",
    );
    expect(screen.getByText("Standup with the team").closest(".slot")).toHaveClass(
      "cat--organizations",
    );
  });

  test("you can look at a week or a month instead of a day", async () => {
    const booked = {
      ...ranked(),
      id: "b1",
      start_at: "2026-08-31T02:00:00+00:00",
      end_at: "2026-08-31T03:00:00+00:00",
    };
    stub({ view: view({ scheduled: [booked] }) });
    render(<App />);
    const user = await openCalendar();

    // A day is the default, so the range reads as a day.
    expect(await screen.findByText("Today")).toBeInTheDocument();
    // Today is on screen, so there is nothing to jump back to.
    expect(screen.queryByRole("button", { name: "Today" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Month" }));
    expect(await screen.findByText("August 2026")).toBeInTheDocument();
    expect(
      [...document.querySelectorAll(".monthgrid__head")].map((node) => node.textContent),
    ).toEqual(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]);
    // A month cell says how much is on that day without showing times. The date part of the
    // label is locale-ordered, so only the count is worth asserting on.
    expect(screen.getByRole("button", { name: /1 thing$/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Week" }));
    // Seven columns, one per day, each a way into that day.
    expect(document.querySelectorAll(".weekgrid__head")).toHaveLength(7);
  });

  test("a month cell opens that day in a frame", async () => {
    // A month cell has no room for a title on a phone, so the frame is where the detail lives.
    // It replaced a panel under the grid, which pushed the calendar around as you tapped.
    const booked = {
      ...ranked(),
      id: "b1",
      start_at: "2026-08-31T02:00:00+00:00",
      end_at: "2026-08-31T03:00:00+00:00",
    };
    stub({ view: view({ scheduled: [booked] }) });
    render(<App />);
    const user = await openCalendar();
    await user.click(await screen.findByRole("button", { name: "Month" }));

    await user.click(screen.getAllByRole("button", { name: /1 thing$/ })[0]);
    const frame = await screen.findByRole("dialog");
    expect(frame.textContent).toContain("write the quarterly report");

    // Nothing is left behind on the page: closing puts you back on the grid.
    await user.click(within(frame).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // A day with nothing on it says so rather than showing the last day you looked at.
    await user.click(screen.getAllByRole("button", { name: /0 things$/ })[0]);
    expect((await screen.findByRole("dialog")).textContent).toContain("Nothing on this day");
  });

  test.each(["google", "icloud"] as const)(
    "Month opens only one %s detail dialog",
    async (source) => {
      stub({
        view: view({
          events: [
            {
              title: "Source event",
              source,
              category: "work",
              mine: false,
              start_at: "2026-08-31T02:00:00Z",
              end_at: "2026-08-31T03:00:00Z",
            },
          ],
        }),
      });
      render(<App />);
      const user = await openCalendar();
      await user.click(screen.getByRole("button", { name: "Month" }));
      await user.click(screen.getAllByRole("button", { name: /1 thing$/ })[0]);
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: /Source event/ }),
      );
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("dialog")).toHaveAccessibleName("Source event");
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("button", { name: "Open this day" })).toBeInTheDocument();
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
      expect(document.body.style.overflow).not.toBe("hidden");
    },
  );

  test("stepping away from today, and coming back", async () => {
    stub({
      view: view({
        scheduled: [
          {
            ...ranked(),
            start_at: "2026-08-31T02:00:00+00:00",
            end_at: "2026-08-31T03:00:00+00:00",
          },
        ],
      }),
    });
    render(<App />);
    const user = await openCalendar();

    await user.click(await screen.findByRole("button", { name: "Next day" }));
    expect(screen.getByText("Tomorrow")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Previous day" }));
    await user.click(screen.getByRole("button", { name: "Previous day" }));
    expect(screen.getByText("Yesterday")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  test("a Google event is marked as coming from Google", async () => {
    stub({ view: view({ scheduled: [], events: [event()] }) });
    render(<App />);

    await openCalendar();

    expect(await screen.findByText("Google")).toBeInTheDocument();
  });

  test("without Google it says it is using its own calendar", async () => {
    const booked = { ...ranked(), id: "b1", start_at: "2026-08-31T02:00:00+00:00" };
    stub({ view: view({ scheduled: [booked] }) });
    render(<App />);

    await openCalendar();

    expect(await screen.findByText(/On this device/)).toBeInTheDocument();
  });

  test("a booked block opens its frame, and Done completes it there", async () => {
    const booked = {
      ...ranked(),
      id: "b1",
      start_at: "2026-08-31T02:00:00+00:00",
      end_at: "2026-08-31T03:00:00+00:00",
    };
    const calls = stub({ view: view({ scheduled: [booked] }) });
    render(<App />);
    const user = await openCalendar();

    await user.click((await screen.findAllByRole("button", { name: /quarterly report/ }))[0]);
    await user.click(await screen.findByRole("button", { name: "Done" }));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/complete"))).toBe(true));
  });

  test("the legend explains what the shading and outlines mean", async () => {
    const booked = { ...ranked(), id: "b1", start_at: "2026-08-31T02:00:00+00:00" };
    stub({ view: view({ scheduled: [booked] }) });
    render(<App />);

    await openCalendar();

    expect(await screen.findByText(/Shaded hours are yours to book/)).toBeInTheDocument();
  });
});

describe("google calendar", () => {
  test("an unconfigured calendar says so under settings", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    expect(await screen.findByText("Not set up")).toBeInTheDocument();
  });

  test("configured but unconnected offers to connect", async () => {
    stub({ view: view({ calendar: { configured: true, connected: false, email: null } }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Google" })).toBeInTheDocument();
  });

  test("a connected calendar is named", async () => {
    const booked: Item = { ...ranked(), start_at: "2026-08-31T02:00:00+00:00" };
    stub({
      view: view({
        scheduled: [booked],
        calendar: { configured: true, connected: true, email: "me@example.com" },
      }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Calendar/ }))[0]);

    expect(await screen.findByText(/Connected to me@example.com/)).toBeInTheDocument();
  });
});

describe("icloud calendar", () => {
  test("submits the app-specific password without storing it in the browser", async () => {
    const calls = stub({
      view: view({
        icloud: { configured: true, connected: false, email: null, error: null },
      }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);
    await user.type(await screen.findByLabelText("Apple ID"), "owner@icloud.com");
    await user.type(screen.getByLabelText("App-specific password"), "secret-password");
    await user.click(screen.getByRole("button", { name: "Connect iCloud" }));

    await waitFor(() => {
      const request = calls.find((call) => call.url.includes("/api/icloud/connect"));
      expect(request?.body).toEqual({
        email: "owner@icloud.com",
        password: "secret-password",
      });
    });
    expect(screen.getByLabelText("App-specific password")).toHaveValue("");
    expect(JSON.stringify(localStorage)).not.toContain("secret-password");
  });
});

describe("gmail confirmations", () => {
  function withGmail(viewValue: View, gmail: GmailHealthFixture): View {
    return { ...viewValue, gmail } as View;
  }

  function gmailItem(overrides: Partial<Item> = {}): Item {
    return {
      ...ranked(),
      id: "gmail-1",
      kind: "event",
      title: "Design conference",
      minutes: null,
      start_at: "2026-08-31T04:00:00+00:00",
      end_at: "2026-08-31T05:00:00+00:00",
      source: "gmail",
      source_ref: "event-1",
      ...overrides,
    } as Item;
  }

  test("settings explains when Gmail is offline and unconfigured", async () => {
    stub({
      view: withGmail(view(), {
        configured: false,
        connected: false,
        last_checked: null,
        last_error: null,
        imported: 0,
        skipped: 0,
      }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    expect(await screen.findByText("Gmail confirmations")).toBeInTheDocument();
    expect(screen.getByText(/Not configured/)).toBeInTheDocument();
    expect(screen.getByText(/works without Google/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDisabled();
  });

  test("a connected Gmail account can be synced from settings", async () => {
    const calls = stub({
      view: withGmail(
        view({ calendar: { configured: true, connected: true, email: "me@example.com" } }),
        {
          configured: true,
          connected: true,
          last_checked: null,
          last_error: null,
          imported: 0,
          skipped: 0,
        },
      ),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);
    await user.click(await screen.findByRole("button", { name: "Sync now" }));

    await waitFor(() => {
      expect(
        calls.some((call) => call.url.includes("/api/google/sync") && call.method === "POST"),
      ).toBe(true);
    });
  });

  test("settings shows Gmail's last check and isolated errors", async () => {
    stub({
      view: withGmail(view(), {
        configured: true,
        connected: true,
        last_checked: "2026-08-30T05:10:00+00:00",
        last_error: "Gmail could not be reached.",
        imported: 2,
        skipped: 1,
      }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    expect(await screen.findByText(/Last checked/)).toBeInTheDocument();
    expect(screen.getByText("Gmail could not be reached.")).toBeInTheDocument();
    expect(screen.getByText(/2 imported/)).toBeInTheDocument();
  });

  test("future sources are listed as coming soon under settings", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    for (const label of ["Microsoft Teams", "Google Classroom"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
  });

  test("Gmail commitments are outlined and read-only on the dashboard", async () => {
    const item = gmailItem();
    stub({
      view: withGmail(view({ shortlist: [item as Ranked], scheduled: [item] }), {
        configured: true,
        connected: true,
        last_checked: null,
        last_error: null,
        imported: 1,
        skipped: 0,
      }),
    });
    render(<App />);

    const agenda = await screen.findByRole("region", { name: "Today" });
    const title = within(agenda).getByText("Design conference");
    expect(title.closest("button")).toBeNull();
    expect(title.closest(".slot")).toHaveClass("slot--gmail");
    expect(title.closest(".slot")).toHaveTextContent("Gmail");
    expect(screen.queryByRole("button", { name: /Mark .* done/i })).not.toBeInTheDocument();
  });

  test("Gmail commitments stay read-only in Calendar", async () => {
    const item = gmailItem({ title: "Gmail meetup" });
    stub({
      view: withGmail(view({ shortlist: [], scheduled: [item] }), {
        configured: true,
        connected: true,
        last_checked: null,
        last_error: null,
        imported: 1,
        skipped: 0,
      }),
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Calendar/ }))[0]);

    const title = await screen.findByText("Gmail meetup");
    expect(title.closest("button")).toBeNull();
    expect(title.closest(".slot")).toHaveClass("slot--gmail");
    expect(title.closest(".slot")).toHaveTextContent("Gmail");
    expect(screen.queryByRole("button", { name: /Done/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });
});

describe("the mascot", () => {
  test("the wordmark is real text, so it reads in both themes", async () => {
    // The supplied logo webp has dark ink baked in and vanished on black. Text inherits the
    // theme colour instead, which is why this asserts text rather than an image.
    stub({});
    render(<App />);

    // Rendered twice on purpose: once in the top bar, once in the wide-screen rail.
    expect(document.querySelectorAll(".who__name")).toHaveLength(2);
  });

  test("header identity mascots fit beside the Cooper wordmark", async () => {
    stub({});
    render(<App />);

    await screen.findAllByText("Cooper");

    const identityMascots = document.querySelectorAll(".who .mascot");
    expect(identityMascots).toHaveLength(2);
    for (const mascot of identityMascots) {
      expect(mascot).toHaveClass("mascot--xs");
      expect(mascot).not.toHaveClass("mascot--sm");
    }
  });

  test("every mascot image resolves and is contained", async () => {
    stub({ view: view({ shortlist: [] }) });
    render(<App />);
    await screen.findByText("Nothing on today");

    // Decorative images carry alt="", which removes the img role, so query the DOM directly.
    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>('img[src*="/assets/mascot/"]'),
    );

    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.getAttribute("src")).toMatch(/\.webp$/);
      // Sizing lives in CSS, and the size class fixes the box so nothing shifts while loading.
      // There is no shape class: the art is cut out, so Cooper is never inside a chip.
      expect(image.className).toMatch(/mascot--(xs|sm|md|lg)/);
      expect(image.className).not.toMatch(/mascot--(round|squircle)/);
    }
  });
});

describe("the dashboard", () => {
  /** Create a timestamp on a local calendar day. */
  function atLocal(day: string, hour: number): string {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(year, month - 1, date, hour).toISOString();
  }

  const TODAY = "2026-08-31";
  const TOMORROW = "2026-09-01";

  /** A task that already has a time, which is what the strip is made of. */
  function block(overrides: Partial<Item>): Item {
    const start = overrides.start_at ?? atLocal(TODAY, 9);
    return {
      ...ranked(),
      start_at: start,
      end_at: new Date(new Date(start).getTime() + 3_600_000).toISOString(),
      ...overrides,
    };
  }

  function snapshotView(overrides: Partial<PlanningSnapshot>): View {
    const base = planning([], [], []);
    return view({
      shortlist: [],
      scheduled: [],
      events: [],
      planning: { ...base, ...overrides },
    });
  }

  test("Home uses snapshot focus as references to one Today agenda", async () => {
    const current = {
      ...block({ id: "current", title: "Team check-in", start_at: atLocal(TODAY, 9) }),
      source: "me" as const,
    };
    const next = {
      ...block({ id: "next", title: "Design review", start_at: atLocal(TODAY, 11) }),
      source: "me" as const,
    };
    stub({
      view: snapshotView({
        commitments: [
          {
            id: "cooper:current",
            source: "cooper",
            source_id: "current",
            aliases: ["cooper:current"],
            title: current.title,
            kind: "task",
            start_at: current.start_at!,
            end_at: current.end_at!,
            all_day: false,
            category: "work",
            editable: true,
            local_item_id: current.id,
            conflict: false,
            item: current,
          },
          {
            id: "cooper:next",
            source: "cooper",
            source_id: "next",
            aliases: ["cooper:next"],
            title: next.title,
            kind: "task",
            start_at: next.start_at!,
            end_at: next.end_at!,
            all_day: false,
            category: "work",
            editable: true,
            local_item_id: next.id,
            conflict: false,
            item: next,
          },
        ],
        focus: { now_id: "cooper:current", next_id: "cooper:next" },
      }),
    });
    render(<App />);

    expect(await screen.findByText("Now")).toBeInTheDocument();
    const nowReference = screen.getByRole("link", { name: "Now: Team check-in" });
    expect(nowReference).toHaveAttribute("href", "#agenda-cooper:current");
    expect(within(nowReference).getByText("Team check-in")).toBeVisible();
    expect(nowReference).toHaveTextContent("9:00 AM–10:00 AM");

    const nextReference = screen.getByRole("link", { name: "Next: Design review" });
    expect(nextReference).toHaveAttribute("href", "#agenda-cooper:next");
    expect(within(nextReference).getByText("Design review")).toBeVisible();
    expect(nextReference).toHaveTextContent("11:00 AM–12:00 PM");

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(document.querySelectorAll("#agenda-cooper\\:current")).toHaveLength(1);
    expect(document.querySelectorAll("#agenda-cooper\\:next")).toHaveLength(1);
  });

  test("Home surfaces a free-block recommendation from the snapshot", async () => {
    const task = ranked({ id: "proposal", title: "Draft the proposal", minutes: 45 });
    stub({
      view: snapshotView({
        tasks: [task],
        focus: { now_id: task.id, next_id: null },
        metrics: {
          scheduled_count: 0,
          occupied_minutes: 0,
          remaining_effort_minutes: 45,
          current_free_block_minutes: 90,
          largest_free_block_minutes: 90,
          conflict_count: 0,
        },
      }),
    });
    render(<App />);

    const nowReference = await screen.findByRole("link", { name: "Now: Draft the proposal" });
    expect(within(nowReference).getByText("Draft the proposal")).toBeVisible();
    expect(nowReference).toHaveTextContent("90 min free");
    expect(document.querySelectorAll("#task-proposal")).toHaveLength(1);
  });

  test("Home renders a mixed local and external snapshot agenda once", async () => {
    const local = block({ id: "local", title: "Write brief", start_at: atLocal(TODAY, 10) });
    const external: CalendarEvent = {
      event_id: "external",
      title: "Dentist appointment",
      start_at: atLocal(TODAY, 13),
      end_at: atLocal(TODAY, 14),
      category: "personal",
      mine: false,
      source: "google",
    };
    stub({
      view: snapshotView({
        commitments: [
          {
            id: "cooper:local",
            source: "cooper",
            source_id: local.id,
            aliases: ["cooper:local"],
            title: local.title,
            kind: "task",
            start_at: local.start_at!,
            end_at: local.end_at!,
            all_day: false,
            category: "work",
            editable: true,
            local_item_id: local.id,
            conflict: false,
            item: local,
          },
          {
            id: "google:external",
            source: "google",
            source_id: external.event_id!,
            aliases: ["google:external"],
            title: external.title,
            kind: "event",
            start_at: external.start_at,
            end_at: external.end_at,
            all_day: false,
            category: "personal",
            editable: false,
            local_item_id: null,
            conflict: false,
            event: external,
          },
        ],
        focus: { now_id: null, next_id: null },
      }),
    });
    render(<App />);

    const agenda = (await screen.findByText("Today")).closest("section") as HTMLElement;
    expect(within(agenda).getByText("Write brief")).toBeInTheDocument();
    expect(within(agenda).getByText("Dentist appointment")).toBeInTheDocument();
    expect(within(agenda).getByText("Google")).toBeInTheDocument();
  });

  test("Today includes commitments that began before midnight and are still in progress", async () => {
    const overnight = block({
      id: "overnight",
      title: "Overnight maintenance",
      start_at: atLocal("2026-08-30", 23),
      end_at: atLocal(TODAY, 1),
    });
    stub({
      view: snapshotView({
        commitments: [
          {
            id: "cooper:overnight",
            source: "cooper",
            source_id: overnight.id,
            aliases: ["cooper:overnight"],
            title: overnight.title,
            kind: "event",
            start_at: overnight.start_at!,
            end_at: overnight.end_at!,
            all_day: false,
            category: "work",
            editable: true,
            local_item_id: overnight.id,
            conflict: false,
            item: overnight,
          },
        ],
      }),
    });
    render(<App />);

    const agenda = (await screen.findByText("Today")).closest("section") as HTMLElement;
    expect(within(agenda).getByText("Overnight maintenance")).toBeInTheDocument();
  });

  test("Home links risks to the single affected agenda item", async () => {
    const task = block({ id: "risk", title: "Submit the grant", start_at: atLocal(TODAY, 15) });
    stub({
      view: snapshotView({
        commitments: [
          {
            id: "cooper:risk",
            source: "cooper",
            source_id: task.id,
            aliases: ["cooper:risk"],
            title: task.title,
            kind: "task",
            start_at: task.start_at!,
            end_at: task.end_at!,
            all_day: false,
            category: "work",
            editable: true,
            local_item_id: task.id,
            conflict: true,
            item: task,
          },
        ],
        risks: [
          {
            kind: "conflict",
            commitment_ids: ["cooper:risk"],
          },
        ],
      }),
    });
    render(<App />);

    expect(await screen.findByText("At risk")).toBeInTheDocument();
    const riskReference = screen.getByRole("link", { name: "At risk: Submit the grant" });
    expect(riskReference).toHaveAttribute("href", "#agenda-cooper:risk");
    expect(within(riskReference).getByText("Submit the grant")).toBeVisible();
    expect(screen.getByText("Overlaps another commitment")).toBeInTheDocument();
    expect(document.querySelectorAll("#agenda-cooper\\:risk")).toHaveLength(1);
  });

  test("At Risk references keep their underlying item in the restrained Upcoming list", async () => {
    const tasks = Array.from({ length: 6 }, (_, index) =>
      ranked({ id: `task-${index + 1}`, title: `Task ${index + 1}` }),
    );
    stub({
      view: snapshotView({
        tasks,
        risks: [{ kind: "overdue", item_id: "task-6", message: "Deadline has passed" }],
      }),
    });
    render(<App />);

    const risk = await screen.findByRole("link", { name: "At risk: Task 6" });
    expect(risk).toHaveAttribute("href", "#task-task-6");
    expect(within(risk).getByText("Task 6")).toBeVisible();
    expect(document.getElementById("task-task-6")).not.toBeNull();
  });

  test("external snapshot events are readable without mutation controls", async () => {
    const external: CalendarEvent = {
      event_id: "read-only",
      title: "Partner call",
      start_at: atLocal(TODAY, 13),
      end_at: atLocal(TODAY, 14),
      category: "work",
      mine: false,
      source: "google",
    };
    stub({
      view: snapshotView({
        commitments: [
          {
            id: "google:read-only",
            source: "google",
            source_id: external.event_id!,
            aliases: ["google:read-only"],
            title: external.title,
            kind: "event",
            start_at: external.start_at,
            end_at: external.end_at,
            all_day: false,
            category: "work",
            editable: false,
            local_item_id: null,
            conflict: false,
            event: external,
          },
        ],
      }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Partner call/ }));
    expect(await screen.findByRole("dialog", { name: "Partner call" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move Partner call/ })).not.toBeInTheDocument();
  });

  test("Home reschedules local work and renders the committed snapshot time", async () => {
    const original = block({ id: "move-me", title: "Write release notes" });
    const moved = block({
      id: "move-me",
      title: "Write release notes",
      start_at: atLocal(TODAY, 15),
      minutes: 45,
    });
    moved.end_at = new Date(new Date(moved.start_at!).getTime() + 45 * 60_000).toISOString();
    const initialView = view({ scheduled: [original] });
    const committedView = view({ scheduled: [moved] });
    const calls = stub({
      view: initialView,
      move: reply({
        kind: "rescheduled",
        message: "Moved “Write release notes” in COOPER to Mon 3:00 PM–3:45 PM.",
        receipt: {
          operation: "reschedule",
          items: [
            {
              id: moved.id,
              title: moved.title,
              state: "scheduled",
              start_at: moved.start_at,
              end_at: moved.end_at,
            },
          ],
          warnings: [],
          snapshot_generated_at: committedView.planning.generated_at,
        },
        view: committedView,
      }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Move Write release notes" }));
    const start = screen.getByLabelText("New time for Write release notes");
    fireEvent.change(start, { target: { value: `${TODAY}T15:00` } });
    const duration = screen.getByLabelText("Duration for Write release notes");
    fireEvent.change(duration, { target: { value: "45" } });
    await user.click(screen.getByRole("button", { name: "Save new time" }));

    await waitFor(() =>
      expect(calls.find((call) => call.url.endsWith("/api/items/move-me/move"))?.body).toEqual({
        start: `${TODAY}T15:00`,
        minutes: 45,
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moved “Write release notes” in COOPER to Mon 3:00 PM–3:45 PM.",
    );
    const agenda = screen.getByRole("region", { name: "Today" });
    expect(within(agenda).getByText("Mon 3:00 PM")).toBeInTheDocument();
  });

  test("Ask renders the verified reschedule receipt message", async () => {
    const moved = block({
      id: "asked-move",
      title: "Write release notes",
      start_at: atLocal(TODAY, 15),
    });
    const committedView = view({ scheduled: [moved], using_model: true });
    const calls = stub({
      view: view({ scheduled: [block({ id: moved.id, title: moved.title })], using_model: true }),
      say: reply({
        kind: "rescheduled",
        message: "Moved “Write release notes” in COOPER to Mon 3:00 PM–4:00 PM.",
        receipt: {
          operation: "reschedule",
          items: [
            {
              id: moved.id,
              title: moved.title,
              state: "scheduled",
              start_at: moved.start_at,
              end_at: moved.end_at,
            },
          ],
          warnings: [],
          snapshot_generated_at: committedView.planning.generated_at,
        },
        view: committedView,
      }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Say something to Cooper"),
      "move write release notes to tomorrow at 3pm for 60m{Enter}",
    );

    const receiptMessage = await screen.findByText(
      "Moved “Write release notes” in COOPER to Mon 3:00 PM–4:00 PM.",
    );
    expect(receiptMessage).toBeInTheDocument();
    expect(receiptMessage.closest(".bubble")).toHaveClass("bubble--good");
    expect(calls.find((call) => call.url.includes("/api/say"))?.body.text).toBe(
      "move write release notes to tomorrow at 3pm for 60m",
    );
  });

  test("Home keeps available work visible when provider data is incomplete", async () => {
    const task = ranked({ id: "waiting", title: "Outline the launch", minutes: 30 });
    stub({
      view: snapshotView({
        complete: false,
        source_health: [
          { source: "google", status: "unavailable", message: "Google Calendar is unavailable." },
        ],
        tasks: [task],
        focus: { now_id: null, next_id: null },
      }),
    });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Planning is incomplete");
    expect(screen.getByText("Outline the launch")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plan my day" })).toBeDisabled();
  });

  test("Home does not claim free time before Next when provider data is incomplete", async () => {
    const next = block({
      id: "next",
      title: "Provider-dependent meeting",
      start_at: atLocal(TODAY, 11),
    });
    stub({
      view: snapshotView({
        complete: false,
        source_health: [
          { source: "google", status: "unavailable", message: "Google Calendar is unavailable." },
        ],
        commitments: [
          {
            id: "cooper:next",
            source: "cooper",
            source_id: next.id,
            aliases: ["cooper:next"],
            title: next.title,
            kind: "task",
            start_at: next.start_at!,
            end_at: next.end_at!,
            all_day: false,
            category: "work",
            editable: true,
            local_item_id: next.id,
            conflict: false,
            item: next,
          },
        ],
        focus: { now_id: null, next_id: "cooper:next" },
      }),
    });
    render(<App />);

    const nextReference = await screen.findByRole("link", {
      name: "Next: Provider-dependent meeting",
    });
    expect(nextReference).toHaveTextContent("11:00 AM–12:00 PM");
    expect(nextReference).not.toHaveTextContent(/min free before/);
  });

  test("Home renders a missed yesterday block referenced by focus and risk", async () => {
    const missed = block({
      id: "missed",
      title: "Yesterday standup",
      start_at: atLocal("2026-08-30", 9),
    });
    stub({
      view: snapshotView({
        commitments: [
          {
            id: "cooper:missed",
            source: "cooper",
            source_id: missed.id,
            aliases: ["cooper:missed"],
            title: missed.title,
            kind: "task",
            start_at: missed.start_at!,
            end_at: missed.end_at!,
            all_day: false,
            category: "work",
            editable: true,
            local_item_id: missed.id,
            conflict: false,
            item: { ...missed, source: "me" as const },
          },
        ],
        focus: { now_id: "cooper:missed", next_id: null },
        risks: [{ kind: "missed_block", item_id: missed.id }],
      }),
    });
    render(<App />);

    const catchUp = (await screen.findByText("Catch up")).closest("section") as HTMLElement;
    expect(within(catchUp).getByText("Yesterday standup")).toBeInTheDocument();
    expect(document.querySelector("#agenda-cooper\\:missed")).toBeTruthy();
  });

  test("Home renders a focused task ranked below the fifth upcoming slot", async () => {
    const tasks = Array.from({ length: 6 }, (_, index) =>
      ranked({ id: `task-${index + 1}`, title: `Task ${index + 1}`, minutes: 30 }),
    );
    const focused = tasks[5];
    stub({
      view: snapshotView({
        tasks,
        focus: { now_id: focused.id, next_id: null },
      }),
    });
    render(<App />);

    const nowReference = await screen.findByRole("link", { name: "Now: Task 6" });
    expect(nowReference).toHaveAttribute("href", "#task-task-6");
    expect(document.querySelector("#task-task-6")).toBeTruthy();
  });

  test("Google all-day events stay on the configured local day", async () => {
    stub({
      view: snapshotView({
        timezone: "Asia/Manila",
        commitments: [
          {
            id: "google:holiday",
            source: "google",
            source_id: "holiday",
            aliases: ["google:holiday"],
            title: "Holiday",
            kind: "event",
            start_at: "2026-09-10T16:00:00+00:00",
            end_at: "2026-09-11T16:00:00+00:00",
            all_day: true,
            category: "personal",
            editable: false,
            local_item_id: null,
            conflict: false,
            event: {
              event_id: "holiday",
              title: "Holiday",
              start_at: "2026-09-10T16:00:00+00:00",
              end_at: "2026-09-11T16:00:00+00:00",
              category: "personal",
              mine: false,
              source: "google",
              all_day: true,
            },
          },
        ],
        today: "2026-09-11",
        generated_at: "2026-09-11T01:00:00+08:00",
      }),
    });
    render(<App />);

    expect(await screen.findByText("Holiday")).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  test("Today stays focused while upcoming commitments remain available below", async () => {
    stub({
      view: view({
        scheduled: [
          block({ id: "s1", title: "morning run", start_at: atLocal(TODAY, 8) }),
          block({ id: "s2", title: "next week's audit", start_at: atLocal(TOMORROW, 8) }),
        ],
      }),
    });
    render(<App />);

    expect(await screen.findByText("morning run")).toBeInTheDocument();
    const upcoming = screen.getByText("Upcoming").closest("section") as HTMLElement;
    expect(within(upcoming).getByText("next week's audit")).toBeInTheDocument();
  });

  test("someone else's event opens its full details from the home strip", async () => {
    stub({
      view: view({
        events: [
          {
            event_id: "dentist-1",
            title: "dentist",
            start_at: atLocal(TODAY, 15),
            end_at: atLocal(TODAY, 16),
            category: "personal",
            mine: false,
            source: "google",
            meeting_url: "https://meet.example.com/dentist",
            location: "Dental clinic",
            description:
              '<strong>Bring the insurance card.</strong><br>Join Zoom Meeting<br><a href="https://meet.example.com/dentist">https://meet.example.com/dentist</a><script>do not show this</script>',
            organizer_name: "Dr. Cooper",
            response_status: "needsAction",
          },
        ],
      }),
    });
    render(<App />);
    const user = userEvent.setup();

    const agenda = await screen.findByRole("region", { name: "Today" });
    const dentist = within(agenda).getByText("dentist");
    expect(dentist.closest("button")).not.toBeNull();
    expect(dentist.closest(".slot")).toHaveClass("slot--google");

    await user.click(dentist.closest("button")!);
    expect((await screen.findAllByText("Dental clinic"))[0]).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Join meeting" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "https://meet.example.com/dentist" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Bring the insurance card.")).toBeInTheDocument();
    expect(screen.getByText("Awaiting your response")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("<br>");
    expect(document.body.textContent).not.toContain("href=");
    expect(document.body.textContent).not.toContain("do not show this");
  });

  test("an event Cooper placed is not listed twice", async () => {
    // Blocks Cooper wrote come back from Google as well; `mine` marks them and the local copy
    // is the one kept, because that is the one with actions attached.
    stub({
      view: view({
        scheduled: [block({ id: "s1", title: "write the report", start_at: atLocal(TODAY, 9) })],
        events: [
          {
            title: "write the report",
            start_at: atLocal(TODAY, 9),
            end_at: atLocal(TODAY, 10),
            category: "work",
            mine: true,
            source: "google",
          },
        ],
      }),
    });
    render(<App />);

    await screen.findByText("Now");
    const agenda = screen.getByRole("region", { name: "Today" });
    expect(within(agenda).getAllByText("write the report")).toHaveLength(1);
    expect(document.querySelectorAll("#agenda-cooper\\:s1")).toHaveLength(1);
  });

  test("open tasks remain together in the ranked upcoming list", async () => {
    stub({
      view: view({
        shortlist: [
          ranked({ id: "a1", title: "late thing", due: "2026-08-20T00:00:00+00:00" }),
          ranked({ id: "a2", title: "today thing", due: `${TODAY}T00:00:00+00:00` }),
          ranked({ id: "a3", title: "later thing", due: "2026-09-30T00:00:00+00:00" }),
        ],
      }),
    });
    render(<App />);

    const group = (await screen.findByText("Upcoming")).closest("section");
    expect(group).not.toBeNull();
    expect(within(group as HTMLElement).getByText("late thing")).toBeInTheDocument();
    expect(within(group as HTMLElement).getByText("today thing")).toBeInTheDocument();
    expect(within(group as HTMLElement).getByText("later thing")).toBeInTheDocument();
  });

  test("an errand is listed but never offered a block", async () => {
    // No estimate means the placer skips it rather than inventing a length, so offering to book
    // it would promise something that cannot happen.
    stub({ view: view({ shortlist: [ranked({ title: "buy milk", minutes: null })] }) });
    render(<App />);

    expect(await screen.findByText("Upcoming")).toBeInTheDocument();
    const waiting = screen.getByText("Upcoming").closest("section") as HTMLElement;
    expect(within(waiting).getByText("buy milk")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan my day" })).not.toBeInTheDocument();
  });

  test("a sized task waiting for a time can be booked from here", async () => {
    const calls = stub({ view: view({ shortlist: [ranked({ minutes: 45 })] }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Plan my day" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/api/schedule"))).toBe(true),
    );
  });

  test("completing from the dashboard does not write an activity line into AI chat", async () => {
    const calls = stub({
      view: view({ shortlist: [ranked({ title: "write the report" })], using_model: true }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Done" }));
    await waitFor(() => expect(calls.some((call) => call.url.includes("/complete"))).toBe(true));

    await openChat(user);
    await user.click(await screen.findByRole("button", { name: "Ask" }));
    expect(screen.getByRole("status")).toHaveTextContent("Completed.");
    expect(screen.queryByRole("log")).not.toBeInTheDocument();
  });

  test("an empty day says so and points at the one thing to do about it", async () => {
    stub({ view: view({ shortlist: [], scheduled: [], events: [] }) });
    render(<App />);

    expect(await screen.findByText("Nothing on today")).toBeInTheDocument();
    const nav = screen.getAllByRole("navigation", { name: "Sections" })[0];

    await userEvent.setup().click(screen.getByRole("button", { name: "Say something" }));

    expect(screen.getByLabelText("Say something to Cooper")).toHaveFocus();
    expect(within(nav).getByRole("button", { name: /Home/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the Home composer talks to Cooper instead of opening the silent form", async () => {
    const calls = stub({
      view: view({ using_model: true }),
      say: reply({ kind: "added", message: "Added “buy milk”." }),
    });
    render(<App />);
    const user = userEvent.setup();
    await screen.findByText("Now");

    await user.type(screen.getByLabelText("Say something to Cooper"), "buy milk{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText("buy milk")).toBeInTheDocument();
    expect(within(log).getByText("Added “buy milk”.")).toBeInTheDocument();
    expect(calls.some((call) => call.url.includes("/api/say"))).toBe(true);
  });
});

describe("manual mode as a form", () => {
  test("a failed save preserves the draft and optional details", async () => {
    stub({ itemError: "Could not save. Try again." });
    render(<App />);
    const user = await openChat();
    await user.type(await screen.findByLabelText("What"), "planning session");
    await user.type(screen.getByLabelText("Location"), "Studio 3");
    await user.type(screen.getByLabelText("Notes"), "Bring the draft.");
    await user.click(screen.getByRole("button", { name: "Add it" }));
    await screen.findByText("Could not save. Try again.");
    expect(screen.getByLabelText("What")).toHaveValue("planning session");
    expect(screen.getByLabelText("Location")).toHaveValue("Studio 3");
    expect(screen.getByLabelText("Notes")).toHaveValue("Bring the draft.");
  });

  test("Manual mode on the chat tab is a form, not a sentence box", async () => {
    stub({});
    render(<App />);
    await openChat();

    // The form's own fields, and no free-text sentence composer competing with them.
    expect(await screen.findByLabelText("What")).toBeInTheDocument();
    expect(screen.getByLabelText("How long")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add it" })).toBeInTheDocument();
    expect(document.querySelector("form.taskform")).toBeInTheDocument();
    expect(screen.getByText("Category").closest(".scroll--form")).not.toBeNull();
  });

  test("the form posts typed fields, never a parsed sentence", async () => {
    const calls = stub({});
    render(<App />);
    const user = await openChat();

    await user.type(await screen.findByLabelText("What"), "write the report");
    await user.type(screen.getByLabelText("How long"), "90");
    await user.click(screen.getByRole("button", { name: "Important" }));
    await user.click(screen.getByRole("button", { name: "Add it" }));

    await waitFor(() => {
      const created = calls.find((call) => call.url.endsWith("/api/items"));
      expect(created).toBeDefined();
      expect(created?.body.title).toBe("write the report");
      expect(created?.body.minutes).toBe(90);
      expect(created?.body.importance).toBe(4);
    });
    // The model endpoint is never touched: a form is not a sentence.
    expect(calls.some((call) => call.url.includes("/api/say"))).toBe(false);
  });

  test("the form sends optional event details when provided", async () => {
    const calls = stub({});
    render(<App />);
    const user = await openChat();

    await user.type(await screen.findByLabelText("What"), "planning session");
    await user.type(screen.getByLabelText("Location"), "Studio 3");
    await user.type(screen.getByLabelText("Meeting link"), "https://meet.google.com/example-room");
    await user.type(screen.getByLabelText("Notes"), "Bring the draft.");
    await user.click(screen.getByRole("button", { name: "Add it" }));

    await waitFor(() => {
      const created = calls.find((call) => call.url.endsWith("/api/items"));
      expect(created).toBeDefined();
      expect(created?.body.location).toBe("Studio 3");
      expect(created?.body.meeting_url).toBe("https://meet.google.com/example-room");
      expect(created?.body.notes).toBe("Bring the draft.");
    });
  });

  test("Add it is disabled until there is a title", async () => {
    stub({});
    render(<App />);
    await openChat();

    expect(await screen.findByRole("button", { name: "Add it" })).toBeDisabled();
  });

  test("picking a day and a time makes an event, as a naive wall-clock start", async () => {
    const calls = stub({});
    render(<App />);
    const user = await openChat();

    await user.type(await screen.findByLabelText("What"), "team sync");
    // Deadline is the native date picker; At is a select of half-hour slots.
    const day = screen.getByLabelText("Deadline") as HTMLInputElement;
    await user.type(day, "2099-09-05");
    await user.selectOptions(screen.getByLabelText("At"), "14:00");
    expect(screen.getByRole("button", { name: "Add it" })).toBeDisabled();
    expect(screen.getByText("Add a duration to save this fixed event.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("How long"), "60");
    await user.click(screen.getByRole("button", { name: "Add it" }));

    await waitFor(() => {
      const created = calls.find((call) => call.url.endsWith("/api/items"));
      expect(created).toBeDefined();
      // No Z, no offset: a wall-clock string the backend tags with the configured zone.
      expect(created?.body.start).toBe("2099-09-05T14:00:00");
      expect(created?.body.minutes).toBe(60);
    });
  });

  test("a stale AI mode falls back to Manual when there is no key", async () => {
    localStorage.setItem("cooper.mode.v1", "ai");
    stub({ view: view({ using_model: false }) });
    render(<App />);
    await openChat();

    expect(await screen.findByLabelText("What")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Form" })).toHaveAttribute("aria-pressed", "true");
  });
});
