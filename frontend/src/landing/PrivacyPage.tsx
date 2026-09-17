import { LegalPage } from "./LegalPage";

export function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="September 17, 2026" tone="green">
      <p className="legal-page__intro">
        Cooper is designed to keep planning personal. This page explains what the current public
        beta handles and why. It is a plain-language product notice, not a substitute for a review
        of the laws that apply to a public launch.
      </p>

      <section className="legal-page__card">
        <h2>Information you add</h2>
        <p>
          Cooper stores the tasks, events, notes, priorities, categories, working hours, and
          settings you enter so it can rank and schedule them. Local deployments keep that workspace
          on the configured Cooper database. A hosted deployment associates rows with your signed-in
          account.
        </p>
      </section>

      <section className="legal-page__card">
        <h2>Firebase account sign-in</h2>
        <p>
          Firebase Authentication receives your Google sign-in or email address and gives Cooper a
          stable account identity. Email accounts must verify their address. Cooper uses the
          identity to protect your hosted workspace and never receives your password.
        </p>
      </section>

      <section className="legal-page__card">
        <h2>Optional Calendar and Gmail connections</h2>
        <p>
          If you connect Google, Cooper reads calendar commitments and supported confirmation emails
          to avoid placing work over something you already scheduled. Calendar and mail are
          read-only inputs. New Cooper items stay in Cooper's database. Access tokens are encrypted
          at rest by the backend, and a remote failure must not prevent local capture.
        </p>
        <p>
          Email content is used only to parse supported confirmations. Cooper does not turn your
          inbox into a message list or publish it. Attendees, other people&apos;s addresses, and
          calendar entry contents are not sent to a model. AI prompts contain your own words and
          titles, with email parsing kept as the explicitly limited exception.
        </p>
      </section>

      <section className="legal-page__card">
        <h2>AI and browser storage</h2>
        <p>
          Cooper works with offline rules. If you add a Gemini key in Settings, it stays in this
          browser&apos;s local storage and is sent only when you use the AI conversation. The manual
          form does not call the network for parsing.
        </p>
      </section>

      <section className="legal-page__card">
        <h2>Sharing and retention</h2>
        <p>
          Cooper does not sell your workspace or use it for advertising. Each account has its own
          workspace. To ask about access or deletion, contact the person who operates your
          deployment; retention depends on that deployment&apos;s database and hosting
          configuration.
        </p>
      </section>

      <section className="legal-page__card">
        <h2>Updates</h2>
        <p>
          This notice changes when the product or its connected services change. The “Last updated”
          date above identifies the version you are reading.
        </p>
      </section>
    </LegalPage>
  );
}
