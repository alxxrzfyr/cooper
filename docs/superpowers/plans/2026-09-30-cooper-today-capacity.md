# Cooper today capacity implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or
> executing-plans to implement this plan task-by-task. Steps use checkbox syntax
> for tracking. This document is a plan, not authorization to execute it.

**Goal:** Show scoped, honest remaining-day feasibility and stop duration-fit
answers from ignoring the actual scheduler's constraints.

**Architecture:** Factor the current seven-day scheduling inputs into one pure
projection used by scheduling, Home and the capacity assessment. The assessment
reports the due-today slice of that full projection, while the standalone duration
probe uses the same placement rules with a today-only boundary. No model, schema or
hosting changes.

**Tech Stack:** Existing Python 3.12, pytest, FastAPI, React/TypeScript, Vitest,
Ruff and Prettier. No new dependency.

**Spec:** [Web-first product design](../specs/2026-09-30-cooper-web-first-product-design.md),
section "First buildable contract" and its responsive/state requirements only.

Status: IMPLEMENTED IN THE WORKING TREE, 2026-10-01. The scope and contracts below incorporate
the 2026-09-30 feasibility, scheduling-scope, estimate and timezone review. Future
recovery, weekly review, routines, accounting, funded AI and GCP stay outside this plan.

## Implementation record

The owner authorized implementation on 2026-10-01. Tasks T1 through T4 are implemented.
`project_open_tasks()` now drives both snapshot and scheduling. Home uses legal
earliest-start candidates; its task-row waiting text also reflects the projection.
Capacity filters the due-today reporting cohort from the full seven-day schedule.
Unknown estimates and unavailable sources have separate visible states. Ask probes
one bounded, unsaved session using `place(until=local_midnight)`. Task details save
estimates through the existing owner-checked PATCH and undo path. The pilot displays
the configured server timezone in setup and settings.

Regression evidence includes the 30-minute/10-minute-limit contradiction, pinned
future competition, unknown-only/mixed demand, source failure, lead/break/count
limits, fragmented gaps, local-midnight DST boundaries, model/write sentinels,
owner isolation, estimate refresh/undo, failed-draft retention and duplicate-submit
prevention. A browser check additionally caught and corrected generic task-row
"no suitable slot" text for a valid unsaved candidate.

Full automated verification: 443 pytest tests and 230 Vitest tests passed. Python
checks, frontend formatting and production build passed. The final task-row copy
correction also passed its focused HTTP regression. Browser acceptance uses an
isolated local SQLite database and synthetic source health, not connected providers.
Screenshots were inspected at desktop and mobile sizes; estimate saving refreshed
the visible summary. Layout checks at 320, 390, 768, 900, 1024, 1366 and 1920 CSS
pixels found no horizontal overflow, including a 600px laptop height. Source-failure
copy and suppressed recommendations were inspected on screen. Keyboard navigation
stays inside details, Escape closes, and focus returns to the task launch control,
including after an estimate action disappears. The 320px inspection found clipped
task-footer actions; wrapping with minimum touch sizes corrected it. The running HTTP
probe rejected 30 minutes under a 10-minute limit and preserved task state. Full
native browser zoom and connected-provider acceptance are separate, unperformed
checks. No live-provider, hosted-account, deployment, billing or funded
AI acceptance is implied. No commit, push or PR was requested; existing work is preserved.

Release-gate follow-up, 2026-10-01: the available computer-use inventory contains no
connected browser for native zoom acceptance. The non-secret provider preflight
reports Google OAuth client ID and client secret missing. These checks remain open;
viewport resizing is not browser zoom, and synthetic source health is not live
provider acceptance. See `docs/LIVE_PROVIDER_ACCEPTANCE.md` for the current gate.

The checkbox instructions below remain the original execution recipe. Git checkpoint
steps are deferred; verification outcomes are recorded here rather than treating a
plan-review verdict as release evidence.

## Global constraints

- One responsive web/PWA product. No native mobile development.
- No new table, dependency, background process or persistence migration.
- `brain.py` never writes; `app.py` remains the only database writer.
- This assessment and deterministic answer are read-only and model-free.
- Google/iCloud stay read-only; source failure never establishes safe free time.
- Home, capacity and `plan_tasks()` must use the same all-open-local-task seven-day
  projection. No surface may reconstruct feasibility from free minutes alone.
- Reuse pinning, rank, exact duration, lead time, breaks, deadlines, daily block
  limits and daily minute limits in `place()`.
- The first pilot uses the configured server timezone. UI copy must display it and
  must not promise owner-selectable timezone setup in this tranche.
- Today means the remaining interval until the next midnight in that effective timezone.
- No unknown-as-zero estimate, whole-backlog-as-today or measured-remaining-effort claim.
- No scalar free-minute comparison as a feasibility verdict.
- No logs containing titles, prompts, email bodies, message IDs or secrets.
- Preserve the dirty worktree. Git delivery requires a writable `.git` and scoped staging.

## File map

