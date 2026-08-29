import { MASCOTS } from "../assets";
import { Mascot } from "../components/Mascot";

/**
 * Windows and Activity previews.
 *
 * Both are honest placeholders. Focus windows, placement, calendar writes, and the mutation
 * feed are Phase 3 and 4 work, gated behind the two-week Phase 2 trial. Showing a convincing
 * fake here would be the worst option: it invites trust in behaviour that does not exist.
 */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

export function WindowsPreview() {
  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Windows</h1>
          <p className="view__subtitle">
            Paint the hours the scheduler is allowed to use. Everything outside them is
            off-limits by construction.
          </p>
        </div>
      </header>

      <div className="banner">
        <div className="banner__text">
          <span className="banner__title">Not available yet</span>
          <div>
            Focus windows arrive with scheduling in Phase 3, after the two-week trial of
            capture and prioritisation. The grid below is a layout preview and is not
            editable.
          </div>
        </div>
      </div>

      <div className="card empty">
        <Mascot asset={MASCOTS.windowsEmpty} className="empty__art" />
        <div className="empty__body">
          <h2 className="empty__title">No windows declared</h2>
          <p className="empty__text">
            With no window declared the scheduler correctly does nothing. When this ships,
            start narrow: two hours on weekday mornings with a cap of two blocks tells you
            more than an optimistic full day.
          </p>
          <button type="button" className="button" disabled>
            Add your first window
          </button>
        </div>
      </div>

      <section className="section" aria-labelledby="week-label">
        <span className="section__label" id="week-label">
          Weekly grid
          <span className="table__meta">Preview only</span>
        </span>
        <div className="card week">
          <div className="week__grid" role="presentation">
            <div className="week__head" />
            {DAYS.map((day) => (
              <div className="week__head" key={day}>
                {day}
              </div>
            ))}
            {HOURS.map((hour) => (
              <div key={hour} style={{ display: "contents" }}>
                <div className="week__time">{`${hour}:00`}</div>
                {DAYS.map((day, index) => {
                  const weekday = index < 5;
                  const morning = hour >= 9 && hour < 12;
                  const on = weekday && morning;
                  return (
                    <div
                      className={`week__slot ${on ? "week__slot--on" : ""}`}
                      key={`${day}-${hour}`}
                    >
                      {on && hour === 9 ? "cap 2" : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <p className="note">
          Shaded cells illustrate a declared window. Once Phase 3 lands, the scheduler may
          only place blocks inside cells you shade yourself.
        </p>
      </section>
    </div>
  );
}

export function ActivityPreview() {
  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Activity</h1>
          <p className="view__subtitle">
            Change history and the daily digest of what the AI did unattended.
          </p>
        </div>
      </header>

      <div className="banner">
        <div className="banner__text">
          <span className="banner__title">Not available yet</span>
          <div>
            The mutation log is already being written for every change, so undo works today
            from the capture bar. This full history view and the digest arrive with the
            nightly planner in Phase 4.
          </div>
        </div>
      </div>

      <div className="card digest">
        <Mascot asset={MASCOTS.activitySummary} className="digest__art" />
        <div className="digest__stats">
          <div className="digest__stat">
            <span className="digest__number">—</span>
            <span className="digest__caption">tasks scheduled</span>
          </div>
          <div className="digest__stat">
            <span className="digest__number">—</span>
            <span className="digest__caption">tasks released</span>
          </div>
          <div className="digest__stat">
            <span className="digest__number">—</span>
            <span className="digest__caption">reordered</span>
          </div>
          <div className="digest__stat">
            <span className="digest__number">—</span>
            <span className="digest__caption">slips recorded</span>
          </div>
        </div>
      </div>

      <div className="card empty">
        <Mascot asset={MASCOTS.activityHistory} className="empty__art" />
        <div className="empty__body">
          <h2 className="empty__title">History arrives with the scheduler</h2>
          <p className="empty__text">
            Because autonomy is full, this feed is the only place oversight can live. It
            ships alongside the first automatic calendar writes rather than before them.
          </p>
        </div>
      </div>
    </div>
  );
}
