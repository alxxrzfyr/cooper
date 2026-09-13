import { useEffect, useState } from "react";
import type { Hours } from "./types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const clock = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
};

/** Edit complete availability profile with standard hours and custom windows. */
export function AvailabilitySettings({
  hours,
  busy,
  onSave,
}: {
  hours: Hours;
  busy: boolean;
  onSave: (hours: Hours) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(hours);
  useEffect(() => setDraft(hours), [hours]);

  const windows =
    draft.windows ??
    draft.weekdays.map((day): [number, number, number] => [
      day,
      draft.start_hour * 60,
      draft.end_hour * 60,
    ]);

  function updateWindow(index: number, field: 0 | 1 | 2, value: number) {
    setDraft({
      ...draft,
      windows: windows.map((window, position) => {
        const next: [number, number, number] = [...window];
        if (position === index) next[field] = value;
        return next;
      }),
    });
  }

  return (
    <>
      <div className="group__label">Working hours</div>
      {hours.windows !== null && hours.windows !== undefined && (
        <p className="hint">
          Custom windows are active. Changing a start, end, or weekday below switches back to
          standard hours.
        </p>
      )}
      <div className="inset">
        <div className="field">
          <span className="field__label">Start</span>
          <select
            aria-label="Day starts at"
            value={hours.start_hour}
            disabled={busy}
            onChange={(event) =>
              void onSave({
                ...hours,
                start_hour: Number(event.target.value),
                windows: null,
              })
            }
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <span className="field__label">End</span>
          <select
            aria-label="Day ends at"
            value={hours.end_hour}
            disabled={busy}
            onChange={(event) =>
              void onSave({
                ...hours,
                end_hour: Number(event.target.value),
                windows: null,
              })
            }
          >
            {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
              <option key={hour} value={hour}>
                {String(hour).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </div>
        <div className="daypick">
          {DAYS.map((name, index) => (
            <button
              key={name}
              type="button"
              className="day"
              aria-pressed={hours.weekdays.includes(index)}
              disabled={busy}
              onClick={() =>
                void onSave({
                  ...hours,
                  windows: null,
                  weekdays: hours.weekdays.includes(index)
                    ? hours.weekdays.filter((day) => day !== index)
                    : [...hours.weekdays, index].sort((a, b) => a - b),
                })
              }
            >
              {name}
            </button>
          ))}
        </div>
        <div className="field">
          <span className="field__label">Most blocks a day</span>
          <input
            type="number"
            aria-label="Most blocks a day"
            min={1}
            max={100}
            value={hours.max_per_day}
            disabled={busy}
            onChange={(event) =>
              void onSave({
                ...hours,
                max_per_day: Number(event.target.value),
              })
            }
          />
        </div>
      </div>
      <p className="hint">Nothing is ever booked outside these hours.</p>

      <div className="group__label" style={{ marginTop: "1rem" }}>
        Custom availability & limits
      </div>
      <p className="hint">
        Fine-tune availability with custom windows, 24-hour schedules, overnight shifts, and daily
        limits.
      </p>
      <div className="inset">
        <div className="field">
          <span className="field__label">Quick setup</span>
          <button
            type="button"
            className="btn btn--quiet"
            disabled={busy}
            onClick={() => {
              const fullDay: Hours = {
                ...draft,
                start_hour: 0,
                end_hour: 24,
                weekdays: [0, 1, 2, 3, 4, 5, 6],
                windows: DAYS.map((_, day) => [day, 0, 1440]),
              };
              setDraft(fullDay);
              void onSave(fullDay);
            }}
          >
            Available 24 hours
          </button>
          <button
            type="button"
            className="btn btn--quiet"
            disabled={busy}
            onClick={() => {
              const standard: Hours = {
                ...draft,
                start_hour: 9,
                end_hour: 18,
                weekdays: [0, 1, 2, 3, 4],
                windows: [0, 1, 2, 3, 4].map((day) => [day, 540, 1080]),
              };
              setDraft(standard);
              void onSave(standard);
            }}
          >
            Weekdays 9–6
          </button>
        </div>
        {windows.map(([day, start, end], index) => (
          <div className="field" key={index}>
            <select
              aria-label={`Window ${index + 1} day`}
              value={day}
              onChange={(event) => updateWindow(index, 0, Number(event.target.value))}
            >
              {DAYS.map((name, dayIndex) => (
                <option value={dayIndex} key={name}>
                  {name}
                </option>
              ))}
            </select>
            <input
              type="time"
              aria-label={`Window ${index + 1} start`}
              value={clock(start)}
              required
              onChange={(event) => {
                if (event.target.value) updateWindow(index, 1, minutes(event.target.value));
              }}
            />
            <input
              type="time"
              aria-label={`Window ${index + 1} end`}
              value={clock(end === 1440 ? 0 : end)}
              required
              onChange={(event) => {
                if (event.target.value) updateWindow(index, 2, minutes(event.target.value) || 1440);
              }}
            />
            <button
              type="button"
              className="btn btn--quiet"
              aria-label={`Remove window ${index + 1}`}
              onClick={() =>
                setDraft({
                  ...draft,
                  windows: windows.filter((_, position) => position !== index),
                })
              }
            >
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn--quiet"
          onClick={() => setDraft({ ...draft, windows: [...windows, [0, 540, 1080]] })}
        >
          Add time window
        </button>
        <div className="field">
          <label htmlFor="availability-break">Break between tasks (minutes)</label>
          <input
            id="availability-break"
            type="number"
            min={0}
            max={180}
            value={draft.break_minutes ?? 10}
            onChange={(event) => setDraft({ ...draft, break_minutes: Number(event.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="availability-minutes">Daily task minutes (blank for no limit)</label>
          <input
            id="availability-minutes"
            type="number"
            min={1}
            max={1440}
            value={draft.max_minutes_per_day ?? ""}
            onChange={(event) =>
              setDraft({
                ...draft,
                max_minutes_per_day: event.target.value === "" ? null : Number(event.target.value),
              })
            }
          />
        </div>
      </div>
      <p className="hint">
        End before start means overnight; matching times mean 24 hours. Times use{" "}
        {hours.timezone ?? "your calendar timezone"}.
      </p>
      <button
        type="button"
        className="btn"
        disabled={busy}
        onClick={() => void onSave({ ...draft, windows })}
      >
        Save availability
      </button>
    </>
  );
}
