export type AuthIntent = "login" | "signup";

interface AuthCardProps {
  intent: AuthIntent;
  busy: boolean;
  error: string | null;
  authEnabled: boolean;
  authLoading?: boolean;
  onSignIn: () => void;
}

const COPY: Record<AuthIntent, { kicker: string; title: string; description: string }> = {
  signup: {
    kicker: "A calmer day starts here",
    title: "Create your Cooper account",
    description: "Create a private Cooper workspace for your own tasks, events, and errands.",
  },
  login: {
    kicker: "Welcome back",
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

  return (
    <section className="landing__auth-card" aria-labelledby="auth-card-title">
      <p className="landing__auth-kicker">{copy.kicker}</p>
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
        {authLoading
          ? "Checking your account…"
          : busy
            ? "Opening Google…"
            : authEnabled
              ? "Continue with Google"
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
