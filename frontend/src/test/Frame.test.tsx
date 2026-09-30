import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { CalendarEventFrame, TaskFrame } from "../Frame";
import type { CalendarEvent, Item } from "../types";

const estimateTask: Item = {
  id: "estimate-task",
  owner_id: "me",
  source: "me",
  source_ref: null,
  kind: "task",
  title: "Unknown effort",
  notes: null,
  minutes: null,
  importance: 3,
  category: "work",
  due: null,
  start_at: null,
  end_at: null,
  google_event_id: null,
  status: "open",
  pinned: false,
  created_at: "2026-09-30T10:00:00Z",
};

function estimateFrame(onEstimate: (minutes: number) => Promise<boolean>, item = estimateTask) {
  const onClose = vi.fn();
  render(
    <TaskFrame
      item={item}
      today="2026-09-30"
      busy={false}
      onClose={onClose}
      onComplete={vi.fn()}
      onPin={vi.fn()}
      onDrop={vi.fn()}
      onEstimate={onEstimate}
    />,
  );
  return onClose;
}

describe("task estimates", () => {
  test("keeps keyboard navigation inside details and restores the launch control", async () => {
    const user = userEvent.setup();
    render(<button>Open estimate</button>);
    const launcher = screen.getByRole("button", { name: "Open estimate" });
    await user.click(launcher);
    const close = vi.fn();
    const frame = render(
      <TaskFrame
        item={estimateTask}
        today="2026-09-30"
        busy={false}
        onClose={close}
        onComplete={vi.fn()}
        onPin={vi.fn()}
        onDrop={vi.fn()}
        onEstimate={async () => true}
      />,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("button", { name: "Delete" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(close).toHaveBeenCalledTimes(1);
    frame.unmount();
    expect(launcher).toHaveFocus();
  });
  test.each(["0", "1441", "1.5", ""])("rejects invalid estimate %s without saving", (value) => {
    const save = vi.fn(async () => true);
    estimateFrame(save);
    const input = screen.getByLabelText("Estimated minutes");
    fireEvent.change(input, { target: { value } });
    fireEvent.submit(input.closest("form")!);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("whole number");
  });

  test("retains a failed draft and closes only after successful retry", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const close = estimateFrame(save);
    await user.type(screen.getByLabelText("Estimated minutes"), "45");
    await user.click(screen.getByRole("button", { name: "Save estimate" }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Estimated minutes")).toHaveValue(45);
    expect(screen.getByRole("alert")).toHaveTextContent("draft is still here");
    await user.click(screen.getByRole("button", { name: "Save estimate" }));
    expect(save).toHaveBeenNthCalledWith(2, 45);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("prevents concurrent submissions", async () => {
    let finish: (saved: boolean) => void = () => {};
    const save = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const close = estimateFrame(save);
    const input = screen.getByLabelText("Estimated minutes");
    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.submit(input.closest("form")!);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await act(async () => finish(true));
    expect(close).toHaveBeenCalledTimes(1);
  });

  test.each([
    { source: "gmail" as const },
    { start_at: "2026-09-30T11:00:00Z" },
    { status: "done" as const },
    { kind: "event" as const },
  ])("restricts editing to open unscheduled local tasks: %j", (overrides) => {
    estimateFrame(
      vi.fn(async () => true),
      { ...estimateTask, ...overrides },
    );
    expect(screen.queryByLabelText("Estimated minutes")).not.toBeInTheDocument();
  });
});

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    title: "Planning session",
    start_at: "2026-09-09T09:00:00+00:00",
    end_at: "2026-09-09T10:00:00+00:00",
    category: "work",
    mine: false,
    source: "google",
    ...overrides,
  };
}

describe("calendar event details", () => {
  test("shows both dates for a multi-day all-day event without shifting Google's date", () => {
    render(
      <CalendarEventFrame
        event={event({
          all_day: true,
          start_at: "2026-09-09T00:00:00Z",
          end_at: "2026-09-12T00:00:00Z",
          time_zone: "America/Los_Angeles",
        })}
        timeZone="UTC"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/September 9, 2026.*September 11, 2026.*All day/)).toBeInTheDocument();
  });

  test("preserves literal Apple description text and rejects unsafe meeting links", () => {
    render(
      <CalendarEventFrame
        event={event({
          source: "icloud",
          description: "Bring <agenda> and <notes>",
          meeting_url: "javascript:alert(1)",
        })}
        timeZone="UTC"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Bring <agenda> and <notes>")).toBeInTheDocument();
    expect(screen.queryByText("Join meeting")).not.toBeInTheDocument();
  });
  test("keeps every attendee available in the scrollable detail frame", () => {
    const attendees = Array.from({ length: 10 }, (_, index) => ({
      email: `guest-${index + 1}@example.com`,
      name: `Guest ${index + 1}`,
      response_status: "accepted",
    }));

    render(<CalendarEventFrame event={event({ attendees })} timeZone="UTC" onClose={vi.fn()} />);

    expect(screen.getByText("Guest 1")).toBeInTheDocument();
    expect(screen.getByText("Guest 10")).toBeInTheDocument();
    expect(screen.getByText("guest-10@example.com")).toBeInTheDocument();
    expect(screen.getAllByText("Accepted")).toHaveLength(10);
    expect(screen.getByText("10 guests")).toBeInTheDocument();
  });

  test("keeps the end of a long event description available in the detail frame", () => {
    const description = Array.from(
      { length: 24 },
      (_, index) => `Detail ${index + 1}: This event information remains available.`,
    ).join("\n");

    const { container } = render(
      <CalendarEventFrame event={event({ description })} timeZone="UTC" onClose={vi.fn()} />,
    );
    const detailBody = container.ownerDocument.querySelector(".frame__description");
    const scrollBody = container.ownerDocument.querySelector(".frame__body");
    const rows = container.ownerDocument.querySelector(".event-rows");

    expect(detailBody).toHaveTextContent("Detail 1: This event information remains available.");
    expect(detailBody).toHaveTextContent("Detail 24: This event information remains available.");
    expect(scrollBody).toBeTruthy();
    expect(rows).toBeTruthy();
  });

  test("renders provider links, reminders, and attachments without the extra metadata section", () => {
    render(
      <CalendarEventFrame
        event={event({
          calendar_name: "Primary calendar",
          organizer_name: "Calendar owner",
          organizer_email: "owner@example.com",
          links: [{ label: "Event link", url: "https://calendar.google.com/event" }],
          reminders: [{ method: "email", minutes: 30, use_default: false }],
          attachments: [
            {
              title: "Launch brief.pdf",
              url: "https://drive.google.com/brief",
              mime_type: "application/pdf",
            },
          ],
          metadata: [{ label: "visibility", value: "private" }],
        })}
        timeZone="UTC"
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Primary calendar")).toBeInTheDocument();
    expect(screen.getByText(/owner@example\.com/)).toBeInTheDocument();
    expect(screen.getByText("Event link")).toBeInTheDocument();
    expect(screen.getByText("email · 30 minutes before")).toBeInTheDocument();
    expect(screen.getByText("Launch brief.pdf")).toBeInTheDocument();
    expect(screen.queryByText("Additional event information")).not.toBeInTheDocument();
    expect(screen.queryByText("visibility")).not.toBeInTheDocument();
  });
});
