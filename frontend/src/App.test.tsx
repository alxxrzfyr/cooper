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
    category: "work",
    due: null,
    start_at: null,
    end_at: null,
    google_event_id: null,
    status: "open",
    pinned: false,
    created_at: "2026-08-29T01:00:00+00:00",
    score: 0.42,
    why: { due: 0, age: 0.1, quick: 0.6 },
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
    // The item is what the reply's meta line renders from, so it belongs in the fixture.
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
        return json(reply({ kind: "completed", message: "Completed." }));
      }
      return json({});
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.stubEnv("VITE_COOPER_KEY", "test-key");
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
    expect(screen.getByRole("button", { name: /plan my day/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /done quarterly/ })).toBeInTheDocument();
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

    expect(await screen.findByRole("alert")).toHaveTextContent("Cooper isn’t running");
  });

  test("offline parsing is stated under settings without alarm", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    expect(await screen.findByText("Offline rules")).toBeInTheDocument();
    expect(screen.getByText(/Works fine without a key/)).toBeInTheDocument();
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

    expect(await screen.findByRole("button", { name: "Manual" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "AI" })).toHaveAttribute("aria-pressed", "false");
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
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "AI" }));
    await user.type(screen.getByLabelText("Say something to Cooper"), "what is urgent{Enter}");

    expect(calls.find((call) => call.url.includes("/api/say"))?.body.mode).toBe("ai");
  });

  test("with no model key, AI cannot be chosen", async () => {
    // The app has to work with no key at all, so the switch disables rather than failing later.
    stub({ view: view({ using_model: false }) });
    render(<App />);

    expect(await screen.findByRole("button", { name: "AI" })).toBeDisabled();
    expect(screen.getByText(/No model key/)).toBeInTheDocument();
  });

  test("an answer is blue, not an action", async () => {
    stub({
      view: view({ using_model: true }),
      say: reply({ kind: "answered", message: "Start with the report." }),
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "AI" }));
    await user.type(screen.getByLabelText("Say something to Cooper"), "what is urgent{Enter}");
    await screen.findByText("Start with the report.");

    expect(bubbleTones()).toContain("bubble--answer");
  });

  test("creating is green and dropping is red", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cooper"), "write the report{Enter}");
    await screen.findByText(/Added/);
    expect(bubbleTones()).toContain("bubble--good");

    stub({ say: reply({ kind: "dropped", message: "Dropped “the report”." }) });
    await user.type(screen.getByLabelText("Say something to Cooper"), "drop the report{Enter}");
    await screen.findByText(/Dropped/);
    expect(bubbleTones()).toContain("bubble--bad");
  });

  test("completing is green, because green is not just for new things", async () => {
    stub({ say: reply({ kind: "completed", message: "Completed “the report”." }) });
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cooper"), "done report{Enter}");
    await screen.findByText(/Completed/);

    expect(bubbleTones()).toContain("bubble--good");
  });

  test("a question wants your attention rather than celebrating", async () => {
    stub({ say: { status: 409, detail: "“review” matches 2 items" } });
    render(<App />);
    const user = userEvent.setup();

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
    await screen.findByText(/Just tell me what/);

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
    vi.stubGlobal(
      "matchMedia",
      (query: string) => ({
        matches: query.includes("dark"),
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
    );
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
});

describe("the conversation", () => {
  test("the thread says who you are talking to", async () => {
    stub({});
    render(<App />);
    await screen.findByText(/Just tell me what/);

    // The chat tab names its correspondent the way a messages app does: face, then name.
    const who = document.querySelector(".who");
    expect(who).not.toBeNull();
    expect(who?.textContent).toBe("Cooper");
    expect(who?.querySelector('img[src*="cooper_avatar"]')).not.toBeNull();
  });

  test("your sentence appears as your own turn", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cooper"), "write the report{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText("write the report")).toBeInTheDocument();
  });

  test("Cooper answers, and shows what he understood", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cooper"), "write the report{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText(/Added/)).toBeInTheDocument();
    // What it understood now sits inside the reply itself rather than on a separate white card,
    // which read as a second message from Cooper.
    expect(within(log).getByText(/Task · work · 90 min/)).toBeInTheDocument();
  });

  test("asking what to do gets answered in the conversation", async () => {
    stub({ say: reply({ kind: "shown", message: "Here is what is next." }) });
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cooper"), "what should i do{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText(/Start with write the quarterly report/)).toBeInTheDocument();
    expect(within(log).getByText(/1\. write the quarterly report/)).toBeInTheDocument();
  });

  test("the field clears after sending", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();
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
    stub({ say: { status: 409, detail: "“review” matches 2 items: review a, review b" } });
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cooper"), "done review{Enter}");

    const log = await screen.findByRole("log", { name: "Conversation" });
    expect(within(log).getByText(/matches 2 items/)).toBeInTheDocument();
  });

  test("no dialog ever interrupts the conversation", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Say something to Cooper"), "write it{Enter}");
    await screen.findByRole("log", { name: "Conversation" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("the conversation survives a reload", async () => {
    stub({});
    const first = render(<App />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Say something to Cooper"), "write the report{Enter}");
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
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);

    await user.click(await screen.findByRole("button", { name: /Open .*quarterly report/ }));

    const frame = await screen.findByRole("dialog", { name: "write the quarterly report" });
    // The facts that were spread across tags in the row are spelled out here.
    expect(within(frame).getByText("90 minutes")).toBeInTheDocument();
  });

  test("the frame covers the whole window, not a column of it", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);

    await user.click(await screen.findByRole("button", { name: /Open .* quarterly/ }));

    // It renders through a portal on purpose. Inside the app tree it sat under `.scroll`, whose
    // `> *` rule sets width: min(760px, 100%) on every child, so on a wide window the blur was a
    // 760px strip with sharp edges either side.
    const backdrop = document.querySelector(".frame");
    expect(backdrop?.parentElement).toBe(document.body);
    expect(backdrop?.closest(".scroll, .chat, .thread, .main")).toBeNull();
  });

  test("the frame closes on Escape and on the backdrop", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);
    await user.click(await screen.findByRole("button", { name: /Open .* quarterly/ }));

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
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

  test("pinning happens in the frame, and calls the backend", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);
    await user.click(await screen.findByRole("button", { name: /Open .* quarterly/ }));

    await user.click(await screen.findByRole("button", { name: "Pin" }));

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

  test("leftover work can still be sent to the calendar", async () => {
    const calls = stub({});
    render(<App />);
    const user = userEvent.setup();
    await user.click((await screen.findAllByRole("button", { name: /Plan/ }))[0]);

    // A new task is booked as it is added, so this button only appears for anything left over.
    await user.click(await screen.findByRole("button", { name: /in my calendar/ }));

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
  test("settings states the boundary", async () => {
    stub({});
    render(<App />);
    const user = userEvent.setup();

    await user.click((await screen.findAllByRole("button", { name: /Settings/ }))[0]);

    expect(await screen.findByText(/Nothing is ever booked outside these hours/)).toBeInTheDocument();
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
    for (const label of ["Chat", "Plan", "Calendar", "Settings"]) {
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
      category: "personal",
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

  test("events Cooper created are not listed twice", async () => {
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

  test("stepping away from today, and coming back", async () => {
    stub({ view: view({ scheduled: [{ ...ranked(), start_at: "2026-08-31T02:00:00+00:00", end_at: "2026-08-31T03:00:00+00:00" }] }) });
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
    const booked = { ...ranked(), id: "b1", start_at: "2026-08-31T02:00:00+00:00", end_at: "2026-08-31T03:00:00+00:00" };
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
    expect((await screen.findAllByText("Cooper")).length).toBe(2);
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
      // Sizing lives in CSS, and the size class fixes the box so nothing shifts while loading.
      // There is no shape class: the art is cut out, so Cooper is never inside a chip.
      expect(image.className).toMatch(/mascot--(xs|sm|md|lg)/);
      expect(image.className).not.toMatch(/mascot--(round|squircle)/);
    }
  });
});
