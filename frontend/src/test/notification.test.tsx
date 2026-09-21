import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const firebaseMock = vi.hoisted(() => ({
  authMode: "local" as "local" | "firebase",
}));

vi.mock("../firebase", () => ({
  get clientAuthMode() {
    return firebaseMock.authMode;
  },
  firebaseConfigured: false,
  firebaseConfigError: null,
  auth: null,
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
  subscribeToAuth: vi.fn(),
}));

import App from "../App";
import type { Ranked, Reply, View } from "../types";

function ranked(): Ranked {
  return {
    id: "task-1",
    owner_id: "local",
    source: "me",
    source_ref: null,
    kind: "task",
    title: "write report",
    notes: null,
    minutes: 30,
    importance: 3,
    category: "work",
    due: null,
    start_at: null,
    end_at: null,
    google_event_id: null,
    status: "open",
    pinned: false,
    created_at: "2026-08-31T01:00:00+00:00",
    score: 0.5,
    why: { due: 0, importance: 0.5, age: 0.2, quick: 0.8 },
  };
}

function view(overrides: Partial<View> = {}): View {
  return {
    now: "2026-08-31T01:00:00+00:00",
    today: "2026-08-31",
    timezone: "Asia/Manila",
    shortlist: [ranked()],
    scheduled: [],
    events: [],
    planning: {
      generated_at: "2026-08-31T01:00:00+00:00",
      today: "2026-08-31",
      timezone: "Asia/Manila",
      complete: true,
      source_health: [],
      commitments: [],
      tasks: [ranked()],
      focus: { now_id: "task-1", next_id: null },
      risks: [],
      metrics: {
        scheduled_count: 0,
        occupied_minutes: 0,
        remaining_effort_minutes: 30,
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

function reply(message: string): Reply {
  return {
    kind: "completed",
    message,
    source: "rules",
    item: { ...ranked(), status: "done" },
    view: view({ shortlist: [] }),
  };
}

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/app");
  vi.stubEnv("VITE_COOPER_KEY", "test-key");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("browser notifications", () => {
  test("use the action text as the bold title without the app name", async () => {
    const notifications: Array<{ title: string; options?: NotificationOptions }> = [];
    class TestNotification {
      static permission: NotificationPermission = "granted";

      constructor(title: string, options?: NotificationOptions) {
        notifications.push({ title, options });
      }
    }
    vi.stubGlobal("Notification", TestNotification);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        return String(input).includes("/api/items/task-1/complete")
          ? json(reply('Completed "write report".'))
          : json(view());
      }),
    );

    render(<App />);

    await userEvent.setup().click(await screen.findByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(notifications).toEqual([
        {
          title: 'Completed "write report".',
          options: {
            icon: "/assets/mascot/cooper_done.webp",
            tag: "cooper-update",
          },
        },
      ]);
    });
  });

  test("announces a newly observed Google Calendar event", async () => {
    const notifications: string[] = [];
    class TestNotification {
      static permission: NotificationPermission = "granted";

      constructor(title: string) {
        notifications.push(title);
      }
    }
    vi.stubGlobal("Notification", TestNotification);

    let poll: (() => void) | undefined;
    vi.spyOn(window, "setInterval").mockImplementation(((
      handler: TimerHandler,
      timeout?: number,
    ) => {
      if (timeout === 60_000) poll = handler as () => void;
      return 1;
    }) as typeof window.setInterval);

    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return json(
          calls === 1
            ? view({ calendar: { configured: true, connected: true, email: "me@example.com" } })
            : view({
                calendar: { configured: true, connected: true, email: "me@example.com" },
                events: [
                  {
                    event_id: "google-1",
                    title: "Design review",
                    start_at: "2026-08-31T10:00:00+00:00",
                    end_at: "2026-08-31T11:00:00+00:00",
                    category: "work",
                    mine: false,
                    source: "google",
                  },
                ],
              }),
        );
      }),
    );

    render(<App />);
    await waitFor(() => expect(poll).toBeDefined());

    poll!();
    await waitFor(() => {
      expect(notifications).toEqual(["Google Calendar: Design review · Aug 31, 2026, 6:00 PM"]);
    });
  });
});
