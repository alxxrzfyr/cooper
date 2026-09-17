import { useState, type FormEvent } from "react";

export type AuthIntent = "login" | "signup";

interface AuthCardProps {
  intent: AuthIntent;
  busy: boolean;
  error: string | null;
  authEnabled: boolean;
  authLoading?: boolean;
  onSignIn: () => void;
  onEmailAuth?: (email: string, password: string, intent: AuthIntent) => Promise<void>;
  authStatus?: "idle" | "verification-pending";
  onCheckVerification?: () => Promise<void>;
  onResendVerification?: () => Promise<void>;
  onResetPassword?: (email: string) => Promise<void>;
  onUseAnotherAccount?: () => void;
}

const COPY: Record<AuthIntent, { title: string; description: string }> = {
  signup: {
    title: "Create your Cooper account",
    description: "Create a private Cooper workspace for your own tasks, events, and errands.",
  },
  login: {
    title: "Log in to Cooper",
    description: "Return to your private workspace and the commitments you already made.",
  },
};

/** Shared sign-in action for the landing page and the dedicated auth pages. */
export function AuthCard({
  intent,
  busy,
  error,
  authEnabled,
  authLoading = false,
  onSignIn,
  onEmailAuth,
  authStatus = "idle",
  onCheckVerification,
  onResendVerification,
  onResetPassword,
  onUseAnotherAccount,
}: AuthCardProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const copy = COPY[intent];
  const disabled = busy || authLoading;
  const googleDisabled = disabled || !authEnabled;
  const googleAction = intent === "login" ? "Sign in with Google" : "Register with Google";
  const emailAction = intent === "login" ? "Sign in with email" : "Register with email";

  if (authStatus === "verification-pending") {
    return (
      <section className="landing__auth-card" aria-labelledby="auth-card-title" aria-busy={busy}>
        <h2 id="auth-card-title">Check your email</h2>
        <p>We sent a verification link. Confirm it, then come back here to open Cooper.</p>
        <div className="landing__auth-actions">
          <button
            type="button"
            className="landing__email-submit"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void onCheckVerification?.()}
          >
            {busy ? "Checking…" : "I’ve verified my email"}
          </button>
          <button
            type="button"
            className="landing__secondary"
            disabled={busy}
            aria-busy={busy}
            onClick={() => void onResendVerification?.()}
          >
            Resend verification email
          </button>
        </div>
        <p className="landing__fineprint">
          Still waiting? Check spam, or use another account below.
        </p>
        <button
          type="button"
          className="landing__text-button"
          onClick={onUseAnotherAccount ?? onSignIn}
        >
          Use another account
        </button>
        {error && (
          <p className="landing__error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  function submitEmail(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (disabled || !onEmailAuth) return;
    if (intent === "signup" && password !== passwordConfirmation) {
      setPasswordError("Passwords do not match.");
      return;
    }
    setPasswordError(null);
    void onEmailAuth(email.trim(), password, intent);
  }

  function submitReset(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!onResetPassword) return;
    setResetSent(false);
    void onResetPassword(email.trim()).then(
      () => setResetSent(true),
      () => setResetSent(false),
    );
  }

  if (resetMode) {
    return (
      <section className="landing__auth-card" aria-labelledby="auth-card-title" aria-busy={busy}>
        <h2 id="auth-card-title">Reset your password</h2>
        <p>Enter your email and we&rsquo;ll send a link to choose a new password.</p>
        <form className="landing__email-form" onSubmit={submitReset}>
          <label>
            Email address
            <input
              type="email"
              name="reset-email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={disabled}
              required
            />
          </label>
          <button
            type="submit"
            className="landing__email-submit"
            disabled={disabled || !onResetPassword}
            aria-busy={busy}
          >
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <button
            type="button"
            className="landing__text-button"
            disabled={disabled}
            onClick={() => {
              setResetMode(false);
              setResetSent(false);
            }}
          >
            Back to log in
          </button>
          {resetSent && (
            <p className="landing__success" role="status">
              If an account matches that email, check your inbox for a reset link.
            </p>
          )}
        </form>
        {!authEnabled && (
          <p className="landing__availability">
            You can enter your email now. Connect Firebase to send a reset link.
          </p>
        )}
        {error && (
          <p className="landing__error" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="landing__auth-card" aria-labelledby="auth-card-title" aria-busy={disabled}>
      <h2 id="auth-card-title">{copy.title}</h2>
      <p>{copy.description}</p>

      <nav className="landing__auth-switch" aria-label="Account action">
        <a href="/signup" aria-current={intent === "signup" ? "page" : undefined}>
          Create account
        </a>
        <a href="/login" aria-current={intent === "login" ? "page" : undefined}>
          Log in
        </a>
      </nav>

      <button
        type="button"
        className={`landing__google${!authEnabled ? " landing__google--unavailable" : ""}`}
        disabled={googleDisabled}
        aria-busy={authLoading || busy}
        onClick={onSignIn}
      >
        {authEnabled && (
          <svg className="landing__google-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z"
            />
            <path
              fill="#34A853"
              d="M12 22c2.7 0 4.98-.9 6.63-2.38l-3.24-2.53c-.9.6-2.05.96-3.39.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.61A10 10 0 0 0 12 22Z"
            />
            <path
              fill="#FBBC05"
              d="M6.39 13.92A6 6 0 0 1 6.08 12c0-.67.11-1.32.31-1.92V7.47H3.04A10 10 0 0 0 2 12c0 1.61.39 3.14 1.04 4.53l3.35-2.61Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.47l3.35 2.61C7.18 7.71 9.39 5.95 12 5.95Z"
            />
          </svg>
        )}
        {authLoading
          ? "Checking your account…"
          : busy
            ? "Opening Google…"
            : authEnabled
              ? googleAction
              : "Hosted sign-in unavailable"}
      </button>

      <div className="landing__auth-divider" aria-hidden="true">
        <span>or continue with email</span>
      </div>

      <form
        className={`landing__email-form${intent === "signup" ? " landing__email-form--signup" : ""}`}
        onSubmit={submitEmail}
      >
        <label>
          Email address
          <input
            type="email"
            name="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={disabled}
            required
          />
        </label>
        <label>
          {intent === "signup" ? "Create your password" : "Password"}
          <span className="landing__password-control">
            <input
              type={passwordVisible ? "text" : "password"}
              name="password"
              autoComplete={intent === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError(null);
              }}
              disabled={disabled}
              minLength={6}
              required
            />
            <button
              type="button"
              className="landing__password-toggle"
              aria-label={passwordVisible ? "Hide password" : "Show password"}
              aria-pressed={passwordVisible}
              disabled={disabled}
              onClick={() => setPasswordVisible((visible) => !visible)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                <circle cx="12" cy="12" r="2.75" />
              </svg>
            </button>
          </span>
        </label>
        {intent === "signup" && (
          <label>
            Re-enter your password
            <input
              type="password"
              name="password-confirmation"
              autoComplete="new-password"
              value={passwordConfirmation}
              onChange={(event) => {
                setPasswordConfirmation(event.target.value);
                setPasswordError(null);
              }}
              disabled={disabled}
              minLength={6}
              required
            />
          </label>
        )}
        {passwordError && (
          <p className="landing__error" role="alert">
            {passwordError}
          </p>
        )}
        <button
          type="submit"
          className="landing__email-submit"
          disabled={disabled}
          aria-busy={busy}
        >
          {busy ? "Working…" : emailAction}
        </button>
        {intent === "login" && (
          <button type="button" className="landing__text-button" onClick={() => setResetMode(true)}>
            Forgot password?
          </button>
        )}
      </form>

      {!authEnabled && (
        <p className="landing__availability">
          You can fill in your details now. Connect Firebase to complete email sign-in.
        </p>
      )}

      {error && (
        <p className="landing__error" role="alert">
          {error}
        </p>
      )}

      <p className="landing__fineprint">
        Your account stays private to you. Cooper never shares your tasks or calendar.
      </p>
    </section>
  );
}
