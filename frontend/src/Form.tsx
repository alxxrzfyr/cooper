import { useState } from "react";

import { Mascot } from "./Mascot";
import type { Category, NewItem } from "./types";

/** Manual capture without parsing or model access. */

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: "academics", label: "Academics" },
  { id: "work", label: "Work" },
  { id: "organizations", label: "Organizations" },
  { id: "personal", label: "Personal" },
];

const IMPORTANCE: Array<{ value: number; label: string }> = [
  { value: 1, label: "Someday" },
  { value: 2, label: "Minor" },
  { value: 3, label: "Normal" },
  { value: 4, label: "Important" },
  { value: 5, label: "Critical" },
];

/** A local YYYY-MM-DD, so the value matches what the backend expects and never shifts by zone. */
function isoDay(at: Date): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today, as the earliest a deadline may be. A deadline in the past is not a deadline. */
const TODAY = isoDay(new Date());

/** Half-hour slots across the day as HH:MM, labelled in the reader's own clock format. */
function timeOptions(): Array<{ value: string; label: string }> {
  const slots: Array<{ value: string; label: string }> = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
    const hour = Math.floor(minutes / 60);
    const minute = minutes % 60;
    const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    const label = new Date(2000, 0, 1, hour, minute).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
    slots.push({ value, label });
  }
  return slots;
}

const TIME_OPTIONS = timeOptions();

export function Form({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (item: NewItem) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [minutes, setMinutes] = useState("");
  const [importance, setImportance] = useState(3);
  const [category, setCategory] = useState<Category | "auto">("auto");
  const [due, setDue] = useState("");
  const [time, setTime] = useState("");

  const canSubmit = title.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;

    // A time creates an event; a date alone creates a task deadline. Send wall-clock input so the
    // backend can apply its configured timezone.
    const start = due && time ? `${due}T${time}:00` : undefined;

    const item: NewItem = {
      title: title.trim(),
      minutes: minutes ? Number(minutes) : null,
      importance,
      category: category === "auto" ? null : category,
      due: due && !time ? due : null,
      start,
    };

    await onSubmit(item);

    setTitle("");
    setMinutes("");
    setImportance(3);
    setCategory("auto");
    setDue("");
    setTime("");
  }

  return (
    <div className="scroll">
      <div className="opening opening--form">
        <Mascot name="cooper_reading" size="lg" decorative />
        <h2 className="opening__title">Add something</h2>
        <p className="opening__text">Fields, not a sentence. Nothing here leaves your machine.</p>
      </div>

      <form
        className="taskform"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <section className="group">
          <div className="inset">
            <div className="field">
              <label className="field__label" htmlFor="f-title">
                What
              </label>
              <input
                id="f-title"
                className="field__input"
                value={title}
                maxLength={300}
                placeholder="write the quarterly report"
                autoComplete="off"
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="f-due">
                Deadline
              </label>
              <input
                id="f-due"
                className="field__input"
                type="date"
                value={due}
                min={TODAY}
                onChange={(event) => {
                  setDue(event.target.value);
                  if (!event.target.value) setTime("");
                }}
              />
            </div>

            <div className="field">
              <label className="field__label" htmlFor="f-time">
                At
              </label>
              <select
                id="f-time"
                className="field__input"
                value={time}
                disabled={!due}
                title={due ? undefined : "Pick a day first"}
                onChange={(event) => setTime(event.target.value)}
              >
                <option value="">No time (a task, not an event)</option>
                {TIME_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field__label" htmlFor="f-minutes">
                How long
              </label>
              <input
                id="f-minutes"
                className="field__input"
                type="number"
                min={1}
                max={1440}
                value={minutes}
                placeholder="minutes — leave blank for an errand"
                onChange={(event) => setMinutes(event.target.value)}
              />
            </div>
          </div>
          <p className="hint">
            {time
              ? "A date and a time make an event, booked at that moment."
              : "A deadline without a time stays a task, ranked and scheduled into your hours."}
          </p>
        </section>

        <section className="group">
          <div className="group__label">Category</div>
          <div className="inset">
            <div className="segmented segmented--wrap" role="group" aria-label="Category">
              <button
                type="button"
                className="segment"
                aria-pressed={category === "auto"}
                onClick={() => setCategory("auto")}
              >
                Auto
              </button>
              {CATEGORIES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className={`segment cat--${id}`}
                  aria-pressed={category === id}
                  onClick={() => setCategory(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">Auto works it out from the title, the way typing would.</p>
        </section>

        <section className="group">
          <div className="group__label">Importance</div>
          <div className="inset">
            <div className="segmented" role="group" aria-label="Importance">
              {IMPORTANCE.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className="segment"
                  aria-pressed={importance === value}
                  title={label}
                  onClick={() => setImportance(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <button type="submit" className="btn btn--accent btn--full" disabled={!canSubmit}>
          Add it
        </button>
      </form>
    </div>
  );
}
