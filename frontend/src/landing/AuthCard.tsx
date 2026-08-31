export type AuthIntent = "login" | "signup";

interface AuthCardProps {
  intent: AuthIntent;
  busy: boolean;
  error: string | null;
  authEnabled: boolean;
  authLoading?: boolean;
  onSignIn: () => void;
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
}: AuthCardProps) {
  const copy = COPY[intent];
  const disabled = busy || authLoading || !authEnabled;
  const googleAction = intent === "login" ? "Sign in with Google" : "Register with Google";

  return (
    <section className="landing__auth-card" aria-labelledby="auth-card-title">
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
        disabled={disabled}
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

      {!authEnabled && (
        <p className="landing__availability">
          Hosted Google sign-in appears after Firebase is configured for this deployment.
        </p>
      )}

      {error && (
        <p className="landing__error" role="alert">
          {error}
        </p>
      )}

      <p className="landing__fineprint">
        No password to remember. Returning users use the same Google sign-in.
      </p>
    </section>
  );
}
