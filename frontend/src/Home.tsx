import { useState } from "react";

import { Mascot } from "./Mascot";
import { RecoveryPanel } from "./RecoveryPanel";
import { Row } from "./Row";
import { WeeklyReview } from "./WeeklyReview";
import type {
  CalendarEvent,
  Item,
  PlanningCommitment,
  Ranked,
  RecoveryPreview,
  View,
  WeeklyReview as WeeklyReviewData,
} from "./types";

/** Dashboard backed exclusively by the resolved planning snapshot. */

function clock(at: Date, timeZone: string): string {
  return at.toLocaleTimeString(undefined, { timeZone, hour: "numeric", minute: "2-digit" });
}

function greeting(at: Date, timeZone: string): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(at),
  );
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function localDay(at: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function commitmentDay(commitment: PlanningCommitment, at: string, timeZone: string): string {
  return localDay(at, timeZone);
}

function isOnDay(commitment: PlanningCommitment, day: string, timeZone: string): boolean {
  const lastMoment = new Date(
    Math.max(Date.parse(commitment.start_at), Date.parse(commitment.end_at) - 1),
  );
  return (
    commitmentDay(commitment, commitment.start_at, timeZone) <= day &&
    day <= commitmentDay(commitment, lastMoment.toISOString(), timeZone)
  );
}

function sourceLabel(source: string): string {
  if (source === "cooper") return "Cooper";
  if (source === "icloud") return "iCloud";
  return source === "gmail" ? "Gmail" : "Google";
}

function localDateTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function riskSummary(kind: string, message: string | undefined): string {
  if (message) return message;
  if (kind === "conflict") return "Overlaps another commitment";
  if (kind === "overdue") return "Deadline has passed";
  if (kind === "missed_block") return "Scheduled time has passed";
  if (kind === "blocked") return "Waiting for calendar availability";
  return "Needs attention";
}

function taskTarget(item: Ranked): string {
  return `task-${item.id}`;
}

function commitmentTarget(commitment: Pick<PlanningCommitment, "id">): string {
  return `agenda-${commitment.id}`;
}

type FocusItem =
  { kind: "commitment"; value: PlanningCommitment } | { kind: "task"; value: Ranked };

type RiskTarget =
  | { kind: "commitment"; id: string; title: string; message: string }
  | { kind: "task"; id: string; title: string; message: string };

function findFocus(view: View, id: string | null): FocusItem | null {
  if (!id) return null;
  const commitment = view.planning.commitments.find((entry) => entry.id === id);
  if (commitment) return { kind: "commitment", value: commitment };
  const task = view.planning.tasks.find((entry) => entry.id === id);
  return task ? { kind: "task", value: task } : null;
}

function focusTarget(item: FocusItem): string {
  return item.kind === "commitment" ? commitmentTarget(item.value) : taskTarget(item.value);
}

function focusTime(item: FocusItem, timeZone: string): string | null {
  if (item.kind !== "commitment") return null;
  if (item.value.all_day) return "All day";
  return `${clock(new Date(item.value.start_at), timeZone)}–${clock(new Date(item.value.end_at), timeZone)}`;
}

function isLocalTask(item: FocusItem): item is { kind: "task"; value: Ranked } {
  return item.kind === "task" && item.value.source === "me";
}

function FocusReference({
  label,
  item,
  context,
  onComplete,
  busy,
}: {
  label: "Now" | "Next";
  item: FocusItem;
  context: Array<string | null>;
  onComplete: (id: string) => void;
  busy: boolean;
}) {
  return (
    <section className="home-focus" aria-label={label}>
      <div className="group__label">
        {label}
        {label === "Next" && <span className="group__note">Up next</span>}
      </div>
      <div className="home-focus__body">
        <a
          className="home-focus__link"
          href={`#${focusTarget(item)}`}
          aria-label={`${label}: ${item.value.title}`}
        >
          <span className="home-focus__title">{item.value.title}</span>
          <span className="home-focus__meta">
            {[...context, "See it below"].filter(Boolean).join(" · ")}
          </span>
        </a>
        {isLocalTask(item) && (
          <button
            type="button"
            className="btn btn--accent"
            disabled={busy}
            onClick={() => onComplete(item.value.id)}
          >
            Done
          </button>
        )}
      </div>
    </section>
  );
}

function AgendaItem({
  commitment,
  today,
  timeZone,
  busy,
  onComplete,
  onOpen,
  onMove,
}: {
  commitment: PlanningCommitment;
  today: string;
  timeZone: string;
  busy: boolean;
  onComplete: (id: string) => void;
  onOpen: (item: Item | Ranked | CalendarEvent) => void;
  onMove: (id: string, start: string, minutes: number) => Promise<boolean>;
}) {
  const label = `${commitment.title} · ${
    commitment.all_day
      ? "All day"
      : `${clock(new Date(commitment.start_at), timeZone)}–${clock(new Date(commitment.end_at), timeZone)}`
  }`;
  const localItem = commitment.editable ? commitment.item : undefined;
  const initialMinutes = Math.max(
    1,
    Math.round((Date.parse(commitment.end_at) - Date.parse(commitment.start_at)) / 60_000),
  );
  const [moving, setMoving] = useState(false);
  const [moveStart, setMoveStart] = useState(localDateTime(commitment.start_at, timeZone));
  const [moveMinutes, setMoveMinutes] = useState(initialMinutes);
  if (localItem) {
    return (
      <div id={commitmentTarget(commitment)}>
        <Row
          item={localItem}
          today={today}
          busy={busy}
          onComplete={() => onComplete(localItem.id)}
          onOpen={() => onOpen(localItem)}
        />
        {!moving ? (
          <button
            type="button"
            className="btn btn--quiet"
            aria-label={`Move ${localItem.title}`}
            disabled={busy}
            onClick={() => {
              setMoveStart(localDateTime(commitment.start_at, timeZone));
              setMoveMinutes(initialMinutes);
              setMoving(true);
            }}
          >
            Move
          </button>
        ) : (
          <form
            className="taskform"
            onSubmit={(event) => {
              event.preventDefault();
              void onMove(localItem.id, moveStart, moveMinutes).then((saved) => {
                if (saved) setMoving(false);
              });
            }}
          >
            <label className="field">
              <span className="field__label">New time</span>
              <input
                className="field__input"
                type="datetime-local"
                aria-label={`New time for ${localItem.title}`}
                value={moveStart}
                required
                disabled={busy}
                onChange={(event) => setMoveStart(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Minutes</span>
              <input
                className="field__input"
                type="number"
                aria-label={`Duration for ${localItem.title}`}
                value={moveMinutes}
                min={1}
                max={1440}
                required
                disabled={busy}
                onChange={(event) => setMoveMinutes(Number(event.target.value))}
              />
            </label>
            <div className="home-ask-setup__actions">
              <button type="submit" className="btn btn--accent" disabled={busy}>
                Save new time
              </button>
              <button
                type="button"
                className="btn btn--quiet"
                disabled={busy}
                onClick={() => setMoving(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }
  const event = commitment.event;
  return (
    <div id={commitmentTarget(commitment)}>
      {event ? (
        <button
          type="button"
          className={`slot slot--${commitment.source} cat--${commitment.category} slot--home-event ${commitment.all_day ? "slot--all-day" : ""}`}
          title={label}
          aria-label={label}
          onClick={() => onOpen(event)}
        >
          <span className="slot__time">
            {commitment.all_day ? "All day" : clock(new Date(commitment.start_at), timeZone)}
          </span>
          <span className="slot__title">{commitment.title}</span>
          <span className="slot__from">{sourceLabel(commitment.source)}</span>
        </button>
      ) : (
        <div
          className={`slot slot--${commitment.source} cat--${commitment.category}`}
          title={label}
        >
          <span className="slot__time">
            {commitment.all_day ? "All day" : clock(new Date(commitment.start_at), timeZone)}
          </span>
          <span className="slot__title">{commitment.title}</span>
          <span className="slot__from">{sourceLabel(commitment.source)}</span>
        </div>
      )}
    </div>
  );
}

export function Home({
  view,
  busy,
  onComplete,
  onOpen,
  onSchedule,
  onMove,
  onGoToChat,
  onPreviewRecovery,
  onApplyRecovery,
  onLoadWeeklyReview,
}: {
  view: View;
  busy: boolean;
  onComplete: (id: string) => void;
  onOpen: (item: Item | Ranked | CalendarEvent) => void;
  onSchedule: () => void;
  onMove: (id: string, start: string, minutes: number) => Promise<boolean>;
  onGoToChat: () => void;
  onPreviewRecovery: () => Promise<RecoveryPreview | null>;
  onApplyRecovery: (fingerprint: string) => Promise<boolean>;
  onLoadWeeklyReview: () => Promise<WeeklyReviewData | null>;
}) {
  const { planning } = view;
  const now = new Date(planning.generated_at);
  const today = planning.today;
  const zone = planning.timezone;
  const agenda = planning.commitments
    .filter((commitment) => isOnDay(commitment, today, zone))
    .sort((left, right) => left.start_at.localeCompare(right.start_at));
  const futureCommitments = planning.commitments
    .filter((commitment) => commitmentDay(commitment, commitment.start_at, zone) > today)
    .sort((left, right) => left.start_at.localeCompare(right.start_at));
  const scheduledTaskIds = new Set(
    planning.commitments.flatMap((commitment) =>
      commitment.local_item_id ? [commitment.local_item_id] : [],
    ),
  );
  const upcomingTasks = planning.tasks.filter((task) => !scheduledTaskIds.has(task.id));
  const current = findFocus(view, planning.focus.now_id);
  const next = findFocus(view, planning.focus.next_id);
  const currentTime = current ? focusTime(current, zone) : null;
  const nextTime = next ? focusTime(next, zone) : null;
  const focusIds = new Set(
    [planning.focus.now_id, planning.focus.next_id].filter((entry): entry is string =>
      Boolean(entry),
    ),
  );
  const hasWorkToSchedule = upcomingTasks.some((task) => task.minutes !== null);
  const nothingAtAll = agenda.length === 0 && upcomingTasks.length === 0;
  const riskTargets = planning.risks.flatMap((risk) => {
    const ids = risk.commitment_ids ?? (risk.item_id ? [risk.item_id] : []);
    const message = riskSummary(risk.kind, risk.message);
    return ids
      .map((id) => {
        const commitment = planning.commitments.find(
          (entry) => entry.id === id || entry.local_item_id === id,
        );
        if (commitment) {
          return {
            kind: "commitment",
            id: commitment.id,
            title: commitment.title,
            message,
          } satisfies RiskTarget;
        }
        const task = planning.tasks.find((entry) => entry.id === id);
        return task
          ? ({
              kind: "task",
              id: task.id,
              title: task.title,
              message,
            } satisfies RiskTarget)
          : null;
      })
      .filter((entry): entry is RiskTarget => entry !== null);
  });
  const riskTaskIds = new Set(
    riskTargets.filter((risk) => risk.kind === "task").map((risk) => risk.id),
  );
  const riskCommitmentIds = new Set(
    riskTargets.filter((risk) => risk.kind === "commitment").map((risk) => risk.id),
  );
  const visibleFutureCommitments = futureCommitments.filter(
    (commitment, index) =>
      index < 3 || riskCommitmentIds.has(commitment.id) || focusIds.has(commitment.id),
  );
  const visibleUpcomingTasks = upcomingTasks.filter(
    (task, index) => index < 5 || riskTaskIds.has(task.id) || focusIds.has(task.id),
  );
  const catchUpCommitments = planning.commitments.filter(
    (commitment) =>
      (focusIds.has(commitment.id) || riskCommitmentIds.has(commitment.id)) &&
      !isOnDay(commitment, today, zone),
  );

  return (
    <div className="scroll home-command-center">
      <h1 className="largetitle">
        {greeting(now, zone)}
        <span className="largetitle__sub">
          {now.toLocaleDateString(undefined, {
            timeZone: zone,
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </span>
      </h1>

      {!planning.complete && (
        <section className="home-incomplete" role="alert">
          <strong>Planning is incomplete</strong>
          <span>
            {planning.source_health
              .filter((source) => source.status === "unavailable")
              .map((source) => source.message ?? `${sourceLabel(source.source)} is unavailable.`)
              .join(" ") || "A connected calendar is unavailable."}
          </span>
        </section>
      )}

      {nothingAtAll && (
        <section className="empty">
          <Mascot name="cooper_waving" size="lg" decorative />
          <h2 className="empty__title">Nothing on today</h2>
          <p className="empty__text">
            Tell Cooper what&rsquo;s on your plate and it will show up here, ranked and ready to
            book.
          </p>
          <button type="button" className="btn btn--accent" onClick={onGoToChat}>
            Say something
          </button>
        </section>
      )}

      {current && (
        <FocusReference
          label="Now"
          item={current}
          context={[
            currentTime,
            planning.complete &&
            current.kind === "task" &&
            !current.value.start_at &&
            planning.recommended_start_at
              ? `Suggested from ${clock(new Date(planning.recommended_start_at), zone)} · unsaved`
              : null,
          ]}
          onComplete={onComplete}
          busy={busy}
        />
      )}
      {next && (
        <FocusReference
          label="Next"
          item={next}
          context={[nextTime]}
          onComplete={onComplete}
          busy={busy}
        />
      )}

      {planning.capacity && (
        <section className="group" aria-label="Rest of today">
          <h2 className="group__label">Rest of today</h2>
          <div className="inset home-capacity">
            <p className="hint">
              Updated {clock(new Date(planning.capacity.generated_at), zone)} · {zone}
            </p>
            <p>
              {planning.capacity.due_today_ids.length} unscheduled tasks due today ·{" "}
              {planning.capacity.known_estimated_due_today_minutes} known estimated minutes
            </p>
            {planning.capacity.unknown_estimate_count > 0 && (
              <p role="status">
                Partial assessment: {planning.capacity.unknown_estimate_count}{" "}
                {planning.capacity.unknown_estimate_count === 1 ? "task has" : "tasks have"} unknown
                effort. Add estimates before judging the full workload.
              </p>
            )}
            {planning.capacity.status === "source_unavailable" ? (
              <p>Capacity cannot be checked while a connected calendar is unavailable.</p>
            ) : planning.capacity.assessment_partial &&
              planning.capacity.candidate_slots.length === 0 ? (
              <p>No projected slots yet for due-today work with known estimates.</p>
            ) : (
              <p>
                {planning.capacity.candidate_slots.length} unsaved candidate slots for known
                due-today work. {planning.capacity.open_window_minutes} open window minutes is a gap
                metric, not a capacity verdict.
              </p>
            )}
            <p className="hint">
              Today’s demand: unscheduled tasks due before midnight in {zone}. Candidates come from
              scheduling all open local tasks over seven days; pinned future work can compete.
            </p>
            <p className="hint">
              {planning.capacity.overdue_ids.length} overdue ·{" "}
              {planning.capacity.missed_block_ids.length} missed blocks ·{" "}
              {planning.capacity.other_backlog_count} other unscheduled tasks
            </p>
            {planning.capacity.unknown_estimate_ids.map((id) => {
              const item = planning.tasks.find((task) => task.id === id);
              return item ? (
                <p key={id}>
                  <button
                    type="button"
                    className="btn btn--quiet"
                    disabled={busy}
                    onClick={() => onOpen(item)}
                  >
                    Estimate {item.title}
                  </button>
                </p>
              ) : null;
            })}
            {planning.capacity.unplaced.map(({ item_id, reason }) => {
              const item = planning.tasks.find((task) => task.id === item_id);
              return item ? (
                <p key={item_id}>
                  <button type="button" className="btn btn--quiet" onClick={() => onOpen(item)}>
                    {item.title}
                  </button>
                  :{" "}
                  {reason === "overdue"
                    ? "Deadline has passed"
                    : "No legal slot in the full seven-day projection"}
                </p>
              ) : null;
            })}
          </div>
        </section>
      )}

      {catchUpCommitments.length > 0 && (
        <section className="group" aria-label="Catch up">
          <div className="group__label">Catch up</div>
          <div className="inset">
            {catchUpCommitments.map((commitment) => (
              <AgendaItem
                key={commitment.id}
                commitment={commitment}
                today={today}
                timeZone={zone}
                busy={busy}
                onComplete={onComplete}
                onOpen={onOpen}
                onMove={onMove}
              />
            ))}
          </div>
        </section>
      )}

      {agenda.length > 0 && (
        <section className="group" aria-label="Today">
          <div className="group__label">
            Today
            <span className="group__note">{agenda.length} scheduled</span>
          </div>
          <div className="inset">
            {agenda.map((commitment) => (
              <AgendaItem
                key={commitment.id}
                commitment={commitment}
                today={today}
                timeZone={zone}
                busy={busy}
                onComplete={onComplete}
                onOpen={onOpen}
                onMove={onMove}
              />
            ))}
          </div>
        </section>
      )}

      {riskTargets.length > 0 && (
        <section className="group home-risks" aria-label="At risk">
          <div className="group__label">At risk</div>
          <div className="inset">
            {riskTargets.map((risk, index) => (
              <a
                key={`${risk.id}-${index}`}
                className="home-risk"
                href={`#${risk.kind === "task" ? `task-${risk.id}` : commitmentTarget(risk)}`}
                aria-label={`At risk: ${risk.title}`}
              >
                <span className="home-risk__body">
                  <strong className="home-risk__title">{risk.title}</strong>
                  <span>{risk.message}</span>
                </span>
                <span>View item</span>
              </a>
            ))}
            {planning.risks.some((risk) => risk.kind === "missed_block") && (
              <RecoveryPanel
                timeZone={zone}
                busy={busy}
                onPreview={onPreviewRecovery}
                onApply={onApplyRecovery}
              />
            )}
          </div>
        </section>
      )}

      <section className="group home-week" aria-label="This week">
        <div className="group__label">This week</div>
        <div className="inset">
          <WeeklyReview onLoad={onLoadWeeklyReview} />
        </div>
      </section>

      {(visibleFutureCommitments.length > 0 || visibleUpcomingTasks.length > 0) && (
        <section className="group" aria-label="Upcoming">
          <div className="group__label">
            Upcoming
            <span className="group__note">
              {futureCommitments.length + upcomingTasks.length} ahead
            </span>
          </div>
          <div className="inset">
            {visibleFutureCommitments.map((commitment) => (
              <AgendaItem
                key={commitment.id}
                commitment={commitment}
                today={today}
                timeZone={zone}
                busy={busy}
                onComplete={onComplete}
                onOpen={onOpen}
                onMove={onMove}
              />
            ))}
            {visibleUpcomingTasks.map((item) => (
              <div id={taskTarget(item)} key={item.id}>
                <Row
                  item={item}
                  today={today}
                  busy={busy}
                  onComplete={() => onComplete(item.id)}
                  onOpen={() => onOpen(item)}
                />
              </div>
            ))}
          </div>
          {hasWorkToSchedule && (
            <button
              type="button"
              className="btn btn--accent btn--full"
              disabled={busy || !planning.complete}
              onClick={onSchedule}
            >
              Plan my day
            </button>
          )}
        </section>
      )}
    </div>
  );
}
