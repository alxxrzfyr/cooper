import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "./App";
import type { Item, Ranked, Reply, View } from "./types";

function ranked(overrides: Partial<Ranked> = {}): Ranked {
  return {
    id: "a1",
    kind: "task",
    title: "write the quarterly report",
    notes: null,
    minutes: 90,
    importance: 4,
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

function view(overrides: Partial<View> = {}): View {
  return {
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
    undo: null,
    using_model: false,
    calendar: { configured: false, connected: false, email: null },
    ...overrides,
  };
}

function reply(overrides: Partial<Reply> = {}): Reply {
  return {
    kind: "added",
    message: "Added “write the report”.",
    source: "rules",
    view: view(),
    ...overrides,
  };
}

interface Routes {
  view?: View;
  say?: Reply | { status: number; detail: string };
  failView?: boolean;
}

function stub(routes: Routes) {
  const calls: Array<{ url: string; method: string; body?: any }> = [];
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
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (url.includes("/api/today")) {
        return routes.failView
          ? json({ detail: "connection refused" }, 500)
          : json(routes.view ?? view());
      }
      if (url.includes("/api/say")) {
        const configured = routes.say ?? reply();
        return "status" in configured
          ? json({ detail: configured.detail }, configured.status)
          : json(configured);
      }
      if (url.includes("/api/schedule")) {
        return json({ placed: [{ item_id: "a1" }], view: routes.view ?? view() });
      }
      if (url.includes("/api/undo")) {
        return json(reply({ kind: "undone", message: "Undid: Added." }));
      }
      if (url.includes("/api/hours")) {
        return json({ view: routes.view ?? view() });
      }
      if (url.includes("/api/items/")) {
        return json(reply({ kind: "changed", message: "Completed." }));
      }
      return json({});
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv("VITE_CADENCE_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("first impression", () => {
  test("shows the top task as the thing to do next", async () => {
    stub({});
    render(<App />);

    expect(await screen.findByText("Up next")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "write the quarterly report" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/90 min/)).toBeInTheDocument();
  });

  test("an empty state invites a sentence with real examples", async () => {
    stub({ view: view({ shortlist: [] }) });
    render(<App />);

    expect(await screen.findByText("Tell me what is on your plate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /quarterly report/ })).toBeInTheDocument();
  });

  test("tapping an example sends it", async () => {
    const calls = stub({ view: view({ shortlist: [] }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /dentist thursday 3pm/ }));

    await waitFor(() => {
      const said = calls.find((call) => call.url.includes("/api/say"));
      expect(said?.body.text).toBe("dentist thursday 3pm");
    });
  });

  test("a dead backend says so instead of looking empty", async () => {
    stub({ failView: true });
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Cadence is not running");
  });

  test("offline parsing is stated under setup without alarm", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Setup/ }));

    expect(await screen.findByText("Offline rules")).toBeInTheDocument();
    expect(screen.getByText(/Works fine without a key/)).toBeInTheDocument();
  });
});

describe("saying things", () => {
  test("typing a sentence sends it and shows the reply", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cadence"), "write the report{Enter}");

    const strip = await screen.findByRole("status", { name: "Cadence reply" });
    expect(within(strip).getByText(/Added/)).toBeInTheDocument();
    expect(calls.find((call) => call.url.includes("/api/say"))?.body.text).toBe(
      "write the report",
    );
  });

  test("the field clears after sending", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();
    const field = screen.getByLabelText("Say something to Cadence");

    await user.type(field, "write the report{Enter}");

    await waitFor(() => expect(field).toHaveValue(""));
  });

  test("send is disabled until something is typed", async () => {
    stub({});
    render(<App />);

    expect(await screen.findByRole("button", { name: "Send" })).toBeDisabled();
  });

  test("an ambiguous reference is shown as a question, not an error", async () => {
    stub({ say: { status: 409, detail: "“review” matches 2 items: review a, review b" } });
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cadence"), "done review{Enter}");

    const strip = await screen.findByRole("status", { name: "Cadence reply" });
    expect(within(strip).getByText(/matches 2 items/)).toBeInTheDocument();
  });

  test("no dialog ever interrupts sending", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cadence"), "write it{Enter}");
    await screen.findByRole("status", { name: "Cadence reply" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("the composer is reachable by shortcut", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();
    const field = screen.getByLabelText("Say something to Cadence");
    field.blur();

    await user.keyboard("{Meta>}k{/Meta}");

    expect(field).toHaveFocus();
  });
});

