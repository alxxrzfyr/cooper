import { Mascot } from "../Mascot";
import { AuthCard, type AuthIntent } from "./AuthCard";

interface AuthPageProps {
  intent: AuthIntent;
  busy: boolean;
  error: string | null;
  authEnabled: boolean;
  authLoading: boolean;
  onSignIn: () => void;
}

const PAGE_COPY: Record<AuthIntent, { title: string; description: string }> = {
  signup: {
    title: "Make room for your day.",
    description: "A small, steady place for the things you need to remember and do.",
  },
  login: {
    title: "Your day is still here.",
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
}: AuthPageProps) {
  const copy = PAGE_COPY[intent];

  return (
    <div className="public-page auth-page">
      <header className="public-page__header">
        <PublicBrand />
        <a className="public-page__back" href="/">
          See how Cooper works
        </a>
      </header>

      <section className="auth-page__main" aria-labelledby="auth-page-title">
        <div className="auth-page__intro">
          <p className="landing__eyebrow">
            {intent === "signup" ? "Get started" : "Your workspace"}
          </p>
          <h1 id="auth-page-title">{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <AuthCard
          intent={intent}
          busy={busy}
          error={error}
          authEnabled={authEnabled}
          authLoading={authLoading}
          onSignIn={onSignIn}
        />
      </section>

      <footer className="public-page__footer">
        <span>Cooper is for your own words and your own time.</span>
        <nav aria-label="Legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </footer>
    </div>
  );
}
