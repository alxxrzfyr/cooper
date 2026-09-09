import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { Landing } from "../landing/LandingPage";

describe("public landing", () => {
  test("shows the value proposition and both account intents", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Hi, I’m Cooper." })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create account" })).not.toHaveLength(0);
    expect(screen.getAllByRole("link", { name: "Log in" })).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Register with Google" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "One thought in. A clear day out." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Private by design")).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, element) => element?.textContent?.replace(/\s+/g, " ").trim() === "Cooper © 2026",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
    expect(
      screen.getByText("Cooper is currently in public beta · The app is still under construction"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Landing sections" })).not.toBeInTheDocument();
    expect(
      document.querySelector("#landing-meet .landing__cooper-portrait .mascot"),
    ).toHaveAttribute("src", "/assets/mascot/cooper_avatar.webp");
    expect(
      screen.getByRole("img", { name: "Cooper calendar showing protected working hours" }),
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

    await userEvent.setup().click(screen.getByRole("button", { name: "Register with Google" }));

    expect(onSignIn).toHaveBeenCalledOnce();
  });

  test("shows an email form and submits the current auth intent", async () => {
    const onEmailAuth = vi.fn(async () => undefined);
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} onEmailAuth={onEmailAuth} />);

    expect(screen.getByLabelText("Email address")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    await userEvent.setup().type(screen.getByLabelText("Email address"), "friend@example.com");
    await userEvent.setup().type(screen.getByLabelText("Password"), "password");
    await userEvent.setup().click(screen.getByRole("button", { name: "Register with email" }));

    expect(onEmailAuth).toHaveBeenCalledWith("friend@example.com", "password", "signup");
  });
});
