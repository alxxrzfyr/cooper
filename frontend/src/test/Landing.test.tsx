import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Landing } from "../landing/LandingPage";

describe("public landing", () => {
  test("shows the value proposition and both account intents", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Hi, I’m Cooper." })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create your account" })[0]).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.getAllByRole("link", { name: "Log in" })).not.toHaveLength(0);
    expect(
      screen.getByRole("heading", { name: "One thought in. A clear day out." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready for a calmer day?" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Messy thought in. Realistic time out." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Say it naturally" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Busy time stays protected" })).toBeInTheDocument();
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
    expect(document.querySelector("#landing-meet .landing__hero-cooper")).toHaveAttribute(
      "src",
      "/assets/mascot/cooper_landing_hero.webp",
    );
    expect(
      screen.getByRole("img", { name: "Cooper calendar showing protected working hours" }),
    ).toBeInTheDocument();
  });

  test("links each account intent to its dedicated public route", () => {
    const onSignIn = vi.fn();
    render(<Landing busy={false} error={null} onSignIn={onSignIn} />);

    expect(screen.getAllByRole("link", { name: "Log in" })[0]).toHaveAttribute("href", "/login");
    expect(screen.getAllByRole("link", { name: "Create your account" })[0]).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  test("does not render a first-panel scroll cue", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(screen.queryByText("Keep going")).not.toBeInTheDocument();
  });

  test("keeps the product proof before the final account invitation", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    const sections = Array.from(document.querySelectorAll(".landing__panel")).map(
      (section) => section.id,
    );

    expect(sections).toEqual([
      "landing-meet",
      "landing-features",
      "landing-uses",
      "landing-proof",
      "landing-start",
    ]);
  });

  test("keeps account forms on the dedicated auth pages", () => {
    render(<Landing busy={false} error={null} onSignIn={vi.fn()} />);

    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Create your password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Register with Google" })).not.toBeInTheDocument();
  });
});
