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
    ["/signup/", "signup"],
    ["/terms", "terms"],
    ["/privacy/", "privacy"],
    ["/unknown", "landing"],
  ] as const)("maps %s to %s", (pathname, route) => {
    expect(readPublicRoute(pathname)).toBe(route);
  });

  test("renders a dedicated login surface", () => {
    render(<PublicRoutes route="login" {...props} />);

    expect(screen.getByRole("heading", { name: "Your day is still here." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  test("keeps the root branded while Firebase checks auth", () => {
    render(<PublicRoutes route="landing" {...props} authLoading />);

    expect(screen.getByRole("heading", { name: "Checking your account." })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Checking Firebase account" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /turn one sentence/i })).not.toBeInTheDocument();
  });

  test("lets visitors view the overview if auth checking stalls", async () => {
    render(<PublicRoutes route="landing" {...props} authLoading />);

    await userEvent.setup().click(screen.getByRole("button", { name: "View the overview" }));

    expect(screen.getByRole("heading", { name: /turn one sentence/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking your account…" })).toBeDisabled();
  });

  test("renders signup with a distinct intent", () => {
    render(<PublicRoutes route="signup" {...props} />);

    expect(screen.getByRole("heading", { name: "Make room for your day." })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your Cooper account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("keeps legal pages available without authentication", () => {
    render(<PublicRoutes route="terms" {...props} authEnabled={false} />);

    expect(screen.getByRole("heading", { name: "Terms of use" })).toBeInTheDocument();
    expect(screen.getByText(/invited friends and family/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute("href", "/privacy");
  });

  test("explains unavailable hosted auth in local mode", () => {
    render(<PublicRoutes route="login" {...props} authEnabled={false} />);

    expect(screen.getByRole("button", { name: "Hosted sign-in unavailable" })).toBeDisabled();
  });

  test("keeps the landing sign-in action unavailable in local mode", () => {
    render(<PublicRoutes route="landing" {...props} authEnabled={false} />);

    expect(screen.getByRole("button", { name: "Hosted sign-in unavailable" })).toBeDisabled();
  });
});