| File                                                       | Change                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `cooper/planner.py`                                        | Shared full-scope projection; capacity slice; optional probe end boundary |
| `cooper/app.py`                                            | Reuse projection for writes; pure duration probe; deterministic answer    |
| `tests/test_cooper.py`                                     | Time/snapshot/no-mutation regressions                                     |
| `tests/test_api.py`                                        | Actual renderer and HTTP no-model/ownership contracts                     |
| `frontend/src/types.ts`                                    | Discriminated capacity contract                                           |
| `frontend/src/Home.tsx`                                    | Compact in-flow capacity summary; task detail links                       |
| `frontend/src/AvailabilitySettings.tsx`, `Onboarding.tsx`  | Display fixed pilot timezone; no nonfunctional selector                   |
| `frontend/src/test/App.test.tsx`                           | Snapshot-driven presentation and empty/error/partial states               |
| `PRD.md`, `ARCHITECTURE.md`, `README.md`, `docs/DESIGN.md` | Update implemented behavior only after verification                       |

Also modify `frontend/src/Frame.tsx` and `frontend/src/App.tsx` for a manual
missing-estimate editor using the existing PATCH writer, with validation/failure
tests in `frontend/src/test/Frame.test.tsx` and refresh/undo tests in App tests.

Do not split the large existing modules merely to execute this tranche. Review
line/function scope instead. Backend Task 2 depends on Task 1 and replaces the
parallel due-today simulation in the earlier draft. Task 3 consumes Task 2's wire
shape; frontend Task 4 consumes the same shape. Release Task 5 is last.

## Task 1: explicit placement horizon

Modify `cooper/planner.py:place`; test `tests/test_cooper.py:TestPlacing`.

Interface: retain all existing parameters and return `list[Slot]`. Add the keyword
`until: dt.datetime | None = None`. Existing callers retain unchanged behavior.

- [ ] Add this failing test using the existing `task()` helper:

```python
def test_today_probe_never_spills_past_midnight(self):
    at = dt.datetime(2026, 9, 30, 23, 50, tzinfo=dt.UTC)
    end = dt.datetime(2026, 10, 1, tzinfo=dt.UTC)
    hours = Hours(timezone="UTC", weekdays=tuple(range(7)), start_hour=0, end_hour=24)
    result = place(rank([task(minutes=30)], at=at), busy=[], hours=hours, at=at, days=1, until=end)
    assert result == []
```

- [ ] Run `uv run pytest tests/test_cooper.py -k today_probe -q`.
      Expect failure for the unsupported `until` keyword before implementation.
- [ ] Add the signature parameter and clamp expanded windows after `_windows`:

```python
windows = _windows(hours, earliest, days)
if until is not None:
    boundary = until.astimezone(dt.UTC)
    windows = [(start, min(end, boundary)) for start, end in windows if start < boundary]
```

- [ ] Run the new test and existing `TestPlacing`, `TestTimezones` and
      `TestCalendarCoreRepair`. Confirm legacy placement remains unchanged.
- [ ] Add end-boundary tests for overnight availability and DST local midnight.
      Freeze `at` on the relevant dates; use `ZoneInfo("America/New_York")`, including
      2026-03-08 and 2026-11-01. Assert returned ends never exceed local midnight UTC.
- [ ] Review diff and checkpoint with `fix(planner): bound read-only placement horizon`
      only if Git writes are available. Body explains late-night lead-time spill.

## Task 2: one scheduling projection, separately labeled assessment

Modify `cooper/planner.py` and `cooper/app.py`; test `tests/test_cooper.py` and
`tests/test_api.py`. Add these interfaces:

```python
def project_open_tasks(
    *,
    items: Sequence[Item],
    remote_busy: Sequence[tuple[dt.datetime, dt.datetime]],
    hours: Hours,
    at: dt.datetime,
    days: int = 7,
    item_ids: Sequence[str] | None = None,
) -> list[Slot]: ...


def assess_today_capacity(
    *,
    items: Sequence[Item],
    commitments: Sequence[Commitment],
    source_health: Sequence[dict[str, Any]],
    hours: Hours,
    at: dt.datetime,
    projected_slots: Sequence[Slot],
) -> dict[str, Any]: ...
```

`project_open_tasks` is the only place that selects the scheduling task set. It
selects owner-scoped data supplied by the caller, then keeps open local tasks
(`source == "me"`), applies optional `item_ids`, ranks the full selection and calls
`place(..., days=7, scheduled=local)`. It adds all existing timed items to
`remote_busy` before placement, matching `_plan_in_session()` today. It has no DB or
provider access and mutates no `Item`.

- [ ] Add the two failing regressions that define the shared scope:

```python
def test_projection_respects_daily_minute_limit_before_home_recommends(self):
    at = dt.datetime(2026, 9, 30, 10, tzinfo=dt.UTC)
    work = task(id="thirty", minutes=30, due=at + dt.timedelta(hours=2), source="me")
    hours = Hours(timezone="UTC", max_minutes_per_day=10)

    slots = project_open_tasks(items=[work], remote_busy=[], hours=hours, at=at)

    assert slots == []


def test_full_projection_lets_pinned_future_work_compete_for_today_slot(self):
    at = dt.datetime(2026, 9, 30, 10, tzinfo=dt.UTC)
    due_today = task(id="today", minutes=30, due=at + dt.timedelta(hours=1), source="me")
    pinned_future = task(
        id="future", minutes=30, due=at + dt.timedelta(days=2), source="me", pinned=1
    )
    hours = Hours(timezone="UTC", windows=((2, 600, 660),), break_minutes=0, max_per_day=1)

    slots = project_open_tasks(items=[due_today, pinned_future], remote_busy=[], hours=hours, at=at)

    assert [slot.item_id for slot in slots] == ["future"]
```

