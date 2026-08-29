import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "./App";
import type { CaptureResult, Plan, RankedTask, Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "write the quarterly report",
    notes: null,
    effort_minutes: 180,
    importance: 4,
    deadline: null,
    earliest_start: null,
    tags: [],
    allow_split: false,
    status: "active",
    slip_count: 0,
    pinned_for_date: null,
    created_at: "2026-08-29T01:00:00+00:00",
    completed_at: null,
    is_blocked: false,
    ...overrides,
  };
}

function ranked(overrides: Partial<RankedTask> = {}): RankedTask {
  return {
    rank: 1,
    is_pinned: false,
    score: 0.412,
    contributions: [
      { term: "deadline_pressure", normalised: 0, weighted: 0 },
      { term: "importance", normalised: 0.75, weighted: 0.1875 },
      { term: "slip_pressure", normalised: 0, weighted: 0 },
      { term: "unblocks", normalised: 0, weighted: 0 },
      { term: "age", normalised: 0.1, weighted: 0.01 },
    ],
    task: task(),
    ...overrides,
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  const entry = ranked();
  return {
    generated_at: "2026-08-29T09:00:00+00:00",
    shortlist: [entry],
    backlog: [entry],
    blocked: [],
    degraded: false,
    ...overrides,
  };
}

function captureResult(overrides: Partial<CaptureResult> = {}): CaptureResult {
  return {
    intent: "CreateTask",
    chip: {
      kind: "CreateTask",
      summary: "write the report · 180m · 4",
      fields: [
        { label: "task", value: "write the report" },
        { label: "effort", value: "180m" },
      ],
    },
    task: task({ title: "write the report" }),
    question: null,
    candidates: [],
    mutation_id: "mut-1",
    provider: "rule_based",
    model_calls: 0,
    degraded: true,
    ...overrides,
  };
}

interface Routes {
  plan?: Plan;
  degraded?: boolean;
  capture?: CaptureResult | { status: number; detail: string; candidates?: string[] };
  failPlan?: boolean;
}

function stubFetch(routes: Routes) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const handler = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    const json = (payload: unknown, status = 200) =>
      new Response(JSON.stringify(payload), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/api/plan/today")) {
      if (routes.failPlan) {
        return json({ detail: "connection refused" }, 500);
      }
      return json(routes.plan ?? plan());
    }
    if (url.includes("/api/capture/status")) {
      return json({ provider: "rule_based", degraded: routes.degraded ?? false });
    }
    if (url.includes("/undo")) {
      return json(captureResult({ intent: "Undo", task: task({ title: "restored" }) }));
    }
    if (url.includes("/api/capture")) {
      const configured = routes.capture ?? captureResult();
      if ("status" in configured) {
        return json(
          { detail: configured.detail, candidates: configured.candidates ?? [] },
          configured.status,
        );
      }
      return json(configured);
    }
    if (url.includes("/complete") || url.includes("/pin") || url.includes("/drop")) {
      return json(task());
    }
    if (url.includes("/api/tasks/")) {
      return json(task({ title: "corrected title" }));
    }
    return json({});
  });

  vi.stubGlobal("fetch", handler);
  return calls;
}

