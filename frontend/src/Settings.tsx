import type { Appearance } from "./appearance";
import { api } from "./api";
import { AvailabilitySettings } from "./AvailabilitySettings";
import type { Reply, View } from "./types";

export type BrowserPermission = NotificationPermission | "unsupported";

interface SettingsProps {
  view: View;
  busy: boolean;
  appearance: Appearance;
  onAppearance: (choice: Appearance) => void;
  account: { email: string | null; onSignOut: () => void } | null;
  onShowGuide: () => void;
  onAction: (work: () => Promise<Reply | { view: View }>) => Promise<boolean>;
  onConnectGoogle: () => Promise<void>;
  icloud: {
    email: string;
    password: string;
    onEmail: (value: string) => void;
    onPassword: (value: string) => void;
    onConnect: () => Promise<void>;
  };
  browserAlerts: BrowserPermission;
  onEnableAlerts: () => Promise<void>;
  hasConversation: boolean;
  onClearConversation: () => void;
}

const APPEARANCES: Array<{ id: Appearance; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

const COMING_SOON_SOURCES = [
  { id: "teams", label: "Microsoft Teams" },
  { id: "classroom", label: "Google Classroom" },
];

function formatChecked(value: string): string {
  const checked = new Date(value);
  if (Number.isNaN(checked.getTime())) return value;
  return checked.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Settings presentation. App retains account state, drafts, and mutation/error handling. */
export function Settings({
  view,
  busy,
  appearance,
  onAppearance,
  account,
  onShowGuide,
  onAction,
  onConnectGoogle,
  icloud,
  browserAlerts,
  onEnableAlerts,
  hasConversation,
  onClearConversation,
}: SettingsProps) {
  const canUseAi = view.ai?.status === "ready";
  return (
    <div className="scroll">
      <h1 className="largetitle">
        Settings<span className="largetitle__sub">{view.timezone}</span>
      </h1>
      <section className="group">
        <div className="group__label">Appearance</div>
        <div className="inset">
          <div className="segmented" role="group" aria-label="Appearance">
            {APPEARANCES.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className="segment"
                aria-pressed={appearance === id}
                onClick={() => onAppearance(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="hint">
          Light unless you say otherwise. System follows whatever your machine is doing.
        </p>
      </section>
      {account && (
        <section className="group">
          <div className="group__label">Account</div>
          <div className="inset">
            <div className="field">
              <span className="field__label">Signed in</span>
              <span className="tag">{account.email ?? "Google account"}</span>
              <button type="button" className="btn btn--quiet" onClick={account.onSignOut}>
                Sign out
              </button>
            </div>
          </div>
        </section>
      )}
      <section className="group">
        <div className="group__label">Guide</div>
        <button type="button" className="btn btn--quiet" onClick={onShowGuide}>
          Show getting-started guide
        </button>
      </section>
      <section className="group" data-tour="availability">
        <AvailabilitySettings
          hours={view.hours}
          busy={busy}
          onSave={(next) => onAction(() => api.setHours(next))}
        />
        {view.source_health
          ?.filter((source) => source.status === "unavailable")
          .map((source) => (
            <p className="hint" key={source.source}>
              {source.source}:{" "}
              {source.message ??
                "Calendar unavailable. New tasks are saved and wait for a reliable availability check."}
            </p>
          ))}
      </section>
      <section className="group">
        <div className="group__label" data-tour="calendar-connections">
          Google Calendar + Gmail
        </div>
        <div className="inset">
          <div className="field">
            <span className="field__label">Account</span>
            <span className="tag">
              {view.calendar.connected
                ? (view.calendar.email ?? "Connected")
                : view.calendar.configured
                  ? "Not connected"
                  : "Not set up"}
            </span>
            {view.calendar.connected ? (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => void onAction(() => api.disconnect())}
              >
                Disconnect
              </button>
            ) : view.calendar.configured ? (
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() => void onConnectGoogle()}
              >
                Connect Google
              </button>
            ) : null}
          </div>
        </div>
        <p className="hint">
          {view.calendar.connected
            ? "Google events appear in Cooper and protect busy time. New work stays in Cooper's calendar."
            : view.calendar.configured
              ? "Not connected. Cooper is using its own calendar, which works on its own."
              : "Cooper has its own calendar and needs nothing to work. Connect Google Calendar + Gmail when you want both services included."}
        </p>
      </section>
      <section className="group">
        <div className="group__label">iCloud Calendar</div>
        {view.icloud.connected ? (
          <div className="inset">
            <div className="field">
              <span className="field__label">Account</span>
              <span className="tag">{view.icloud.email ?? "Connected"}</span>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() => void onAction(() => api.disconnectICloud())}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <form
            className="inset"
            onSubmit={(event) => {
              event.preventDefault();
              void icloud.onConnect();
            }}
          >
            <label className="field">
              <span className="field__label">Apple ID</span>
              <input
                type="email"
                autoComplete="username"
                value={icloud.email}
                onChange={(event) => icloud.onEmail(event.target.value)}
                placeholder="you@icloud.com"
              />
            </label>
            <label className="field">
              <span className="field__label">App-specific password</span>
              <input
                type="password"
                autoComplete="current-password"
                value={icloud.password}
                onChange={(event) => icloud.onPassword(event.target.value)}
                placeholder="xxxx-xxxx-xxxx-xxxx"
              />
            </label>
            <button
              type="submit"
              className="btn btn--quiet"
              disabled={busy || !view.icloud.configured}
            >
              Connect iCloud
            </button>
          </form>
        )}
        <p className={`hint ${view.icloud.error ? "hint--error" : ""}`}>
          {view.icloud.error
            ? view.icloud.error
            : view.icloud.connected
              ? "Read-only iCloud events now block scheduling through CalDAV."
              : view.icloud.configured
                ? "Use an Apple app-specific password. Cooper keeps iCloud read-only."
                : "Server encryption is required before iCloud can be connected."}
        </p>
      </section>
      <section className="group">
        <div className="group__label">Gmail confirmations</div>
        <div className="inset">
          <div className="field">
            <span className="field__label">Status</span>
            <span className="tag">
              {view.gmail.connected
                ? "Connected"
                : view.gmail.configured
                  ? "Not connected"
                  : "Not configured"}
            </span>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={busy || !view.gmail.connected}
              onClick={() => void onAction(() => api.syncGoogle())}
            >
              {busy ? "Syncing…" : "Sync now"}
            </button>
          </div>
          <div className="field">
            <span className="field__label">Last checked</span>
            <span className="tag">
              {view.gmail.last_checked ? formatChecked(view.gmail.last_checked) : "Not yet"}
            </span>
          </div>
          <div className="field">
            <span className="field__label">Recent messages</span>
            <span className="tag">
              {view.gmail.imported} imported · {view.gmail.skipped} skipped
            </span>
          </div>
        </div>
        <p className={`hint ${view.gmail.last_error ? "hint--error" : ""}`}>
          {view.gmail.last_error
            ? view.gmail.last_error
            : view.gmail.connected
              ? "Read-only confirmations from Luma, Meetup, and Eventbrite block scheduling."
              : view.gmail.configured
                ? "Connect Google Calendar + Gmail above to enable Gmail confirmations."
                : "Cooper works without Google. Connect both Google services to import known Gmail confirmations."}
        </p>
      </section>
      <section className="group">
        <div className="group__label">More sources</div>
        <div className="inset">
          {COMING_SOON_SOURCES.map((source) => (
            <div className="field" key={source.id}>
              <span className="field__label">{source.label}</span>
              <span className="tag">Coming soon</span>
            </div>
          ))}
        </div>
        <p className="hint">Planned event sources. None of these connect yet.</p>
      </section>
      <section className="group">
        <div className="group__label">Included AI</div>
        <div className="inset">
          <div className="field">
            <span className="field__label">{canUseAi ? "Model help ready" : "Offline rules"}</span>
            <span className="tag">{view.ai?.tier === "pilot_plus" ? "Plus pilot" : "Free"}</span>
          </div>
          {view.ai && (
            <div className="field">
              <span className="field__label">Included requests remaining</span>
              <span>
                {view.ai.remaining_units} of {view.ai.limit_units}
              </span>
            </div>
          )}
        </div>
        <p className="hint">
          {view.ai?.status === "exhausted"
            ? "Your included AI allowance is used up. Planning questions and Form still work."
            : canUseAi
              ? "Cooper supplies model access within your included allowance. Form never calls a model."
              : "Model help is unavailable. Planning questions and Form still work."}
        </p>
        {view.ai?.reset_at && (
          <p className="hint">Allowance resets {new Date(view.ai.reset_at).toLocaleString()}.</p>
        )}
      </section>
      <section className="group">
        <div className="group__label">Notifications</div>
        <div className="inset">
          <div className="field">
            <span className="field__label">Browser alerts</span>
            <span className="tag">
              {browserAlerts === "unsupported"
                ? "Not available"
                : browserAlerts === "granted"
                  ? "On"
                  : browserAlerts === "denied"
                    ? "Blocked"
                    : "Off"}
            </span>
            {browserAlerts === "default" && (
              <button
                type="button"
                className="btn btn--quiet"
                onClick={() => void onEnableAlerts()}
              >
                Enable
              </button>
            )}
          </div>
        </div>
        <p className="hint">
          Cooper shows a small in-app notice for each change. Browser alerts appear only when this
          app is in the background.
        </p>
      </section>
      {hasConversation && (
        <button type="button" className="btn btn--full" onClick={onClearConversation}>
          Clear conversation
        </button>
      )}
    </div>
  );
}
