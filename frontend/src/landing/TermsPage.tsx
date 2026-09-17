import { LegalPage } from "./LegalPage";

export function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="September 17, 2026" tone="peach">
      <p className="legal-page__intro">
        Cooper is a personal planning workspace in public beta. Each user has their own workspace.
        By using it, you agree to use the service lawfully, keep your account secure, and respect
        the people whose schedules or messages you may connect.
      </p>

      <section className="legal-page__card">
        <h2>Your account</h2>
        <p>
          Sign-in is handled by Firebase with Google or verified email and password. You are
          responsible for keeping your account secure and for the activity that happens through it.
        </p>
      </section>

      <section className="legal-page__card">
        <h2>Your content and connected services</h2>
        <p>
          You keep ownership of the tasks, events, notes, and settings you add. If you connect
          Google Calendar or Gmail, you give Cooper permission to read the information needed for
          scheduling and confirmations. New Cooper calendar items stay local; connected mail and
          calendar commitments are read-only.
        </p>
      </section>

      <section className="legal-page__card">
        <h2>Use Cooper with care</h2>
        <p>
          Cooper helps you organize a day; it is not an emergency service, a professional adviser,
          or a promise that a task will be completed. Check important dates and commitments yourself
          before relying on a schedule.
        </p>
      </section>

      <section className="legal-page__card">
        <h2>Availability and changes</h2>
        <p>
          Cooper is provided as an evolving personal project. Features may change, pause, or be
          removed as the deployment is maintained. We will try to keep local work usable when a
          connected service is unavailable, but no uninterrupted availability is promised.
        </p>
      </section>

      <section className="legal-page__card">
        <h2>Questions</h2>
        <p>
          Contact the person operating your Cooper deployment with questions about access or your
          data.
        </p>
      </section>
    </LegalPage>
  );
}
