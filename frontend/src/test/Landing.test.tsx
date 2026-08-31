import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { Landing } from "../landing/LandingPage";

describe("public landing", () => {
  test("shows the value proposition and both account intents", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Your day, untangled." })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create account" })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Log in" })).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Say it once. See what matters." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Read-only by default")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Product sections" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Landing sections" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Cooper Home screen with the day view" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Cooper AI chat screen with suggested questions" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Cooper Calendar screen with the weekly schedule grid" }),
    ).toBeInTheDocument();
  });

  test("links each account intent to its dedicated public route", () => {
    const onSignIn = vi.fn();
    render(<Landing busy={false} error={null} onSignIn={onSignIn} />);

    expect(screen.getAllByRole("link", { name: "Log in" })[0]).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: "Create account" })[0]).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  test("shows sign-in errors and disables the Google action while redirecting", () => {
    render(<Landing busy={true} error="Could not start sign in." onSignIn={vi.fn()} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Could not start sign in.");
    expect(screen.getByRole("button", { name: "Opening Google…" })).toBeDisabled();
  });

  test("uses the existing Google sign-in action", async () => {
    const onSignIn = vi.fn();
    render(<Landing busy={false} error={null} onSignIn={onSignIn} />);

    await userEvent.setup().click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(onSignIn).toHaveBeenCalledOnce();
  });
});
