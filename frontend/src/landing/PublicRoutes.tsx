import "./landing.css";

import { useState } from "react";

import { Mascot } from "../Mascot";
import { AuthPage } from "./AuthPage";
import { LandingPage } from "./LandingPage";
import { PrivacyPage } from "./PrivacyPage";
import { TermsPage } from "./TermsPage";
import type { AuthIntent } from "./AuthCard";

export type PublicRoute = "landing" | "login" | "signup" | "terms" | "privacy";

/** Resolve only routes that are intentionally public; unknown paths stay on the landing surface. */
export function readPublicRoute(pathname: string): PublicRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  switch (path) {
    case "/login":
      return "login";
    case "/signup":
      return "signup";
    case "/terms":
      return "terms";
    case "/privacy":
      return "privacy";
    default:
      return "landing";
  }
}

interface PublicRoutesProps {
  route: PublicRoute;
  busy: boolean;
  error: string | null;
  authEnabled: boolean;
  authLoading: boolean;
  onSignIn: () => void;
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
        <p>One moment while we confirm your Google account.</p>
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

export function PublicRoutes({
  route,
  busy,
  error,
  authEnabled,
  authLoading,
  onSignIn,
}: PublicRoutesProps) {
  const [showOverview, setShowOverview] = useState(false);

  if (route === "terms") return <TermsPage />;
  if (route === "privacy") return <PrivacyPage />;
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
    />
  );
}
