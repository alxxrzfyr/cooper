import type { ReactNode } from "react";

import { Mascot } from "../Mascot";

interface LegalPageProps {
  eyebrow: string;
  title: string;
  updated: string;
  children: ReactNode;
}

function PublicBrand() {
  return (
    <a className="public-page__brand" href="/" aria-label="Cooper home">
      <Mascot name="cooper_avatar" size="xs" decorative loading="eager" />
      <span className="landing__wordmark">Cooper</span>
    </a>
  );
}

export function LegalPage({ eyebrow, title, updated, children }: LegalPageProps) {
  return (
    <div className="public-page legal-page">
      <header className="public-page__header legal-page__header">
        <PublicBrand />
        <nav className="legal-page__nav" aria-label="Public pages">
          <a href="/">Home</a>
          <a href="/login">Log in</a>
          <a className="public-page__nav-cta" href="/signup">
            Create account
          </a>
        </nav>
      </header>

      <section className="legal-page__main" aria-labelledby="legal-page-title">
        <div className="legal-page__heading">
          <p className="landing__eyebrow">{eyebrow}</p>
          <h1 id="legal-page-title">{title}</h1>
          <p className="legal-page__updated">Last updated {updated}</p>
        </div>
        <article className="legal-page__prose">{children}</article>
      </section>

      <footer className="public-page__footer">
        <span>Cooper is an invited beta for friends and family.</span>
        <nav aria-label="Legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </footer>
    </div>
  );
}
