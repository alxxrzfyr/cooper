import { MASCOTS } from "../assets";
import { Mascot } from "../components/Mascot";

/**
 * The five required application states, rendered together.
 *
 * Keeping them on one screen makes them reviewable: each is real markup with real copy, so a
 * state cannot quietly rot while the happy path keeps working.
 */

function State({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="gallery__item">
      <span className="gallery__caption">{caption}</span>
      {children}
    </div>
  );
}

export function StateGallery() {
  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Application states</h1>
          <p className="view__subtitle">
            The states that decide whether this feels trustworthy when something goes wrong.
          </p>
        </div>
      </header>

      <div className="gallery">
        <State caption="First run">
          <div className="card empty">
            <Mascot asset={MASCOTS.firstRun} className="empty__art" />
            <div className="empty__body">
              <h2 className="empty__title">Welcome to Cadence</h2>
              <p className="empty__text">
                No tasks yet, and Google Calendar is not connected. Capture one sentence to
                begin; connecting a calendar can wait until scheduling exists.
              </p>
              <button type="button" className="button" disabled>
                Connect Google Calendar
              </button>
            </div>
          </div>
        </State>

        <State caption="Degraded mode">
          <div className="card empty">
            <Mascot asset={MASCOTS.degraded} className="empty__art" />
            <div className="empty__body">
              <h2 className="empty__title">Running without the model</h2>
              <p className="empty__text">
                The Gemini quota is exhausted, so capture is using the offline parser.
                Ranking never needed a model and is unaffected. Quota resets at midnight
                Pacific.
              </p>
            </div>
          </div>
        </State>

        <State caption="Credential expired">
          <div className="card empty">
            <Mascot asset={MASCOTS.credentialExpired} className="empty__art" />
            <div className="empty__body">
              <h2 className="empty__title">Calendar sync stopped</h2>
              <p className="empty__text">
                The Google refresh token expired. A consent screen left in Testing mode
                expires tokens after seven days, which looks like a bug but is not.
                Reconnect to resume.
              </p>
              <button type="button" className="button" disabled>
                Reconnect Google Calendar
              </button>
            </div>
          </div>
        </State>

        <State caption="Parse ambiguity">
          <div className="card empty">
            <Mascot asset={MASCOTS.ambiguity} className="empty__art" />
            <div className="empty__body">
              <h2 className="empty__title">Which task did you mean?</h2>
              <p className="empty__text">
                Two tasks matched “design review” closely enough that picking one would be a
                guess. Cadence asks instead, because confidence reported by a model is not
                evidence.
              </p>
              <div className="filters">
                <span className="pill">design review weekly</span>
                <span className="pill">design review prep</span>
              </div>
            </div>
          </div>
        </State>

        <State caption="Task too large to fit">
          <div className="card empty">
            <Mascot asset={MASCOTS.taskTooLarge} className="empty__art" />
            <div className="empty__body">
              <h2 className="empty__title">This will not fit a window</h2>
              <p className="empty__text">
                A twelve-hour task cannot land in any declared window. Split it, allow it to
                be split across days, or leave it in the backlog. Cadence will not silently
                schedule a fiction.
              </p>
            </div>
          </div>
        </State>
      </div>
    </div>
  );
}