beforeEach(() => {
  vi.stubEnv("VITE_CADENCE_SHARED_SECRET", "test-secret");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("application shell", () => {
  test("renders the brand, capture bar, and navigation", async () => {
    stubFetch({});
    render(<App />);

    expect(await screen.findByRole("img", { name: "Cadence" })).toBeInTheDocument();
    expect(screen.getByLabelText("Capture a task or event")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Views" });
    expect(within(nav).getByRole("button", { name: /^Today$/ })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: /^Backlog$/ })).toBeInTheDocument();
  });

  test("Phase 3 views are present but explicitly unavailable", async () => {
    stubFetch({});
    render(<App />);

    const nav = screen.getByRole("navigation", { name: "Views" });
    const windows = within(nav).getByRole("button", { name: /Windows/ });
    expect(windows).toBeDisabled();
    expect(within(windows).getByText("Later")).toBeInTheDocument();
  });

  test("shows the ranked shortlist from the backend", async () => {
    stubFetch({});
    render(<App />);

    const table = await screen.findByRole("table", {
      name: /Ranked shortlist of tasks/,
    });
    expect(within(table).getByText("write the quarterly report")).toBeInTheDocument();
    expect(within(table).getByText("3h")).toBeInTheDocument();
    expect(within(table).getByText("0.412")).toBeInTheDocument();
  });

  test("an unreachable backend is reported, not rendered as an empty plan", async () => {
    stubFetch({ failPlan: true });
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Backend unreachable");
  });

  test("degraded mode is announced as a working state", async () => {
    stubFetch({ degraded: true });
    render(<App />);

    expect(await screen.findByText("Offline parsing")).toBeInTheDocument();
    expect(screen.getByText("Offline parser")).toBeInTheDocument();
  });
});

describe("capture", () => {
  test("submitting a sentence posts it and shows a parsed chip with undo", async () => {
    const calls = stubFetch({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Capture a task or event"), "write the report{Enter}");

    const chip = await screen.findByRole("status", { name: "Capture result" });
    expect(within(chip).getByText("Task")).toBeInTheDocument();
    expect(within(chip).getByText("write the report")).toBeInTheDocument();
    expect(within(chip).getByText("180m")).toBeInTheDocument();
    expect(within(chip).getByRole("button", { name: "undo" })).toBeInTheDocument();
    const captureCall = calls.find((call) => call.url.endsWith("/api/capture"));
    expect(captureCall?.body).toEqual({ utterance: "write the report" });
  });

  test("the capture field clears after submitting", async () => {
    stubFetch({});
    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Capture a task or event");

    await user.type(input, "write the report{Enter}");

    await waitFor(() => expect(input).toHaveValue(""));
  });

  test("no confirmation dialog ever appears on the capture path", async () => {
    stubFetch({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Capture a task or event"), "write the report{Enter}");
    await screen.findByRole("button", { name: "undo" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  test("the chip offers an inline correction that patches the task", async () => {
    const calls = stubFetch({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Capture a task or event"), "write the report{Enter}");
    await user.click(await screen.findByRole("button", { name: "edit" }));
    const field = screen.getByLabelText("Corrected title");
    await user.clear(field);
    await user.type(field, "corrected title");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = calls.find((call) => call.method === "PATCH");
      expect(patch?.body).toEqual({ title: "corrected title" });
    });
  });

  test("undo posts to the mutation and reports the restoration", async () => {
    const calls = stubFetch({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Capture a task or event"), "write the report{Enter}");
    await user.click(await screen.findByRole("button", { name: "undo" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/api/capture/mut-1/undo"))).toBe(true),
    );
    expect(await screen.findByText("Undone")).toBeInTheDocument();
  });

  test("an ambiguous reference asks instead of guessing", async () => {
    stubFetch({
      capture: {
        status: 409,
        detail: "'design review' matches more than one task",
        candidates: ["design review weekly", "design review prep"],
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.type(
      screen.getByLabelText("Capture a task or event"),
      "done design review{Enter}",
    );

    expect(await screen.findByText("Which one?")).toBeInTheDocument();
    expect(screen.getByText("design review weekly")).toBeInTheDocument();
    expect(screen.getByText("design review prep")).toBeInTheDocument();
  });

  test("a rejected capture says so rather than failing silently", async () => {
    stubFetch({ capture: { status: 422, detail: "title must not be blank" } });
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Capture a task or event"), "?????{Enter}");

    expect(await screen.findByText("Not applied")).toBeInTheDocument();
    expect(screen.getByText("title must not be blank")).toBeInTheDocument();
  });
});

describe("prioritisation surface", () => {
  test("a row explains its own score on demand", async () => {
    stubFetch({});
    render(<App />);
    const user = userEvent.setup();

    const why = await screen.findByRole("button", { name: /why/ });
    expect(why).toHaveAttribute("aria-expanded", "false");
    await user.click(why);

    expect(why).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Importance")).toBeInTheDocument();
    expect(screen.getByText("+0.188")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
  });

  test("pinning a task sends today's date", async () => {
    const calls = stubFetch({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "pin" }));

    await waitFor(() => {
      const pin = calls.find((call) => call.url.includes("/pin"));
      expect(pin?.method).toBe("PUT");
      expect((pin?.body as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  test("an already pinned task unpins", async () => {
    const calls = stubFetch({
      plan: plan({ shortlist: [ranked({ is_pinned: true })] }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "pin" }));

    await waitFor(() => {
      const pin = calls.find((call) => call.url.includes("/pin"));
      expect(pin?.body).toEqual({ date: null });
    });
  });

  test("completing a task calls the backend", async () => {
    const calls = stubFetch({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Mark done" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/complete"))).toBe(true),
    );
  });

  test("an overdue deadline is visually distinguished", async () => {
    stubFetch({
      plan: plan({ shortlist: [ranked({ task: task({ deadline: "2020-01-01" }) })] }),
    });
    render(<App />);

    expect(await screen.findByText(/overdue 2020-01-01/)).toBeInTheDocument();
  });

  test("blocked tasks are shown separately from the ranking", async () => {
    stubFetch({
      plan: plan({
        blocked: [task({ id: "task-9", title: "data export", is_blocked: true })],
      }),
    });
    render(<App />);

    expect(await screen.findByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("data export")).toBeInTheDocument();
  });

  test("an empty shortlist explains what to do", async () => {
    stubFetch({ plan: plan({ shortlist: [], backlog: [] }) });
    render(<App />);

    expect(await screen.findByText("Nothing on the shortlist")).toBeInTheDocument();
  });
});

describe("navigation", () => {
  test("the backlog view lists ranked tasks", async () => {
    stubFetch({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /^Backlog$/ }));

    expect(screen.getByRole("heading", { name: "Backlog" })).toBeInTheDocument();
    expect(screen.getByText(/All unscheduled tasks/)).toBeInTheDocument();
  });

  test("the states gallery renders all five required states", async () => {
    stubFetch({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /^States$/ }));

    expect(screen.getByText("Welcome to Cadence")).toBeInTheDocument();
    expect(screen.getByText("Running without the model")).toBeInTheDocument();
    expect(screen.getByText("Calendar sync stopped")).toBeInTheDocument();
    expect(screen.getByText("Which task did you mean?")).toBeInTheDocument();
    expect(screen.getByText("This will not fit a window")).toBeInTheDocument();
  });

  test("every mascot image resolves to a manifest asset with alt text", async () => {
    stubFetch({});
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^States$/ }));

    const images = screen.getAllByRole("img");
    const mascots = images.filter((image) =>
      image.getAttribute("src")?.includes("/assets/mascot/"),
    );
    expect(mascots.length).toBeGreaterThanOrEqual(5);
    for (const image of mascots) {
      expect(image.getAttribute("src")).toMatch(/\.webp$/);
      expect(image).toHaveAccessibleName();
      expect(image).toHaveAttribute("width");
      expect(image).toHaveAttribute("height");
    }
  });
});

describe("keyboard access", () => {
  test("the capture bar is reachable by shortcut", async () => {
    stubFetch({});
    render(<App />);
    const user = userEvent.setup();
    const input = screen.getByLabelText("Capture a task or event");
    input.blur();

    await user.keyboard("{Meta>}k{/Meta}");

    expect(input).toHaveFocus();
  });
});