- [ ] Run `uv run pytest tests/test_cooper.py -k 'projection_respects or pinned_future' -q`.
      Expect import failures for the missing helper. The pre-change synthetic probes
      produced `home_now == "thirty"` while `place()` returned no slot, and a
      due-today-only run placed `today` while the full run placed `future`.
- [ ] Implement `project_open_tasks` using this selection and delegation. Preserve
      the caller's owner scoping; this pure function must not accept `owner_id` or
      query the store.

```python
local = [
    item for item in items if item.source == "me" and item.kind == "task" and item.status == "open"
]
selected = set(item_ids or ())
ranked = rank([item for item in local if not selected or item.id in selected], at=at)
occupied = [*remote_busy]
occupied.extend(
    (start, end)
    for item in items
    if (start := aware(item.start_at)) is not None and (end := aware(item.end_at)) is not None
)
return place(ranked, busy=occupied, hours=hours, at=at, days=days, scheduled=local)
```

- [ ] Replace `_plan_in_session()`'s local selection/rank/place block with this call:

```python
project_open_tasks(
    items=items,
    remote_busy=availability["busy"],
    hours=hours,
    at=at,
    days=days,
    item_ids=item_ids,
)
```

      Add an API regression proving a real `plan_tasks()` call and a snapshot
      projection return identical ordered item IDs for the pinned-future fixture.
      This is the guard against the two paths drifting.

- [ ] In `build_planning_snapshot`, derive `remote_busy` from deduplicated commitments
      whose `source != "cooper"`, call `project_open_tasks` once when source health is
      complete, and pass those slots into `assess_today_capacity`. Reuse that same slot
      list for Home focus. Do not call `place()` a second time for due-today work.
- [ ] Replace the scalar Home recommendation with a projected-slot recommendation:

```python
first_legal_start = at + dt.timedelta(minutes=LEAD)
projected_now = next(
    (slot for slot in projected_slots if slot.start == first_legal_start),
    None,
)
recommended = next(
    (task for task in tasks if projected_now and task["id"] == projected_now.item_id),
    None,
)
```

      Keep an active commitment ahead of this task in `focus.now_id`. If there is no
      projected slot exactly at the first legal start, set no unscheduled Now task.
      Add regressions for the 10-minute daily cap, exhausted block count, a pinned
      future competitor, an active meeting and an unavailable source.

- [ ] Implement the assessment as a cohort filter over `projected_slots`. Use the
      seven-day projection even though the reported demand cohort is due today:

```python
unknown = [item.id for item in due_today if item.minutes is None or item.minutes <= 0]
placed_due_today = [slot for slot in projected_slots if slot.item_id in {i.id for i in due_today}]
placed_ids = {slot.item_id for slot in placed_due_today}
result = {
    "day": day.isoformat(),
    "generated_at": at.isoformat(),
    "status": "source_unavailable" if not complete else "needs_estimates" if unknown else "checked",
    "demand_scope": "due_today_unscheduled",
    "scheduling_scope": "all_open_local_tasks_7_days",
    "due_today_ids": [item.id for item in due_today],
    "overdue_ids": [item.id for item in overdue],
    "other_backlog_count": sum(item.id not in selected_ids for item in pending),
    "missed_block_ids": missed,
    "unknown_estimate_ids": unknown,
    "unknown_estimate_count": len(unknown),
    "assessment_partial": bool(unknown),
    "known_estimated_due_today_minutes": sum(
        item.minutes for item in due_today if item.minutes is not None and item.minutes > 0
    ),
    "candidate_slots": [slot_dict(slot) for slot in placed_due_today] if complete else [],
    "unplaced": overdue_entries,
}
```

      When complete, append `no_feasible_slot` only for known-estimate due-today
      tasks absent from `placed_ids`. An unknown task is never labeled infeasible.
      When incomplete, do not label any estimated task infeasible because the full
      projection did not run. Overdue tasks retain their explicit elapsed-deadline
      reason in either state.

- [ ] Keep `_open_window_minutes` as a gap metric, with merged remote busy intervals,
      local block break padding and the 15-minute lead. Include it only for complete
      source health. Its name and UI copy must say open window, never capacity or fit.
- [ ] Add capacity tests for known estimate plus unknown estimate, all-unknown due-today
      work, overdue and undated backlog, scheduled tasks excluded from added demand,
      missed blocks retained, unavailable source, deduplicated remote aliases, a
      90-minute task with two 60-minute gaps, daily count/minute limits, pinning,
      overnight/DST boundaries, no availability and no providers. Assert the scope
      labels, unknown count, partial flag and known subtotal in each relevant fixture.
      Compare every input `Item.to_dict()` and health record before/after.
