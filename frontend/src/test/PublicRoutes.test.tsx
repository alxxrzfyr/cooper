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
    expect(screen.getByText("Good to see you again.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(screen.queryByRole("link", { name: "Back to Cooper home" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
  });

  test("keeps the landing overview visible while Firebase checks auth", () => {
    render(<PublicRoutes route="landing" {...props} authLoading />);

    expect(screen.getByRole("heading", { name: "Hi, I’m Cooper." })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Checking your account." }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create your account" })[0]).toHaveAttribute(
      "href",
      "/signup",
    );
  });

  test("keeps login usable copy visible while Firebase checks auth", () => {
    render(<PublicRoutes route="login" {...props} authLoading />);

    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Checking your account." }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking your account…" })).toBeDisabled();
  });

  test("keeps signup usable copy visible while Firebase checks auth", () => {
    render(<PublicRoutes route="signup" {...props} authLoading />);

    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Checking your account." }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Checking your account…" })).toBeDisabled();
  });

  test("renders signup with a distinct intent", () => {
    render(<PublicRoutes route="signup" {...props} />);

    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByText("One task is enough to begin.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
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
    const passwordError = screen.getByRole("alert");
    expect(passwordError).toHaveTextContent("Passwords do not match.");
    expect(screen.getByLabelText("Re-enter your password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Re-enter your password")).toHaveAttribute(
      "aria-describedby",
      "password-error",
    );

    await user.clear(screen.getByLabelText("Re-enter your password"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Re-enter your password"), "cooper-secret");
    expect(screen.getByLabelText("Re-enter your password")).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    await user.click(screen.getByRole("button", { name: "Register with email" }));
    expect(onEmailAuth).toHaveBeenCalledWith("new@proton.com", "cooper-secret", "signup");
  });

  test("announces external auth failures without losing entered values", async () => {
    const user = userEvent.setup();
    render(<PublicRoutes route="login" {...props} error="Email or password did not match." />);

    const email = screen.getByLabelText("Email address");
    await user.type(email, "friend@example.com");

    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    expect(email).toHaveValue("friend@example.com");
  });

  test("keeps legal pages available without authentication", () => {
    render(<PublicRoutes route="terms" {...props} authEnabled={false} />);

    expect(screen.getByRole("heading", { name: "Terms of Use" })).toBeInTheDocument();
    expect(screen.getByText(/personal planning workspace in public beta/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute("href", "/");
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

  test("reveals the login password control only after the visitor types", async () => {
    const user = userEvent.setup();
    render(<PublicRoutes route="login" {...props} />);

    const password = screen.getByLabelText("Password");
    expect(screen.queryByRole("button", { name: "Show password" })).not.toBeInTheDocument();

    await user.type(password, "cooper-secret");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");

    await user.clear(password);
    expect(screen.queryByRole("button", { name: "Show password" })).not.toBeInTheDocument();
    expect(password).toHaveAttribute("type", "password");
  });

  test("keeps the landing CTA usable in local mode without embedding auth fields", () => {
    render(<PublicRoutes route="landing" {...props} authEnabled={false} />);

    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Create your account" })[0]).toHaveAttribute(
      "href",
      "/signup",
    );
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
