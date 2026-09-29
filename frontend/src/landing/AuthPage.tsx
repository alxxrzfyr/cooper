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
  const previews: Array<[string, string, number, number]> =
    intent === "signup"
      ? [
          ["Calendar", "/assets/landing/cooper-app-calendar.webp", 1920, 960],
          ["Ask Cooper", "/assets/landing/cooper-app-ai.webp", 1440, 680],
          ["Home", "/assets/landing/cooper-app-home.webp", 1440, 680],
        ]
      : [];

  return (
    <div className={`public-page auth-page auth-page--${intent}`}>
      <main className="auth-page__main" aria-labelledby="auth-card-title">
        <aside className="auth-page__visual" aria-label="Cooper welcome">
          <PublicBrand />
          <div className="auth-page__visual-message">
            <div
              className={`auth-page__showcase auth-page__showcase--${intent}`}
              aria-hidden="true"
            >
              {previews.map(([label, src, width, height], index) => (
                <div className={`auth-page__preview auth-page__preview--${index + 1}`} key={label}>
                  <div className="auth-page__preview-bar">
                    <span>{label}</span>
                  </div>
                  <img
                    src={src}
                    alt=""
                    width={width}
                    height={height}
                    loading={index === 0 ? "eager" : "lazy"}
                  />
                </div>
              ))}
              <div className="auth-page__mascot-stage">
                {intent === "login" ? (
                  <img
                    className="auth-page__login-scene"
                    src="/assets/auth/login-cooper-planner.png"
                    alt=""
                    width={1254}
                    height={1254}
                    loading="eager"
                  />
                ) : (
                  <>
                    <img
                      className="auth-page__visual-asset auth-page__visual-asset--signup"
                      src="/assets/auth/cooper-ground-vignette.png"
                      alt=""
                      width={1086}
                      height={362}
                      loading="eager"
                    />
                    <Mascot name="cooper_landing_ready" size="lg" decorative loading="eager" />
                  </>
                )}
              </div>
            </div>
            <p>{intent === "login" ? "Good to see you again." : "One task is enough to begin."}</p>
          </div>
        </aside>

        <section className="auth-page__form-panel" aria-label="Account access">
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
          <footer className="public-page__footer">
            <span>
              <span className="public-brand-name">Cooper</span> © 2026 · for your own words and your
              own time.
            </span>
            <nav aria-label="Legal">
              <a href="/terms" target="_blank" rel="noopener noreferrer">
                Terms
              </a>
              <a href="/privacy" target="_blank" rel="noopener noreferrer">
                Privacy
              </a>
            </nav>
          </footer>
        </section>
      </main>
    </div>
  );
}
