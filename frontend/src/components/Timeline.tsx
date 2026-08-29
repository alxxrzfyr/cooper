import type { CSSProperties } from "react";

import type { Block, FocusWindow } from "../types";

const START_HOUR = 7;
const END_HOUR = 20;
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, index) => index + START_HOUR);

function localHour(iso: string): number {
  const moment = new Date(iso);
  return moment.getHours() + moment.getMinutes() / 60;
}

function clockLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function minutesOf(clock: string): number {
  const [hours, mins] = clock.split(":").map(Number);
  return hours + (mins ?? 0) / 60;
}

/**
 * Today's timeline.
 *
 * Shows declared windows as lanes and placed blocks inside them. Time outside any window is
 * rendered inert on purpose: it should be visually obvious that the scheduler cannot reach it.
 */
export function Timeline({
  windows,
  blocks,
  today,
}: {
  windows: FocusWindow[];
  blocks: Block[];
  today: Date;
}) {
  const weekday = (today.getDay() + 6) % 7; // JavaScript weeks start on Sunday
  const todaysWindows = windows.filter((window) => window.active && window.weekday === weekday);

  if (todaysWindows.length === 0) {
    return (
      <p className="note">
        No focus window is declared for {today.toLocaleDateString(undefined, { weekday: "long" })},
        so nothing can be scheduled today. Declare one in Windows.
      </p>
    );
  }

  const todaysBlocks = blocks.filter(
    (block) => new Date(block.start_utc).toDateString() === today.toDateString(),
  );

  return (
    <div className="card timeline">
      <div
        className="timeline__grid"
        role="presentation"
        style={{ "--timeline-hours": HOURS.length } as CSSProperties}
      >
        <div className="timeline__lane-label" />
        {HOURS.map((hour) => (
          <div className="timeline__hour" key={hour}>
            {String(hour).padStart(2, "0")}
          </div>
        ))}

        {todaysWindows.map((window) => {
          const from = minutesOf(window.start_local);
          const to = minutesOf(window.end_local);
          const inside = todaysBlocks.filter((block) => {
            const at = localHour(block.start_utc);
            return at >= from && at < to;
          });

          return (
            <div key={window.id} style={{ display: "contents" }}>
              <div className="timeline__lane-label">
                <strong>{window.weekday_name} window</strong>
                {window.start_local.slice(0, 5)}–{window.end_local.slice(0, 5)} · cap{" "}
                {window.daily_block_cap}
              </div>
              {HOURS.map((hour) => {
                const within = hour >= Math.floor(from) && hour < Math.ceil(to);
                const block = inside.find((entry) => Math.floor(localHour(entry.start_utc)) === hour);
                return (
                  <div
                    key={`${window.id}-${hour}`}
                    className={`timeline__cell ${
                      within ? "timeline__cell--window" : "timeline__cell--outside"
                    }`}
                  >
                    {block && (
                      <span
                        className={`timeline__block ${
                          block.state === "user_moved" ? "timeline__block--busy" : ""
                        }`}
                        title={`${block.task_title ?? "task"} · ${clockLabel(block.start_utc)} · ${block.minutes}m`}
                      >
                        {block.task_title ?? "task"}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
