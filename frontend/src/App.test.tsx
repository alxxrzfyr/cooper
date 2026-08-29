import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import App from "./App";
import type { CalendarEvent, Item, Ranked, Reply, View } from "./types";

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
    events: [],
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
    // The item is what the understood card renders from, so it belongs in the fixture.
    item: ranked(),
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
  // The conversation persists in localStorage, so each test starts from an empty one.
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("first impression", () => {
  test("opens on the conversation, not a list", async () => {
    stub({});
    render(<App />);

    expect(await screen.findByText(/Just tell me what/)).toBeInTheDocument();
    const nav = screen.getAllByRole("navigation", { name: "Sections" })[0];
    expect(within(nav).getByRole("button", { name: /Chat/ })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("the opening offers real sentences to try", async () => {
    stub({ view: view({ shortlist: [] }) });
    render(<App />);

    expect(await screen.findByRole("button", { name: /quarterly report/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /what should I do first/ })).toBeInTheDocument();
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

    expect(await screen.findByRole("alert")).toHaveTextContent("Cadence isn’t running");
  });

  test("offline parsing is stated under setup without alarm", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Setup/ }))[0]);

    expect(await screen.findByText("Offline rules")).toBeInTheDocument();
    expect(screen.getByText(/Works fine without a key/)).toBeInTheDocument();
  });
});

describe("the conversation", () => {
  test("your sentence appears as your own turn", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cadence"), "write the report{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText("write the report")).toBeInTheDocument();
  });

  test("the otter answers, and shows what it understood", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cadence"), "write the report{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText(/Added/)).toBeInTheDocument();
    // The understood card is what makes a wrong parse obvious at a glance.
    expect(within(log).getByText("write the quarterly report")).toBeInTheDocument();
    expect(within(log).getByText(/Task · 90 min/)).toBeInTheDocument();
  });

  test("asking what to do gets answered in the conversation", async () => {
    stub({ say: reply({ kind: "shown", message: "Here is what is next." }) });
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cadence"), "what should i do{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText(/Start with write the quarterly report/)).toBeInTheDocument();
    expect(within(log).getByText(/1\. write the quarterly report/)).toBeInTheDocument();
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

  test("an ambiguous reference comes back as a question in the conversation", async () => {
    stub({ say: { status: 409, detail: "“review” matches 2 items: review a, review b" } });
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cadence"), "done review{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText(/matches 2 items/)).toBeInTheDocument();
  });

  test("no dialog ever interrupts the conversation", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cadence"), "write it{Enter}");
    await screen.findByRole("log", { name: "Conversation" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("the conversation survives a reload", async () => {
    stub({});
    const first = render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Say something to Cadence"), "write the report{Enter}");
    await screen.findByRole("log", { name: "Conversation" });
    first.unmount();

    render(<App />);

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText("write the report")).toBeInTheDocument();
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
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);

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
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);

    await user.click(await screen.findByRole("button", { name: /Mark .* done/ }));

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes("/complete"))).toBe(true),
    );
  });

  test("pinning calls the backend", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);

    await user.click(await screen.findByRole("button", { name: /^Pin/ }));

    await waitFor(() => expect(calls.some((call) => call.url.includes("/pin"))).toBe(true));
  });

  test("an overdue task is called out", async () => {
    stub({ view: view({ shortlist: [ranked({ due: "2020-01-01T00:00:00+00:00" })] }) });
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);

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

    await user.click((await screen.findAllByRole("button", { name: /Calendar/ }))[0]);

    expect(await screen.findByText("review the budget")).toBeInTheDocument();
  });

  test("scheduling asks the backend to place everything", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);

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
    await screen.findByText(/Just tell me what/);

    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  test("undo appears once something has happened", async () => {
    stub({ view: view({ undo: "Added “write the report”" }) });
    render(<App />);

    expect((await screen.findAllByRole("button", { name: "Undo" })).length).toBeGreaterThan(0);
  });

  test("undo calls the backend", async () => {
    const calls = stub({ view: view({ undo: "Added something" }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: "Undo" }))[0]);

    await waitFor(() => expect(calls.some((call) => call.url.includes("/api/undo"))).toBe(true));
  });
});

