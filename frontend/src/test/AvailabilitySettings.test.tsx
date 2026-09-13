import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { AvailabilitySettings } from "../AvailabilitySettings";
import type { Hours } from "../types";

test("editing standard hours clears active custom windows", async () => {
  const hours: Hours = {
    start_hour: 9,
    end_hour: 18,
    weekdays: [0, 1, 2, 3, 4],
    max_per_day: 4,
    timezone: "UTC",
    windows: [[0, 1320, 120]],
    break_minutes: 10,
    max_minutes_per_day: null,
  };
  const save = vi.fn(async (_next: Hours) => undefined);
  render(<AvailabilitySettings hours={hours} busy={false} onSave={save} />);

  expect(screen.getByText(/Custom windows are active/)).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Day starts at"), "8");

  expect(save).toHaveBeenCalledWith(expect.objectContaining({ start_hour: 8, windows: null }));
});