describe("the list", () => {
  test("a row explains its own ranking on request", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    const toggle = await screen.findByRole("button", { name: /Why .* ranks here/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Matters")).toBeInTheDocument();
    expect(screen.getByText("Deadline")).toBeInTheDocument();
  });

  test("completing a task calls the backend", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Mark .* done/ }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/complete"))).toBe(true),
    );
  });

  test("pinning calls the backend", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /^Pin/ }));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/pin"))).toBe(true));
  });

  test("an overdue task is called out", async () => {
    stub({ view: view({ shortlist: [ranked({ due: "2020-01-01T00:00:00+00:00" })] }) });
    render(<App />);

    expect(await screen.findByText("overdue")).toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: /Calendar/ }));

    expect(await screen.findByText("review the budget")).toBeInTheDocument();
  });

  test("scheduling asks the backend to place everything", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Put these in my calendar" }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/api/schedule"))).toBe(true),
    );
  });
});

describe("undo", () => {
  test("undo is offered only when there is something to undo", async () => {
    stub({ view: view({ undo: null }) });
    render(<App />);
    await screen.findByText("Up next");

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  test("undo appears once something has happened", async () => {
    stub({ view: view({ undo: "Added “write the report”" }) });
    render(<App />);

    expect(await screen.findByRole("button", { name: "Undo" })).toBeInTheDocument();
  });

  test("undo calls the backend", async () => {
    const calls = stub({ view: view({ undo: "Added something" }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Undo" }));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/api/undo"))).toBe(true));
  });
});

describe("working hours", () => {
  test("setup states the boundary", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Setup/ }));

    expect(await screen.findByText(/Nothing is ever booked outside these hours/)).toBeInTheDocument();
  });

  test("changing the end hour saves it", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /Setup/ }));

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
    await user.click(await screen.findByRole("button", { name: /Setup/ }));

    await user.click(await screen.findByRole("button", { name: "Sat" }));

    await waitFor(() => {
      const put = calls.find((call) => call.method === "PUT");
      expect(put?.body.weekdays).toEqual([0, 1, 2, 3, 4, 5]);
    });
  });
});

describe("navigation", () => {
  test("all three tabs are present", async () => {
    stub({});
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Sections" });
    for (const label of ["Today", "Calendar", "Setup"]) {
      expect(within(nav).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  test("today is the tab you land on", async () => {
    stub({});
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("button", { name: /Today/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the calendar tab groups booked work by day", async () => {
    const booked = { ...ranked(), start_at: "2026-08-31T02:00:00+00:00" };
    stub({ view: view({ scheduled: [booked] }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Calendar/ }));

    expect(await screen.findByRole("heading", { name: /Calendar/ })).toBeInTheDocument();
    expect(screen.getByText("write the quarterly report")).toBeInTheDocument();
  });

  test("an empty calendar explains how to fill it", async () => {
    stub({ view: view({ scheduled: [] }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Calendar/ }));

    expect(await screen.findByText("Nothing booked yet")).toBeInTheDocument();
  });

  test("the calendar tab shows how much is booked", async () => {
    const booked = { ...ranked(), start_at: "2026-08-31T02:00:00+00:00" };
    stub({ view: view({ scheduled: [booked, { ...booked, id: "b2" }] }) });
    render(<App />);

    const nav = await screen.findByRole("navigation", { name: "Sections" });
    expect(within(nav).getByText("2")).toBeInTheDocument();
  });
});

describe("google calendar", () => {
  test("an unconfigured calendar says so under setup", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Setup/ }));

    expect(await screen.findByText("Not set up")).toBeInTheDocument();
  });

  test("configured but unconnected offers to connect", async () => {
    stub({ view: view({ calendar: { configured: true, connected: false, email: null } }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /Setup/ }));

    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
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

    await user.click(await screen.findByRole("button", { name: /Calendar/ }));

    expect(await screen.findByText("Synced with Google")).toBeInTheDocument();
  });
});

describe("the mascot", () => {
  test("the wordmark is real text, so it reads in both themes", async () => {
    // The supplied logo webp has dark ink baked in and vanished on black. Text inherits the
    // theme colour instead, which is why this asserts text rather than an image.
    stub({});
    render(<App />);

    expect(await screen.findByText("Cadence")).toBeInTheDocument();
  });

  test("every mascot image resolves and reserves its space", async () => {
    stub({ view: view({ shortlist: [] }) });
    render(<App />);
    await screen.findByText("Tell me what is on your plate");

    // Decorative images carry alt="", which removes the img role, so query the DOM directly.
    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>('img[src*="/assets/mascot/"]'),
    );

    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      expect(image.getAttribute("src")).toMatch(/\.webp$/);
      // Sizing and cropping live in CSS. The size class fixes the box, so nothing shifts while
      // loading, and the shape class crops the art's baked-in ground shadow.
      expect(image.className).toMatch(/mascot--(xs|sm|md|lg)/);
      expect(image.className).toMatch(/mascot--(round|squircle)/);
    }
  });
});
