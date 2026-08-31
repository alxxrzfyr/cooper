import type { ReactNode } from "react";

import { Mascot } from "../Mascot";
import "./auth.css";

interface LegalPageProps {
  title: string;
  updated: string;
  tone: "green" | "peach";
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

export function LegalPage({ title, updated, tone, children }: LegalPageProps) {
  return (
    <div className={`public-page legal-page legal-page--${tone}`}>
      <header className="public-page__header legal-page__header">
        <PublicBrand />
        <a className="public-page__back" href="/" aria-label="Back to Cooper home">
          <span aria-hidden="true">←</span>
          <span>
            Back to <span className="public-brand-name">Cooper</span>
          </span>
        </a>
      </header>

      <section className="legal-page__main" aria-labelledby="legal-page-title">
        <div className="legal-page__heading">
          <h1 id="legal-page-title">{title}</h1>
          <p className="legal-page__updated">Last updated {updated}</p>
        </div>
        <article className="legal-page__prose">{children}</article>
      </section>

      <footer className="public-page__footer">
        <span>
          <span className="public-brand-name">Cooper</span> © 2026 · public beta
        </span>
        <nav aria-label="Legal">
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
        </nav>
      </footer>
    </div>
  );
}
