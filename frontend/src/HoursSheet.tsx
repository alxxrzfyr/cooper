import { useState } from "react";

import type { Hours } from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Working hours: the only time Cadence may book.
 *
 * This replaces the old focus-window grid. One sheet, four fields, same protection.
 */
export function HoursSheet({
  hours,
  onClose,
  onSave,
}: {
  hours: Hours;
  onClose: () => void;
  onSave: (hours: Omit<Hours, "timezone">) => void;
}) {
  const [draft, setDraft] = useState({
    start_hour: hours.start_hour,
    end_hour: hours.end_hour,
    weekdays: hours.weekdays,
    max_per_day: hours.max_per_day,
  });
  const invalid = draft.end_hour <= draft.start_hour || draft.weekdays.length === 0;

  function toggle(day: number) {
    setDraft((current) => ({
      ...current,
      weekdays: current.weekdays.includes(day)
        ? current.weekdays.filter((value) => value !== day)
        : [...current.weekdays, day].sort((a, b) => a - b),
    }));
  }

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Working hours"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="sheet">
        <div className="sheet__head">
          <h2 className="sheet__title">When can I book you?</h2>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="banner__text" style={{ margin: 0 }}>
          Cadence only ever places work inside these hours. Nothing outside them gets touched.
        </p>

        <div className="grid2">
          <label className="field">
            <span className="field__label">Start</span>
            <select
              value={draft.start_hour}
              onChange={(event) => setDraft({ ...draft, start_hour: Number(event.target.value) })}
            >
              {Array.from({ length: 24 }, (_, hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">End</span>
            <select
              value={draft.end_hour}
              onChange={(event) => setDraft({ ...draft, end_hour: Number(event.target.value) })}
            >
              {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                <option key={hour} value={hour}>
                  {String(hour).padStart(2, "0")}:00
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          <span className="field__label">Days</span>
          <div className="daypick">
            {DAYS.map((name, index) => (
              <button
                key={name}
                type="button"
                className="day"
                aria-pressed={draft.weekdays.includes(index)}
                onClick={() => toggle(index)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field__label">Most blocks per day</span>
          <input
            type="number"
            min={1}
            max={10}
            value={draft.max_per_day}
            onChange={(event) => setDraft({ ...draft, max_per_day: Number(event.target.value) })}
          />
        </label>

        <button
          type="button"
          className="btn btn--accent"
          disabled={invalid}
          onClick={() => onSave(draft)}
        >
          {invalid ? "Pick a day and a valid range" : "Save"}
        </button>
      </div>
    </div>
  );
}