describe("working hours", () => {
  test("setup states the boundary", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Setup/ }))[0]);

    expect(await screen.findByText(/Nothing is ever booked outside these hours/)).toBeInTheDocument();
  });

  test("changing the end hour saves it", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Setup/ }))[0]);

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
    await user.click((await screen.findAllByRole("button", { name: /Setup/ }))[0]);

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
    for (const label of ["Chat", "Plan", "Calendar", "Setup"]) {
      expect(within(nav).getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  test("both a rail and a tab bar exist, so CSS can choose", async () => {
    // Fluid layout with no width listener: the rail shows on wide screens, tabs on narrow.
    stub({});
    render(<App />);

    expect((await screen.findAllByRole("navigation", { name: "Sections" })).length).toBe(2);
  });

  test("each section counts its own contents", async () => {
    const booked = { ...ranked(), id: "b1", start_at: "2026-08-31T02:00:00+00:00" };
    stub({ view: view({ shortlist: [ranked()], scheduled: [booked] }) });
    render(<App />);

    const nav = (await screen.findAllByRole("navigation", { name: "Sections" }))[0];
    expect(within(nav).getByRole("button", { name: /Plan/ })).toHaveTextContent("1");
    expect(within(nav).getByRole("button", { name: /Calendar/ })).toHaveTextContent("1");
  });

  test("an empty plan explains where things come from", async () => {
    stub({ view: view({ shortlist: [], scheduled: [] }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);

    expect(await screen.findByText("Nothing to do")).toBeInTheDocument();
  });
});

describe("the calendar", () => {
  function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
    return {
      title: "Standup with the team",
      start_at: "2026-08-31T01:00:00+00:00",
      end_at: "2026-08-31T01:15:00+00:00",
      mine: false,
      ...overrides,
    };
  }

  async function openCalendar() {
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Calendar/ }))[0]);
    return user;
  }

  test("an empty calendar says how to fill it", async () => {
    stub({});
    render(<App />);

    await openCalendar();

    expect(await screen.findByText("Nothing on the calendar")).toBeInTheDocument();
  });

  test("your own Google events show up beside booked work", async () => {
    const booked = { ...ranked(), id: "b1", start_at: "2026-08-31T02:00:00+00:00", end_at: "2026-08-31T03:00:00+00:00" };
    stub({ view: view({ scheduled: [booked], events: [event()] }) });
    render(<App />);

    await openCalendar();

    expect(await screen.findByText("Standup with the team")).toBeInTheDocument();
    expect(screen.getByText("write the quarterly report")).toBeInTheDocument();
  });

  test("events Cadence created are not listed twice", async () => {
    // Our own blocks come back from Google too. `mine` marks them so only the local copy shows.
    const booked = { ...ranked(), id: "b1", title: "write the report", start_at: "2026-08-31T02:00:00+00:00", end_at: "2026-08-31T03:00:00+00:00" };
    stub({
      view: view({
        scheduled: [booked],
        events: [event({ title: "write the report", mine: true, start_at: "2026-08-31T02:00:00+00:00", end_at: "2026-08-31T03:00:00+00:00" })],
      }),
    });
    render(<App />);

    await openCalendar();

    expect(await screen.findAllByText("write the report")).toHaveLength(1);
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

  test("a booked block can be completed from the calendar", async () => {
    const booked = { ...ranked(), id: "b1", start_at: "2026-08-31T02:00:00+00:00", end_at: "2026-08-31T03:00:00+00:00" };
    const calls = stub({ view: view({ scheduled: [booked] }) });
    render(<App />);
    const user = await openCalendar();

    await user.click(await screen.findByRole("button", { name: /Mark .* done/ }));

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
  test("an unconfigured calendar says so under setup", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Setup/ }))[0]);

    expect(await screen.findByText("Not set up")).toBeInTheDocument();
  });

  test("configured but unconnected offers to connect", async () => {
    stub({ view: view({ calendar: { configured: true, connected: false, email: null } }) });
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Setup/ }))[0]);

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

    await user.click((await screen.findAllByRole("button", { name: /Calendar/ }))[0]);

    expect(await screen.findByText(/Synced with me@example.com/)).toBeInTheDocument();
  });
});

describe("the mascot", () => {
  test("the wordmark is real text, so it reads in both themes", async () => {
    // The supplied logo webp has dark ink baked in and vanished on black. Text inherits the
    // theme colour instead, which is why this asserts text rather than an image.
    stub({});
    render(<App />);

    // Rendered twice on purpose: once in the top bar, once in the wide-screen rail.
    expect((await screen.findAllByText("Cadence")).length).toBe(2);
  });

  test("every mascot image resolves and is contained", async () => {
    stub({ view: view({ shortlist: [] }) });
    render(<App />);
    await screen.findByText(/Just tell me what/);

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
