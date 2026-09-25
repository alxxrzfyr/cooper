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

  test("keeps the landing overview visible while Firebase checks auth", () => {
    render(<PublicRoutes route="landing" {...props} authLoading />);

    expect(screen.getByRole("heading", { name: "Hi, I’m Cooper." })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Checking your account." }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking your account…" })).toBeDisabled();
  });

  test("keeps login usable copy visible while Firebase checks auth", () => {
    render(<PublicRoutes route="login" {...props} authLoading />);

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Log in to Cooper" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Checking your account." }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking your account…" })).toBeDisabled();
  });

  test("keeps signup usable copy visible while Firebase checks auth", () => {
    render(<PublicRoutes route="signup" {...props} authLoading />);

    expect(screen.getByRole("heading", { name: "Get started" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Checking your account." }),
    ).not.toBeInTheDocument();
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

  test("email signup requires matching password confirmation before Firebase is called", async () => {
    const onEmailAuth = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<PublicRoutes route="signup" {...props} onEmailAuth={onEmailAuth} />);

    await user.type(screen.getByLabelText("Email address"), "new@proton.com");
    await user.type(screen.getByLabelText("Create your password"), "cooper-secret");
    await user.type(screen.getByLabelText("Re-enter your password"), "different-secret");
    await user.click(screen.getByRole("button", { name: "Register with email" }));
    expect(onEmailAuth).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Passwords do not match.");

    await user.clear(screen.getByLabelText("Re-enter your password"));
    await user.type(screen.getByLabelText("Re-enter your password"), "cooper-secret");
    await user.click(screen.getByRole("button", { name: "Register with email" }));
    expect(onEmailAuth).toHaveBeenCalledWith("new@proton.com", "cooper-secret", "signup");
  });

  test("keeps legal pages available without authentication", () => {
    render(<PublicRoutes route="terms" {...props} authEnabled={false} />);

    expect(screen.getByRole("heading", { name: "Terms of Use" })).toBeInTheDocument();
    expect(screen.getByText(/personal planning workspace in public beta/i)).toBeInTheDocument();
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

  test("keeps email and password fields usable in local mode", async () => {
    render(<PublicRoutes route="landing" {...props} authEnabled={false} />);

    expect(screen.getByRole("button", { name: "Hosted sign-in unavailable" })).toBeDisabled();
    const email = screen.getByLabelText("Email address");
    const password = screen.getByLabelText("Create your password");

    expect(email).toBeEnabled();
    expect(password).toBeEnabled();
    await userEvent.setup().type(email, "friend@example.com");
    await userEvent.setup().type(password, "cooper-secret");
    expect(email).toHaveValue("friend@example.com");
    expect(password).toHaveValue("cooper-secret");
  });

  test("opens a focused reset flow and confirms only after the reset request succeeds", async () => {
    const onResetPassword = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<PublicRoutes route="login" {...props} onResetPassword={onResetPassword} />);

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Email address"), "friend@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(onResetPassword).toHaveBeenCalledWith("friend@example.com");
    expect(
      await screen.findByText(
        "If an account matches that email, check your inbox for a reset link.",
      ),
    ).toBeInTheDocument();
  });

  test("does not claim a reset email was sent when the request fails", async () => {
    const onResetPassword = vi.fn(async () => {
      throw new Error("reset unavailable");
    });
    const user = userEvent.setup();
    render(<PublicRoutes route="login" {...props} onResetPassword={onResetPassword} />);

    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email address"), "friend@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await screen.findByRole("button", { name: "Send reset link" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
