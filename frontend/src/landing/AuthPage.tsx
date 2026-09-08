import "./auth.css";

import { Mascot } from "../Mascot";
import { AuthCard, type AuthIntent } from "./AuthCard";

interface AuthPageProps {
  intent: AuthIntent;
  busy: boolean;
  error: string | null;
  authEnabled: boolean;
  authLoading: boolean;
  onSignIn: () => void;
  onEmailAuth?: (email: string, password: string, intent: AuthIntent) => Promise<void>;
  authStatus?: "idle" | "verification-pending";
  onCheckVerification?: () => Promise<void>;
  onResendVerification?: () => Promise<void>;
  onResetPassword?: (email: string) => Promise<void>;
  onUseAnotherAccount?: () => void;
}

const PAGE_COPY: Record<AuthIntent, { title: string; description: string }> = {
  signup: {
    title: "Get started",
    description: "A small, steady place for the things you need to remember and do.",
  },
  login: {
    title: "Welcome back",
    description: "Log in to see what matters now and the time you have to make it happen.",
  },
};

function PublicBrand() {
  return (
    <a className="public-page__brand" href="/" aria-label="Cooper home">
      <Mascot name="cooper_avatar" size="xs" decorative loading="eager" />
      <span className="landing__wordmark">Cooper</span>
    </a>
  );
}

export function AuthPage({
  intent,
  busy,
  error,
  authEnabled,
  authLoading,
  onSignIn,
  onEmailAuth,
  authStatus,
  onCheckVerification,
  onResendVerification,
  onResetPassword,
  onUseAnotherAccount,
}: AuthPageProps) {
  const copy = PAGE_COPY[intent];

  return (
    <div className={`public-page auth-page auth-page--${intent}`}>
      <header className="public-page__header">
        <PublicBrand />
        <a className="public-page__back" href="/" aria-label="Back to Cooper home">
          <span aria-hidden="true">←</span>
          <span>
            Back to <span className="public-brand-name">Cooper</span>
          </span>
        </a>
      </header>

      <section className="auth-page__main" aria-labelledby="auth-page-title">
        <div className="auth-page__intro">
          <h1 id="auth-page-title">{copy.title}</h1>
          <p>{copy.description}</p>
          <div className="auth-page__note">
            <Mascot
              name={intent === "signup" ? "cooper_landing_ready" : "cooper_waving"}
              size="md"
              decorative
              loading="eager"
            />
            <span>
              {intent === "signup" ? "One task is enough to begin." : "Good to see you again."}
            </span>
          </div>
        </div>
        <AuthCard
          intent={intent}
          busy={busy}
          error={error}
          authEnabled={authEnabled}
          authLoading={authLoading}
          onSignIn={onSignIn}
          onEmailAuth={onEmailAuth}
          authStatus={authStatus}
          onCheckVerification={onCheckVerification}
          onResendVerification={onResendVerification}
          onResetPassword={onResetPassword}
          onUseAnotherAccount={onUseAnotherAccount}
        />
      </section>

      <footer className="public-page__footer">
        <span>
          <span className="public-brand-name">Cooper</span> © 2026 · for your own words and your own
          time.
        </span>
        <nav aria-label="Legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </footer>
    </div>
  );
}