- [ ] Run `uv run pytest tests/test_cooper.py -k 'Projection or TodayCapacity or PlanningSnapshot or Placing or Timezones' -q`
      and `uv run pytest tests/test_api.py -k 'plan_tasks or today_exposes or home_focus' -q`.
- [ ] Checkpoint `feat(planner): share scheduling projection with capacity` with a
      body explaining why the demand cohort and scheduling scope remain distinct.

## Task 3: deterministic duration-fit probe

Modify `cooper/app.py:answer_planning_intent` and add a pure helper next to it.
Tests live in `tests/test_api.py:TestPlanningAnswerSemantics` and HTTP fit cases.

Interface: `_fit_duration_slot(view: dict[str, Any], minutes: int) -> Slot | None`.
Consumes the existing serialized snapshot, `view["hours"]` and sampled time.
No session, provider, model or writer access. Shared `place(..., until=...)` decides.

- [ ] Add a regression using `planning_answer_view()` with a complete snapshot,
      `largest_free_block_minutes=120` and `hours` capped at 10 minutes/day. Asking
      "Can I fit 30 minutes today?" must return exactly the no-slot result, with no
      candidate-start fact, and `_fit_duration_slot(view, 30)` must be `None`.
      Add a positive counterpart with adequate limits that returns an exact
      30-minute slot ending by local midnight. Confirm the old scalar branch fails.
- [ ] Add `_supports_today_fit(question: str) -> bool` before dispatching the probe.
      This feature accepts explicit whole-today requests only. Future days, narrower
      windows and unclear horizons clarify rather than guess. The curated frontend
      prompt already says today. This is a conservative guard, not a date parser:

```python
def _supports_today_fit(question: str) -> bool:
    lowered = " ".join(question.casefold().replace("-", " ").split())
    duration_form = (
        r"(?:can i fit|could i fit|do i have enough time for) (?:a |an )?"
        r"(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight) "
        r"(?:minutes?|mins?|hours?|hrs?)"
        r"(?: (?:focus|study|work))?(?: (?:session|block|task))? today[?.]?"
    )
    gap_form = r"(?:what is|what's) my largest free block today[?.]?"
    return (
        re.fullmatch(duration_form, lowered) is not None
        or re.fullmatch(gap_form, lowered) is not None
    )
```

Unsupported scope returns "This fit check supports the rest of today only. Ask
for today without a narrower time window." with no candidate facts or probe call.
Accept only these bounded whole-today forms; any extra qualifier clarifies.
Add renderer and HTTP cases for tomorrow, next week, an ISO date, tonight,
before noon, until noon, from 14:00 to 15:00 and mixed today/tomorrow. Assert
zero probe calls and no candidate facts in every unsupported case. Broader
horizon interpretation is outside this tranche. Guard no-duration fit answers too.

- [ ] Implement the pure probe:

```python
def _fit_duration_slot(view, minutes):
    planning = view["planning"]
    if not planning["complete"]:
        return None
    at = dt.datetime.fromisoformat(planning["generated_at"])
    hours = Hours.from_setting(view["hours"])
    zone = ZoneInfo(hours.timezone)
    day = at.astimezone(zone).date()
    end = dt.datetime.combine(day + dt.timedelta(days=1), dt.time(), tzinfo=zone).astimezone(dt.UTC)
    scheduled = [
        Item(
            id=row["id"],
            kind="task",
            status="open",
            source="me",
            title=row["title"],
            minutes=row["minutes"],
            start_at=_parse(row["start_at"]),
            end_at=_parse(row["end_at"]),
        )
        for row in planning["tasks"]
        if row["source"] == "me" and row["start_at"]
    ]
    busy = [(_parse(row["start_at"]), _parse(row["end_at"])) for row in planning["commitments"]]
    probe = Item(
        id="fit-probe",
        kind="task",
        status="open",
        source="me",
        title="Proposed session",
        minutes=minutes,
        importance=3,
        pinned=0,
        created_at=at,
        due=end,
    )
    slots = place(
        rank([probe], at=at), busy=busy, hours=hours, at=at, days=1, until=end, scheduled=scheduled
    )
    return slots[0] if slots else None
```

Snapshot commitments have validated non-null timestamps; conversion must retain
those guarantees without casts or adding a model path. Update renderer fixtures
to include `generated_at`, full task serialization and `hours`, matching production.

- [ ] Replace only the explicit-duration fit branch with the actual probe:

```python
slot = _fit_duration_slot(view, requested)
if slot is not None:
    message = f"A {requested}-minute session has a candidate slot today. It is not booked."
    facts.append(
        f"Candidate start · {slot.start.astimezone(ZoneInfo(planning['timezone'])).strftime('%I:%M %p')}"
    )
else:
    message = f"No slot found for one {requested}-minute session today under your availability and daily limits."
```

Unavailable health still returns uncertainty before invoking the probe. Missing
requested duration reports a gap fact only, never a feasibility claim. Preserve
all other Ask intents and route replies. Do not claim the synthetic probe fits
ahead of every unscheduled due task; it is a standalone proposed session check.
Reject durations outside 1..1440 before probing, matching the manual field bounds.
Zero minutes must never become an affirmative candidate.

