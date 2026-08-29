import { useEffect, useMemo, useState } from "react";

import { api } from "../api";
import { MASCOTS } from "../assets";
import { Mascot } from "../components/Mascot";
import { ApiError, type FocusWindow, type NewWindow } from "../types";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const GRID_HOURS = Array.from({ length: 15 }, (_, index) => index + 6); // 06:00 to 20:00

function minutesOf(clock: string): number {
  const [hours, mins] = clock.split(":").map(Number);
  return hours * 60 + (mins ?? 0);
}

function label(clock: string): string {
  return clock.slice(0, 5);
}

/**
 * The Windows editor.
 *
 * This grid is the whole safety story for autonomous scheduling: the scheduler may only write
 * into shaded time. The copy says so plainly, because a user who does not understand the
 * boundary cannot trust the automation that respects it.
 */
export function WindowsView({ onChanged }: { onChanged: () => void }) {
  const [windows, setWindows] = useState<FocusWindow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<NewWindow>({
    weekdays: [0, 1, 2, 3, 4],
    start_local: "09:00",
    end_local: "12:00",
    daily_block_cap: 2,
  });

  async function refresh() {
    try {
      setWindows(await api.listWindows());
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load windows");
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await refresh();
      onChanged();
      setError(null);
    } catch (failure) {
      setError(
        failure instanceof ApiError
          ? failure.message
          : failure instanceof Error
            ? failure.message
            : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  const shaded = useMemo(() => {
    const map = new Map<string, FocusWindow>();
    (windows ?? [])
      .filter((window) => window.active)
      .forEach((window) => {
        const from = minutesOf(window.start_local);
        const to = minutesOf(window.end_local);
        GRID_HOURS.forEach((hour) => {
          if (hour * 60 >= from && hour * 60 < to) {
            map.set(`${window.weekday}-${hour}`, window);
          }
        });
      });
    return map;
  }, [windows]);

  const totalHours = (windows ?? [])
    .filter((window) => window.active)
    .reduce((sum, window) => sum + window.minutes, 0) / 60;

  function toggleDay(day: number) {
    setDraft((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((value) => value !== day)
        : [...current.weekdays, day].sort(),
    }));
  }

  return (
    <div className="view">
      <header className="view__header">
        <div>
          <h1 className="view__title">Windows</h1>
          <p className="view__subtitle">
            The scheduler may only place work inside these hours. Everything else is off-limits
            by construction.
            {windows && windows.length > 0 && ` ${totalHours.toFixed(1)}h declared per week.`}
          </p>
        </div>
      </header>

      {error && (
        <div className="banner banner--bad" role="alert">
          <div className="banner__text">
            <span className="banner__title">Could not save</span>
            <div>{error}</div>
          </div>
        </div>
      )}

      {windows !== null && windows.length === 0 && (
        <div className="card empty">
          <Mascot asset={MASCOTS.windowsEmpty} className="empty__art" />
          <div className="empty__body">
            <h2 className="empty__title">No windows declared</h2>
            <p className="empty__text">
              With nothing declared the scheduler correctly does nothing. Start narrow: two
              hours on weekday mornings with a cap of two blocks tells you more in a week than
              an optimistic full day.
            </p>
          </div>
        </div>
      )}

      <section className="section" aria-labelledby="declare-label">
        <span className="section__label" id="declare-label">
          Declare a window
        </span>
        <form
          className="card card--pad"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.weekdays.length === 0) {
              setError("Pick at least one day.");
              return;
            }
            void run(() => api.createWindows(draft));
          }}
        >
          <fieldset
            style={{ border: 0, padding: 0, margin: "0 0 0.75rem", display: "flex", gap: "0.375rem", flexWrap: "wrap" }}
          >
            <legend className="breakdown__name" style={{ marginBottom: "0.375rem" }}>
              Days
            </legend>
            {DAY_NAMES.map((name, index) => (
              <button
                key={name}
                type="button"
                className="icon-button"
                aria-pressed={draft.weekdays.includes(index)}
                onClick={() => toggleDay(index)}
              >
                {name}
              </button>
            ))}
          </fieldset>

          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-end" }}>
            <label style={{ display: "grid", gap: 2 }}>
              <span className="breakdown__name">Start</span>
              <input
                type="time"
                value={draft.start_local}
                onChange={(event) => setDraft({ ...draft, start_local: event.target.value })}
                required
              />
            </label>
            <label style={{ display: "grid", gap: 2 }}>
              <span className="breakdown__name">End</span>
              <input
                type="time"
                value={draft.end_local}
                onChange={(event) => setDraft({ ...draft, end_local: event.target.value })}
                required
              />
            </label>
            <label style={{ display: "grid", gap: 2 }}>
              <span className="breakdown__name">Blocks per day</span>
              <input
                type="number"
                min={1}
                max={12}
                value={draft.daily_block_cap}
                onChange={(event) =>
                  setDraft({ ...draft, daily_block_cap: Number(event.target.value) })
                }
                style={{ width: "5rem" }}
              />
            </label>
            <button type="submit" className="button button--primary" disabled={busy}>
              Add window
            </button>
          </div>
        </form>
      </section>

      <section className="section" aria-labelledby="grid-label">
        <span className="section__label" id="grid-label">
          Weekly grid
          <span className="table__meta">Shaded time is schedulable. Nothing else is.</span>
        </span>
        <div className="card week">
          <div className="week__grid" role="presentation">
            <div className="week__head" />
            {DAY_NAMES.map((name) => (
              <div className="week__head" key={name}>
                {name}
              </div>
            ))}
            {GRID_HOURS.map((hour) => (
              <div key={hour} style={{ display: "contents" }}>
                <div className="week__time">{`${String(hour).padStart(2, "0")}:00`}</div>
                {DAY_NAMES.map((name, day) => {
                  const window = shaded.get(`${day}-${hour}`);
                  return (
                    <div
                      key={`${name}-${hour}`}
                      className={`week__slot ${window ? "week__slot--on" : ""}`}
                      title={window ? `${name} ${label(window.start_local)}-${label(window.end_local)}` : undefined}
                    >
                      {window && minutesOf(window.start_local) === hour * 60
                        ? `cap ${window.daily_block_cap}`
                        : ""}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {windows && windows.length > 0 && (
        <section className="section" aria-labelledby="declared-label">
          <span className="section__label" id="declared-label">
            Declared windows
          </span>
          <div className="card">
            <table className="table table--rows">
              <caption className="visually-hidden">Declared focus windows</caption>
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Hours</th>
                  <th scope="col">Length</th>
                  <th scope="col">Cap</th>
                  <th scope="col">Active</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {windows.map((window) => (
                  <tr key={window.id}>
                    <td className="table__title">{window.weekday_name}</td>
                    <td>
                      {label(window.start_local)} – {label(window.end_local)}
                    </td>
                    <td>{(window.minutes / 60).toFixed(1)}h</td>
                    <td>{window.daily_block_cap}</td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        aria-pressed={window.active}
                        disabled={busy}
                        onClick={() =>
                          void run(() => api.updateWindow(window.id, { active: !window.active }))
                        }
                      >
                        {window.active ? "on" : "off"}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={busy}
                        onClick={() => void run(() => api.deleteWindow(window.id))}
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
