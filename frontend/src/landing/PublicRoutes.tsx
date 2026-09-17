import "./landing.css";

import { useState } from "react";

import { Mascot } from "../Mascot";
import { AuthPage } from "./AuthPage";
import { LandingPage } from "./LandingPage";
import { PrivacyPage } from "./PrivacyPage";
import { TermsPage } from "./TermsPage";
import type { AuthIntent } from "./AuthCard";

export type PublicRoute = "landing" | "login" | "signup" | "terms" | "privacy" | "not-found";

/** Resolve public routes and the protected workspace's temporary auth-loading surface. */
export function readPublicRoute(pathname: string): PublicRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  switch (path) {
    case "/":
    case "/landing":
    case "/app":
      return "landing";
    case "/login":
      return "login";
    case "/signup":
      return "signup";
    case "/terms":
      return "terms";
    case "/privacy":
      return "privacy";
    default:
      return "not-found";
  }
}

interface PublicRoutesProps {
  route: PublicRoute;
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

function authIntent(route: PublicRoute): AuthIntent {
  return route === "login" ? "login" : "signup";
}

function PublicLoading({ onOverview }: { onOverview: () => void }) {
  return (
    <div className="public-page public-loading">
      <header className="public-page__header">
        <a className="public-page__brand" href="/" aria-label="Cooper home">
          <Mascot name="cooper_avatar" size="xs" decorative loading="eager" />
          <span className="landing__wordmark">Cooper</span>
        </a>
      </header>
      <section className="public-loading__main" aria-labelledby="public-loading-title">
        <Mascot name="cooper_idle" size="lg" decorative loading="eager" />
        <p className="landing__eyebrow">Welcome to Cooper</p>
        <h1 id="public-loading-title">Checking your account.</h1>
        <p>One moment while we confirm your Cooper account.</p>
        <button type="button" className="landing__secondary" onClick={onOverview}>
          View the overview
        </button>
        <div
          className="public-loading__status"
          role="status"
          aria-label="Checking Firebase account"
        >
          <span aria-hidden="true" />
          <span>Checking securely</span>
        </div>
      </section>
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="public-page public-not-found">
      <header className="public-page__header">
        <a className="public-page__brand" href="/" aria-label="Cooper home">
          <Mascot name="cooper_avatar" size="xs" decorative loading="eager" />
          <span className="landing__wordmark">Cooper</span>
        </a>
      </header>
      <main className="public-not-found__main" aria-labelledby="not-found-title">
        <Mascot name="cooper_puzzled" size="lg" decorative loading="eager" />
        <p className="landing__eyebrow">Page not found</p>
        <h1 id="not-found-title">This page wandered off.</h1>
        <p>Head back to Cooper and pick up where you left off.</p>
        <a className="landing__primary" href="/">
          Back to Cooper home
        </a>
      </main>
    </div>
  );
}

export function PublicRoutes({
  route,
  busy,
  error,
  authEnabled,
  authLoading,
  onSignIn,
  onEmailAuth,
  authStatus = "idle",
  onCheckVerification,
  onResendVerification,
  onResetPassword,
  onUseAnotherAccount,
}: PublicRoutesProps) {
  const [showOverview, setShowOverview] = useState(false);

  if (route === "terms") return <TermsPage />;
  if (route === "privacy") return <PrivacyPage />;
  if (route === "not-found") return <NotFoundPage />;
  if (route === "landing") {
    if (authLoading && !showOverview) {
      return <PublicLoading onOverview={() => setShowOverview(true)} />;
    }
    return (
      <LandingPage
        busy={busy}
        error={error}
        authEnabled={authEnabled}
        authLoading={authLoading}
        onSignIn={onSignIn}
        onEmailAuth={onEmailAuth}
      />
    );
  }

  return (
    <AuthPage
      intent={authIntent(route)}
      busy={busy}
      error={error}
      authEnabled={authEnabled}
      authLoading={authLoading}
      onSignIn={onSignIn}
      onEmailAuth={onEmailAuth}
      authStatus={authStatus === "verification-pending" ? "verification-pending" : "idle"}
      onCheckVerification={onCheckVerification}
      onResendVerification={onResendVerification}
      onResetPassword={onResetPassword}
      onUseAnotherAccount={onUseAnotherAccount}
    />
  );
}