- [ ] Add renderer tests for exhausted count limit, scheduled-block break padding,
      fragmented gaps, late-night lead time, missing duration and unavailable provider.
      Monkeypatch session/model calls to `pytest.fail` to prove read-only/model-free.
- [ ] Add HTTP tests for capacity payload, owner isolation and zero Gemini calls
      on a curated fit request. Run `uv run pytest tests/test_api.py -k 'PlanningAnswerSemantics or fit_question or today_exposes' -q`.
      If TestClient still hangs, diagnose the environment separately. Direct renderer
      tests are not HTTP acceptance; this gate stays open until HTTP tests finish.
- [ ] Checkpoint `fix(ask): validate duration fits through placement`.

## Task 4: compact Home summary

Modify `frontend/src/types.ts`, `Home.tsx` and `test/App.test.tsx`. Reuse existing
section, text and button classes. No new page, dependency or global restyling.

Interface: `PlanningSnapshot.capacity?: TodayCapacity` during additive rollout.
Old API fixtures remain compatible; absence renders no fabricated summary.

- [ ] Add the capacity types, matching the backend's wire fields exactly:

```typescript
interface CapacityFacts {
  day: string;
  generated_at: string;
  demand_scope: "due_today_unscheduled";
  scheduling_scope: "all_open_local_tasks_7_days";
  due_today_ids: string[];
  overdue_ids: string[];
  other_backlog_count: number;
  missed_block_ids: string[];
  unknown_estimate_ids: string[];
  unknown_estimate_count: number;
  assessment_partial: boolean;
  known_estimated_due_today_minutes: number;
  candidate_slots: { item_id: string; start_at: string; end_at: string }[];
  unplaced: { item_id: string; reason: "overdue" | "no_feasible_slot" }[];
}
export type TodayCapacity = CapacityFacts &
  (
    | { status: "checked" | "needs_estimates"; open_window_minutes: number }
    | { status: "source_unavailable"; candidate_slots: []; open_window_minutes?: never }
  );
```

- [ ] Add `TodayCapacitySummary` in `Home.tsx`, consuming `PlanningSnapshot` and
      existing `onOpen`. Render it after Now/Next and before the detailed agenda.
      Use the following content contract, not a success-colored overloaded badge:

```tsx
function TodayCapacitySummary({
  planning,
  onOpen,
}: {
  planning: PlanningSnapshot;
  onOpen: (item: Item | Ranked | CalendarEvent) => void;
}) {
  const capacity = planning.capacity;
  if (!capacity) return null;
  return (
    <section className="group" aria-label="Rest of today">
      <h2>Rest of today</h2>
      <p>
        Updated{" "}
        {new Date(capacity.generated_at).toLocaleTimeString(undefined, {
          timeZone: planning.timezone,
          hour: "numeric",
          minute: "2-digit",
        })}
      </p>
      <p>
        Due today: {capacity.due_today_ids.length} unscheduled tasks, with{" "}
        {capacity.known_estimated_due_today_minutes} known estimated minutes.
      </p>
      {capacity.assessment_partial && (
        <p role="status">
          Partial assessment: {capacity.unknown_estimate_count} due-today{" "}
          {capacity.unknown_estimate_count === 1 ? "task needs" : "tasks need"} an estimate.
        </p>
      )}
      {capacity.status === "source_unavailable" ? (
        <p>Safe capacity is unknown while a connected calendar is unavailable.</p>
      ) : capacity.assessment_partial && capacity.candidate_slots.length === 0 ? (
        <p>No projected slots yet for the due-today tasks with known estimates.</p>
      ) : (
        <p>{capacity.candidate_slots.length} projected slots for due-today work, unsaved.</p>
      )}
      <p>Plan my day considers all open tasks over seven days.</p>
      <p>
        {capacity.overdue_ids.length} overdue tasks. {capacity.other_backlog_count} other
        unscheduled tasks.
      </p>
      {capacity.missed_block_ids.length > 0 && (
        <p>{capacity.missed_block_ids.length} missed blocks need review.</p>
      )}
      {capacity.unknown_estimate_ids.map((id) => {
        const item = planning.tasks.find((task) => task.id === id);
        return item ? (
          <button key={id} type="button" className="btn" onClick={() => onOpen(item)}>
            Estimate {item.title}
          </button>
        ) : null;
      })}
      {capacity.unplaced.map((entry) => {
        const item = planning.tasks.find((task) => task.id === entry.item_id);
        return item ? (
          <p key={entry.item_id}>
            {item.title}:{" "}
            {entry.reason === "overdue" ? "deadline has passed" : "no slot found under this plan"}.
          </p>
        ) : null;
      })}
    </section>
  );
}
```

Do not print IDs, claim measured work remaining or create a second task list. Never
render "0 estimated minutes" as the whole demand or "0 possible slots" as a complete
verdict while `assessment_partial` is true. The scope sentence is required copy, not
a tooltip.
Render references to existing task detail. Never apply candidate slots directly
from this summary. The existing "Plan my day" action rechecks fresh availability.

- [ ] Add App tests using `snapshotView({capacity: ...})`: an all-unknown assessment
      says "Partial assessment" and never says "0 estimated minutes" or "0 possible
      slots"; a mixed known/unknown assessment labels the known subtotal; unknown
      estimate opens its actual Item; unavailable source has no fit claim; partial
      candidates remain labeled unsaved; the scheduling-scope sentence is visible;
      missing field preserves older API behavior; empty assessment keeps the existing
      capture path. Assert no duplicate task row and no model request.
