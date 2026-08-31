import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { Landing } from "./Landing";

describe("public landing", () => {
  test("shows the value proposition and both account intents", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /a calmer place/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Create account" })).not.toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Log in" })).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Capture" })).toBeInTheDocument();
    expect(screen.getByText("Read-only by default")).toBeInTheDocument();
  });

  test("switches the auth intent without changing the sign-in action", async () => {
    const onSignIn = vi.fn();
    const user = userEvent.setup();
    render(<Landing busy={false} error={null} onSignIn={onSignIn} />);

    const header = screen.getByRole("banner");
    await user.click(within(header).getByRole("button", { name: "Log in" }));

    expect(screen.getByRole("heading", { name: "Log in to Cooper" })).toBeInTheDocument();
    const authSwitch = screen.getByRole("group", { name: "Account action" });
    expect(within(authSwitch).getByRole("button", { name: "Log in" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));
    expect(onSignIn).toHaveBeenCalledTimes(1);
  });

  test("shows sign-in errors and disables the Google action while redirecting", () => {
    render(<Landing busy={true} error="Could not start sign in." onSignIn={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not start sign in.");
    expect(screen.getByRole("button", { name: "Opening Google…" })).toBeDisabled();
  });
});
