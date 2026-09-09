import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { CalendarEventFrame } from "../Frame";
import type { CalendarEvent } from "../types";

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
  test("keeps every attendee available in the scrollable detail frame", () => {
    const attendees = Array.from({ length: 10 }, (_, index) => ({
      email: `guest-${index + 1}@example.com`,
      name: `Guest ${index + 1}`,
      response_status: "accepted",
    }));

    render(<CalendarEventFrame event={event({ attendees })} timeZone="UTC" onClose={vi.fn()} />);

    expect(screen.getByText("Guest 1")).toBeInTheDocument();
    expect(screen.getByText("Guest 10")).toBeInTheDocument();
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
});