- [ ] Add an optional `onEstimate: (minutes: number) => Promise<boolean>` callback
      to TaskFrame. Only open unscheduled local tasks get this editor; changing
      already scheduled duration would require an interval-consistency design.
      Use existing `useState` for per-item input and error:

```tsx
const [estimate, setEstimate] = useState(item.minutes?.toString() ?? "");
const [estimateError, setEstimateError] = useState<string | null>(null);
```

Insert this form after the existing facts list in Frame's body:

```tsx
{
  item.source === "me" &&
    item.kind === "task" &&
    item.status === "open" &&
    !item.start_at &&
    onEstimate && (
      <form
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy) return;
          const minutes = Number(estimate);
          if (!estimate.trim() || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
            setEstimateError("Enter a whole number from 1 to 1440 minutes.");
            return;
          }
          setEstimateError(null);
          if (await onEstimate(minutes)) onClose();
          else setEstimateError("Could not save the estimate. Your entry is retained.");
        }}
      >
        <label htmlFor="task-estimate">Estimated minutes</label>
        <input
          id="task-estimate"
          type="number"
          min={1}
          max={1440}
          step={1}
          value={estimate}
          onChange={(event) => setEstimate(event.target.value)}
          disabled={busy}
          aria-invalid={estimateError !== null}
          aria-describedby={estimateError ? "task-estimate-error" : undefined}
        />
        {estimateError && (
          <p id="task-estimate-error" role="alert">
            {estimateError}
          </p>
        )}
        <button type="submit" className="btn" disabled={busy}>
          Save estimate
        </button>
      </form>
    );
}
```

In App supply `key={detail.id}` on TaskFrame for draft isolation and
`onEstimate={minutes => act(() => api.edit(detail.id, { minutes }))}`. Existing
`act()` refreshes the canonical view and returns success. Close on success only;
retain draft on failure. Existing PATCH checks ownership and records undo. This
is a detail editor requested by the user, not a composer confirmation modal.
No new route or model call. Announce the saved estimate through the existing
notice helper when `act` succeeds, since edit currently returns no text receipt.

- [ ] Frame tests submit blank, zero, fractional and 1441 values with no callback;
      valid 30 invokes once; false result retains draft/error and true closes.
      App tests verify PATCH `{minutes: 30}`, refreshed capacity and undo restoring
      unknown effort. Imported/scheduled items get no editor. Preserve focus return
      to the launch control on close.
- [ ] Keep the pilot timezone truthful. Change the availability hint to "Times use
      the Cooper pilot timezone: {hours.timezone}." Add an onboarding availability
      step that displays the same value and opens Settings, but provides no timezone
      picker. Pass `view.timezone` into `Onboarding`; add component tests proving the
      visible timezone matches the backend view and that no timezone select/input is
      rendered. Owner-timezone persistence, conversion and DST acceptance remain a
      separate plan that triggers the AGENTS.md stop condition for deliberate scope.
- [ ] Build and inspect at the spec's widths and zooms. Labels wrap; buttons stay
      touch/keyboard accessible; no fixed-height summary or text clipping. A blocked
      browser is an open acceptance gate, not a passing screenshot review.
- [ ] Checkpoint `feat(home): show scoped capacity and estimate gaps`.

## Task 5: release evidence and documentation

- [ ] Run `uv run pytest`, `uv run ruff check .`, and `uv run ruff format --check .`.
- [ ] In frontend run `npm run format:check`, `npm test -- --no-file-parallelism`,
      `npm run build`. Format exact changed files before rerunning checks.
- [ ] Run `git diff --check`; inspect only this tranche's diff, preserving prior work.
- [ ] Perform real no-provider and unavailable-provider scenarios in the running app.
      Compare Home facts and Ask answer to actual saved items. Confirm no mutation
      from probes and original scheduling/undo still works.
- [ ] Record fixture, HTTP, browser and deployment evidence separately. No live
      Google/iCloud claim without connected acceptance. No production claim from a build.
- [ ] Update current-behavior docs and the plan status only for verified outcomes.
      Keep weekly/funded AI/billing/GCP as future contracts.
- [ ] Review and deliver a scoped Conventional Commit/PR only if requested and Git
      permissions allow. Never stage the unrelated landing/commercial draft by glob.

## Verification map and stop conditions

| Contract                           | Automated proof                                 | Separate acceptance                 |
| ---------------------------------- | ----------------------------------------------- | ----------------------------------- |
| Local day, lead, breaks and limits | Pure place/capacity boundary tests              | Visible correct local times         |
| Backlog/unknown/overdue scopes     | Snapshot cohort fixtures                        | Home labels versus real data        |
| Fit checks actual placement        | Renderer regression with 10-minute cap          | Ask no false affirmative            |
| Zero model/writes                  | Failing sentinels plus unchanged Item snapshots | No extra network/model traffic      |
| Owner isolation                    | HTTP two-owner fixtures                         | Hosted auth staging                 |
| Responsive content                 | Component semantics/build                       | Rendered width/zoom/keyboard review |

