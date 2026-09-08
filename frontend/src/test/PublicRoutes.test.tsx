import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";

import { PublicRoutes, readPublicRoute } from "../landing/PublicRoutes";

const props = {
  busy: false,
  error: null,
  authEnabled: true,
  authLoading: false,
  onSignIn: vi.fn(),
};

describe("public route surface", () => {
  test.each([
    ["/", "landing"],
    ["/login", "login"],
    ["/app", "landing"],
    ["/signup/", "signup"],
    ["/terms", "terms"],
    ["/privacy/", "privacy"],
    ["/unknown", "not-found"],
  ] as const)("maps %s to %s", (pathname, route) => {
    expect(readPublicRoute(pathname)).toBe(route);
  });

  test("renders a dedicated login surface", () => {
    render(<PublicRoutes route="login" {...props} />);

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Back to Cooper home" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  test("keeps the root branded while Firebase checks auth", () => {
    render(<PublicRoutes route="landing" {...props} authLoading />);

    expect(screen.getByRole("heading", { name: "Checking your account." })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Checking Firebase account" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Hi, I’m Cooper." })).not.toBeInTheDocument();
  });

  test("lets visitors view the overview if auth checking stalls", async () => {
    render(<PublicRoutes route="landing" {...props} authLoading />);

    await userEvent.setup().click(screen.getByRole("button", { name: "View the overview" }));

    expect(screen.getByRole("heading", { name: "Hi, I’m Cooper." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking your account…" })).toBeDisabled();
  });

  test("renders signup with a distinct intent", () => {
    render(<PublicRoutes route="signup" {...props} />);

    expect(screen.getByRole("heading", { name: "Get started" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your Cooper account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("keeps legal pages available without authentication", () => {
    render(<PublicRoutes route="terms" {...props} authEnabled={false} />);

    expect(screen.getByRole("heading", { name: "Terms of Use" })).toBeInTheDocument();
    expect(screen.getByText(/invited friends and family/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });

  test("gives an unknown address a clear route back to Cooper", () => {
    render(<PublicRoutes route="not-found" {...props} />);

    expect(screen.getByRole("heading", { name: "This page wandered off." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Cooper home" })).toHaveAttribute("href", "/");
  });

  test("explains unavailable hosted auth in local mode", () => {
    render(<PublicRoutes route="login" {...props} authEnabled={false} />);

    expect(screen.getByRole("button", { name: "Hosted sign-in unavailable" })).toBeDisabled();
  });

  test("keeps the landing sign-in action unavailable in local mode", () => {
    render(<PublicRoutes route="landing" {...props} authEnabled={false} />);

    expect(screen.getByRole("button", { name: "Hosted sign-in unavailable" })).toBeDisabled();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.getByText(/Email sign-in will be available/i)).toBeInTheDocument();
  });
});