## What already exists

| Existing flow                       | Reuse in this plan                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| `planner.rank()`                    | Keeps pinning and explainable priority order. No capacity-specific ranker.            |
| `planner.place()`                   | Remains the authority for exact duration, lead, breaks, deadlines and daily limits.   |
| `app._plan_in_session()`            | Keeps fresh owner-scoped reads and becomes a caller of `project_open_tasks()`.        |
| `planner.build_planning_snapshot()` | Samples one `at`, timezone, source-health set and commitment set for Home and Ask.    |
| `app.today_view()`                  | Performs provider reads once and serializes the additive capacity field.              |
| Existing PATCH item route           | Saves missing estimates with owner checks and existing undo.                          |
| Existing `act()` refresh            | Refreshes the canonical snapshot after estimate edits.                                |
| Existing Home references            | Reuses task cards/details; the capacity summary does not create a parallel task list. |

The rejected duplication is a second scheduler that ranks only due-today work.
Capacity filters a reporting cohort from the canonical full projection instead.

## Data flow

```text
today_view(owner)
  |
  +-- owner-scoped open items
  +-- normalized commitments + source health
  +-- current_hours() with configured server timezone
  |
  v
build_planning_snapshot(at)
  |
  +-- project_open_tasks(all open local tasks, seven days) ----+
  |       rank -> place -> projected slots                    |
  |                                                            |
  +-- Home focus: slot starts at at + 15 minutes? -> Now id    |
  +-- capacity: filter due-today outcomes from same slots       |
  +-- Ask: standalone today-only duration probe via place       |
  |                                                            |
  +------------------------------------------------------------+

Plan my day
  -> _plan_in_session()
  -> project_open_tasks(same task set and constraints)
  -> app.py writes returned slots once and records undo
```

The duration probe is deliberately separate because it answers whether one proposed
session has a legal slot. Its response says it is a standalone unsaved candidate and
does not claim the session wins priority over the backlog.

## Test coverage diagram

```text
CODE PATHS                                         USER-OBSERVABLE CONTRACTS
[ ] project_open_tasks()                           [ ] Home Now
    +-- all open local tasks                           +-- 10-minute cap hides 30-minute task
    +-- optional item_ids                              +-- pinned future task can win first slot
    +-- remote + existing local busy                   +-- active commitment remains current
    +-- rank/pin/deadline                              +-- unavailable source suppresses task
    +-- place limits and breaks

[ ] assess_today_capacity()                        [ ] Rest of today
    +-- complete projection                            +-- demand and scheduling scopes shown
    +-- unavailable source                             +-- all unknown says partial, never zero total
    +-- known + unknown                                +-- known subtotal is labeled
    +-- overdue / missed / backlog                     +-- candidate slots remain unsaved
    +-- no feasible slot

[ ] answer_planning_intent(fit_duration)            [ ] Ask fit answer
    +-- supported rest-of-today form                   +-- daily limit contradiction removed
    +-- unsupported horizon clarifies                  +-- future/narrow windows clarify
    +-- complete / incomplete sources                  +-- no model call and no write
    +-- exact slot / no slot

[ ] estimate PATCH + refresh                       [ ] Missing estimate recovery
    +-- valid whole minutes                            +-- draft retained on failure
    +-- invalid bounds                                 +-- saved value refreshes assessment
    +-- owner/source checks                            +-- undo restores unknown state

[ ] effective timezone                             [ ] Pilot setup
    +-- backend-configured value                       +-- same timezone shown in setup/settings
    +-- local midnight / DST                           +-- no nonfunctional timezone selector
```

Pure planner branches belong in `tests/test_cooper.py`. Renderer and route semantics
belong in `tests/test_api.py`. React state, copy, focus and validation belong in the
existing Vitest files. The running-app pass covers only visible integration that unit
fixtures cannot establish. No LLM eval is needed because this tranche adds no prompt
or model behavior.

## Failure modes

| Failure                                               | Required handling                                                                  | Proof                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Home sees an open gap but daily minutes are exhausted | No unscheduled `focus.now_id`                                                      | Pure snapshot regression plus rendered Home test     |
| Pinned future work takes today's only slot            | Due-today task is unplaced under the full projection; scope copy explains why      | Pure projection test and capacity payload assertion  |
| A task has no estimate                                | Exclude it from placement, increment unknown count and mark assessment partial     | All-unknown and mixed fixtures plus copy assertions  |
| Connected source fails                                | Run no projection and expose no candidate/open-window claim                        | Planner, HTTP and Home unavailable-state tests       |
| Provider aliases duplicate one interval               | Deduplicate before projecting; do not subtract twice                               | Normalized commitment fixture                        |
| Process reads at 23/25-hour DST day                   | End today at the effective timezone's next local midnight                          | Spring/fall timezone tests                           |
| Estimate PATCH fails                                  | Keep entered value, show associated error and leave detail open                    | Frame component rejection test                       |
| Snapshot and apply happen at different times          | `apply_slots()` reruns the same helper under the existing locked-hours writer path | API test changes occupancy between preview and apply |
| Old frontend receives a new backend payload           | Additive optional `capacity`; existing fields remain                               | Legacy fixture without capacity plus build           |
| Old backend serves a new frontend                     | Omit summary when `capacity` is absent; make no inferred claim                     | Component compatibility test                         |

No listed failure may be silent. Source failure and partial assessment are visible;
write failure retains input; placement failure names the affected known-estimate task.

## NOT in scope

- Owner-selectable timezone persistence. The pilot displays the configured server
  timezone; a wider launch needs a separate end-to-end timezone plan.
- Recovery preview/apply, weekly review, routines and recurring work. They depend on
  this trusted projection but have separate product and mutation contracts.
- Funded Gemini/Groq, allowance reservations, billing tables or checkout. Their
  accounting contract is specified as an activation gate, not authorized here.
- General natural-language date parsing. The first duration probe accepts bounded
  rest-of-today forms and clarifies every narrower or future horizon.
- Task splitting, remaining-effort tracking or optimizer search. Estimates remain
  whole-task values and `place()` remains greedy.
- Provider write-back, broader OAuth scopes, a second watcher or new infrastructure.

## Execution order

Sequential implementation, no parallelization opportunity. Tasks 1 through 4 all
change the planner-to-snapshot contract or its direct consumers, so separate
worktrees would create avoidable conflicts and could validate against mismatched wire
shapes. Execute Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 in one worktree, with
the focused test gate and scoped commit after each task.

## Implementation tasks

- [x] **T1 (P1, human: ~2h / agent: ~20m)** — Planner — add the explicit `until`
      boundary and DST regressions for today-only probes.
  - Surfaced by: late-night duration checks can spill into tomorrow.
  - Files: `cooper/planner.py`, `tests/test_cooper.py`.
  - Verify: `uv run pytest tests/test_cooper.py -k 'today_probe or Timezones' -q`.
- [x] **T2 (P1, human: ~1d / agent: ~60m)** — Planner and writer — factor one
      seven-day projection and consume it from snapshot, Home focus and scheduling.
  - Surfaced by: Home's scalar fit contradiction and the due-today/full-schedule task-set mismatch.
  - Files: `cooper/planner.py`, `cooper/app.py`, `tests/test_cooper.py`, `tests/test_api.py`.
  - Verify: the Task 2 focused commands and the two reproduced regressions.
- [x] **T3 (P1, human: ~4h / agent: ~30m)** — Ask — replace scalar duration-fit
      answers with a bounded placement probe and explicit unsupported-horizon response.
  - Surfaced by: a 30-minute affirmative answer under a 10-minute daily cap.
  - Files: `cooper/app.py`, `tests/test_api.py`.
  - Verify: `uv run pytest tests/test_api.py -k 'PlanningAnswerSemantics or fit_question' -q`.
- [x] **T4 (P1, human: ~1d / agent: ~75m)** — Home and estimates — render partial
      assessments, both scopes, estimate editing and truthful fixed-timezone pilot copy.
  - Surfaced by: zero-looking unknown effort and promised timezone selection without backend support.
  - Files: `frontend/src/types.ts`, `Home.tsx`, `Frame.tsx`, `App.tsx`,
    `AvailabilitySettings.tsx`, `Onboarding.tsx` and their existing test files.
  - Verify: `npm test -- --no-file-parallelism`, `npm run build`, then width/zoom/keyboard inspection.
- [ ] **T5 (P1, human: ~3h / agent: ~30m plus manual acceptance)** — Release — run
      the complete checks, inspect the running app and update current-behavior docs only
      for behavior proven in this implementation.
  - Surfaced by: the repository separates fixture, HTTP, browser, provider and deployment evidence.
  - Files: `PRD.md`, `ARCHITECTURE.md`, `README.md`, `docs/DESIGN.md` after verification.
  - Verify: all Task 5 commands plus no-provider and unavailable-provider running-app scenarios.

Stop for a new table, dependency, background process, changed token/binding/OAuth
behavior or contradicting product rule. Stop guessing after a twice-failing
undiagnosed test. None of the commercial launch choices blocks this isolated
capacity implementation once its design is approved.

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                        | Runs | Status       | Findings                                                           |
| ------------- | --------------------- | -------------------------- | ---- | ------------ | ------------------------------------------------------------------ |
| CEO Review    | `/plan-ceo-review`    | Scope and strategy         | 0    | NOT LOGGED   | Direct product review recorded separately; renewal unvalidated     |
| Codex Review  | `/codex review`       | Independent second opinion | 0    | NOT RUN      | No independent external model result claimed                       |
| Eng Review    | `/plan-eng-review`    | Architecture and tests     | 1    | CLEAR (PLAN) | 5 issues corrected; 0 critical gaps; 0 unresolved decisions        |
| Design Review | `/plan-design-review` | UI and state clarity       | 0    | NOT LOGGED   | State contracts reviewed in the direct review record               |
| DX Review     | `/plan-devex-review`  | Implementation clarity     | 0    | NOT LOGGED   | Instructions and evidence boundaries reviewed in the direct record |

**VERDICT:** ENG CLEARED. The capacity plan is ready for implementation. Funded AI and paid launch remain separately gated.

NO UNRESOLVED DECISIONS
