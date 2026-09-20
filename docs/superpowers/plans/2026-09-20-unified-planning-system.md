# COOPER Unified Planning System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan
> task-by-task. Use TDD for the pure planning, ranking, deduplication, intent, and mutation logic.
> Do not stage or overwrite unrelated worktree changes.

**Goal:** Make Ask, Home, Calendar, provider commitments, workload counts, and task recommendations
consume one normalized planning snapshot, with privacy-safe AI reasoning and post-commit mutation
receipts.

**Architecture:** Extend the existing read-only `sources.py` pipe to normalize and conservatively
deduplicate commitments. Extend the deterministic `planner.py` layer to derive task states, risks,
metrics, focus, and explainable ranking. Keep `app.py` as the only writer and make it rebuild the
snapshot after every write before returning a success receipt. Keep `brain.py` responsible only for
bounded intent parsing and `Action` validation. Migrate the React surfaces to the backend snapshot,
then remove browser-side schedule reconstruction.

**Tech Stack:** Python 3.12, FastAPI, Pydantic, SQLAlchemy, pytest, React 19, TypeScript, Vitest,
Testing Library, Vite, Ruff, Prettier.

**Spec:** `docs/superpowers/specs/2026-09-20-unified-planning-system-design.md`

## Global constraints

- `brain.py` never reads or writes the database.
- `app.py` remains the only database writer.
- Google Calendar and iCloud remain read-only.
- Manual/Form mode never calls Gemini.
- A failed connected provider never becomes invented free time.
- External titles, descriptions, attendees, addresses, and locations never enter Gemini prompts.
- Preserve the existing `items` table and its owner scoping; do not add a table or migration.
- Preserve `google_event_id` and `source_ref` as distinct relationships.
- Do not add a background process, queue, dependency, project model, or fifth category.
- Green remains done and red remains gone.
- During implementation, keep the legacy `shortlist`, `scheduled`, and `events` response fields only
  until every frontend consumer uses `planning`; remove the duplicate calculations before release.
- The current worktree already contains unrelated changes in `frontend/src/Nav.tsx` and
  `frontend/src/theme.css`. Inspect and preserve them. Stage files explicitly.

## CEO review outcome

**Mode:** Selective expansion. Add only the contracts needed to make existing features coherent:
the planning snapshot, typed read intents, meaningful priority, derived state, and verified
mutation receipts. Reject the persisted event ledger, provider write-back, snooze workflow, and
project-management expansion.

**Premise:** The problem is not that Gemini needs a larger prompt. The problem is that Calendar,
Home, Ask, badges, and scheduling currently reconstruct different partial versions of the user's
day. The implementation succeeds only if those competing interpretations disappear.

**Highest-value first slice:** A backend snapshot with mixed-source counts, provider-aware
availability, and deterministic answers for the existing suggested prompts. This proves the core
value before the Home presentation and local move action expand the surface area.

**Assumptions to verify during implementation:**

- Per-request provider reads remain fast enough for `/api/today` and Ask; measure before adding any
  cache or persistence.
- Exact identity and exact signatures remove known duplicates without fuzzy matching.
- Common deterministic Ask intents cover the high-frequency planning questions; long-tail model
  behavior remains secondary.
- Provider incompleteness blocks only decisions that require unknown availability. Reading local
  tasks, completing work, and other safe local actions continue normally.
- The snapshot remains a projection, not a second domain database or a bag of frontend-specific
  presentation fields.

**Devil's-advocate risks and controls:**

- A giant snapshot builder could become another monolith. Keep normalization in `sources.py`, pure
  calculations in `planner.py`, orchestration in `app.py`, and rendering in React.
- A long dual-API migration could create exactly the divergence this work is meant to remove. Keep
  legacy fields only across the bounded migration tasks and delete them in Task 9.
- Deterministic answers could feel rigid. Prefer precise product answers for common questions and
  reserve Gemini for interpretation and concise wording, not facts.
- Blocking on one provider could make COOPER unusable. Block only placement or fit claims that
  require the missing calendar; continue safe local reads and writes with an incomplete warning.
- A committed write followed by verification failure could be retried and duplicated. Return an
  explicit unknown-outcome message instructing the user to refresh before retrying.

**Reversal test:** If the complete Home redesign were removed, the snapshot, counts, availability,
and grounded Ask responses would still solve a valuable product problem. If the snapshot itself
cannot make the existing suggested prompts and mixed-source counts deterministic, stop before
adding more UI or mutation vocabulary and revisit the projection boundary.

## Founder release sequence

The architecture stays the same, but implementation follows user value rather than document order.
Execute the tasks in this release sequence:

### Release 1: Prove the trusted planning loop

**Implementation status (2026-09-20):** Tasks 1, 2, 3, 4, 6, 7, and 8 are implemented and pass the
automated backend and frontend gates. Release 1 remains in its real-use acceptance period; the
seven-day mixed-source trust gate below is intentionally not marked complete.

- Task 1: meaningful deadline-first priority and derived state;
- Task 2: normalization and conservative deduplication;
- Task 3: canonical planning snapshot;
- Task 4: unified Calendar and navigation counts;
- Task 6: grounded Ask intents;
- Task 7: verified create and schedule receipts;
- Task 8: typed suggested prompts and grounded rendering.

Release 1 passes only after seven days of real mixed-source use show that counts agree, suggested
questions use actual state, provider failures do not invent availability, and success replies match
committed state. Record mismatches as product bugs. Do not hide them as model-quality variance.

### Release 2: Earn the Home command center

- Task 5: rebuild Home from the trusted snapshot;
- Task 5B: add local rescheduling only after the create and schedule receipt path is proven;
- verify Now, Next, Today, At Risk, and Upcoming against real schedules.

Do not start Release 2 because the backend types exist. Start it because Release 1 has proven that
the underlying planning facts are trustworthy.

### Release 3: Remove compatibility fields

- Task 9: remove legacy response fields and frontend reconstruction;
- Task 10: complete documentation, live-provider acceptance, and release verification.

The backend and frontend deploy independently. Deploy the additive `planning` response first, then
the snapshot-driven frontend. Remove `shortlist`, `scheduled`, and `events` in a later release only
after the hosted frontend has been verified. A permanent dual API is forbidden; a bounded
compatibility window is required.

## Target contracts

The backend response should converge on these shapes. Exact Python/TypeScript syntax may adapt to
existing conventions, but the semantics must not drift.

```python
@dataclass(frozen=True, slots=True)
class Commitment:
    id: str
    source: str
    source_id: str | None
    aliases: tuple[str, ...]
    title: str
    kind: Literal["task", "event"]
    start: datetime
    end: datetime
    all_day: bool
    category: str
    editable: bool
    local_item_id: str | None = None
```

```typescript
interface PlanningSnapshot {
  generated_at: string;
  today: string;
  timezone: string;
  complete: boolean;
  source_health: SourceHealth[];
  commitments: PlanningCommitment[];
  tasks: PlanningTask[];
  focus: { now_id: string | null; next_id: string | null };
  risks: PlanningRisk[];
  metrics: {
    scheduled_count: number;
    occupied_minutes: number;
    remaining_effort_minutes: number;
    largest_free_block_minutes: number;
    conflict_count: number;
  };
}
```

```typescript
type AskIntent =
  | "focus_week"
  | "remaining_today"
  | "work_next"
  | "fit_duration"
  | "deadline_summary"
  | "overload_check";
```

## Task 1: Make ranking and task state meaningful

**Files:**

- Modify: `cooper/planner.py`
- Test: `tests/test_cooper.py`

**Interfaces:**

- Add importance as an explainable ranking term without allowing it to outrank hard deadline
  pressure.
- Add a pure `task_state(...)` helper for open local tasks.
- Keep `rank(items, at=...)` deterministic and preserve pin behavior.

- [ ] **Step 1: Add failing ranking tests.**

Add tests proving:

- importance changes order between tasks with the same deadline and duration;
- a normal task due today outranks a critical task due much later;
- a pin remains the strongest explicit override;
- `Scored.why` includes an `importance` term.

- [ ] **Step 2: Run the focused tests and confirm the intended failure.**

```bash
uv run pytest tests/test_cooper.py -k "rank or importance" -q
```

Expected: the new importance assertions fail against the current three-term score.

- [ ] **Step 3: Implement the smallest ranking change.**

Add an importance term normalized from the existing 1–5 field. Rebalance the constants so deadline
pressure remains the largest term, importance is meaningful, and age/duration remain tie-breakers.
Do not add an AI reranker or persisted rank.

- [ ] **Step 4: Add failing derived-state tests.**

Cover `not_started`, `scheduled`, `in_progress`, `blocked`, `overdue`, `missed_block`, `completed`,
and `dropped`. Use fixed timezone-aware datetimes. Treat provider incompleteness as blocked only for
work that still needs placement, not for a task already scheduled.

- [ ] **Step 5: Implement `task_state` and rerun the focused suite.**

```bash
uv run pytest tests/test_cooper.py -k "rank or importance or task_state" -q
```

- [ ] **Step 6: Commit the pure planning behavior.**

```bash
git add cooper/planner.py tests/test_cooper.py
git commit -m "feat(planner): make priority and task state meaningful" -m "Use deterministic deadline-first ranking and derived task states so every product surface can explain the same recommendation."
```

## Task 2: Normalize and deduplicate commitments

**Files:**

- Modify: `cooper/sources.py`
- Test: `tests/test_cooper.py`
- Read: `cooper/db.py`
- Read: `cooper/google.py`
- Read: `cooper/icloud.py`

**Interfaces:**

- Add one compact immutable `Commitment` representation.
- Add normalization helpers for local `Item` values and existing provider event dictionaries.
- Add `deduplicate_commitments(...)` with explicit-link and exact-signature rules.
- Preserve `busy_windows(...)` for placement; derive its intervals from normalized commitments only
  after parity is proven.

- [ ] **Step 1: Add failing normalization tests.**

Cover local scheduled tasks, local fixed events, Google events, iCloud events, Gmail-derived items,
all-day values, UTC normalization, editability, and source aliases.

- [ ] **Step 2: Add failing deduplication tests.**

Prove that:

- identical provider IDs collapse;
- a Google record explicitly linked by `google_event_id` collapses into the local record;
- a Gmail `source_ref` is not confused with a Google event ID;
- exact cross-provider title/start/end/all-day signatures collapse;
- overlapping events with different titles remain separate;
- same-title events at different times remain separate.

- [ ] **Step 3: Run the focused tests and confirm failure.**

```bash
uv run pytest tests/test_cooper.py -k "commitment or deduplic" -q
```

- [ ] **Step 4: Implement normalization and conservative deduplication.**

Normalize comparison times to UTC, collapse whitespace and case only for signature comparison, keep
the original title for rendering, and sort aliases for deterministic output. Do not use fuzzy text
matching.

- [ ] **Step 5: Prove interval parity.**

Add a test showing deduplicated commitments produce the same or safer occupied intervals than the
current provider/local collectors and do not double-charge a linked event.

- [ ] **Step 6: Run the complete pure-function suite.**

```bash
uv run pytest tests/test_cooper.py -q
```

- [ ] **Step 7: Commit the source projection.**

```bash
git add cooper/sources.py tests/test_cooper.py
git commit -m "feat(calendar): normalize unified commitments" -m "Give local and read-only provider records one conservative identity model so counts and availability no longer diverge."
```

## Task 3: Build the canonical planning snapshot

**Files:**

- Modify: `cooper/planner.py`
- Modify: `cooper/app.py`
- Test: `tests/test_api.py`
- Test: `tests/test_cooper.py`

**Interfaces:**

- Add a pure snapshot builder in `planner.py` that accepts items, normalized commitments,
  availability, hours, and `at`.
- Make `today_view()` fetch each source once, construct the snapshot once, and expose it as
  `planning`.
- Keep legacy response fields temporarily and derive them from the same fetched data.

- [ ] **Step 1: Add failing snapshot metric tests.**

Use fixed fixtures to prove:

- one local scheduled task plus two Google events plus one iCloud event yields
  `scheduled_count == 4`;
- a deduplicated alias counts once;
- occupied minutes split correctly across midnight;
- all-day and multi-day events belong to every covered local date;
- remaining task effort excludes completed, dropped, and provider events;
- conflicts and largest free block are deterministic.

- [ ] **Step 2: Add failing focus and risk tests.**

Cover active commitment selection, chronological next selection, overdue work, missed blocks,
cannot-fit-before-deadline, fixed conflicts, and incomplete provider availability.

- [ ] **Step 3: Implement the pure snapshot builder.**

Keep it free of database, network, and model calls. Recommendation reasons should be structured
facts suitable for both UI rendering and deterministic Ask answers.

- [ ] **Step 4: Add `/api/today` integration tests.**

Test the full response with mocked Google/iCloud transports. Assert that `planning`, legacy fields,
and source health agree and that owner scoping is preserved.

- [ ] **Step 5: Refactor `today_view()` to build one snapshot.**

Do not issue duplicate provider reads for Ask, counts, and availability within one request. Preserve
existing Gmail health and connection metadata.

- [ ] **Step 6: Run backend tests.**

```bash
uv run pytest tests/test_cooper.py tests/test_api.py -q
```

- [ ] **Step 7: Commit the backend source of truth.**

```bash
git add cooper/planner.py cooper/app.py tests/test_cooper.py tests/test_api.py
git commit -m "feat(planning): expose one shared daily snapshot" -m "Calculate focus, risk, commitments, and workload once so every COOPER surface receives the same current state."
```

## Task 4: Move Calendar and navigation counts to the snapshot

**Files:**

- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/calendar-data.ts`
- Modify: `frontend/src/Calendar.tsx`
- Modify carefully: `frontend/src/Nav.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/test/App.test.tsx`
- Test: `frontend/src/test/notification.test.tsx`

**Interfaces:**

- Add TypeScript types for the backend snapshot.
- Render `view.planning.commitments` directly.
- Use `view.planning.metrics.scheduled_count` for the calendar badge.
- Reduce `calendar-data.ts` to formatting/day-membership helpers only; it must no longer merge
  `scheduled` and `events` or independently detect conflicts.

- [ ] **Step 1: Inspect and preserve the pre-existing `Nav.tsx` diff.**

```bash
git diff -- frontend/src/Nav.tsx
```

Record which lines belong to the existing sidebar work. Limit this task to changing the badge input
contract and its tests.

- [ ] **Step 2: Update test fixtures first.**

Add a reusable `planning()` fixture in the existing frontend test helpers. Add failing tests for a
four-item mixed-source count, a deduplicated item count of one, source labels, conflicts, and an
incomplete provider warning.

- [ ] **Step 3: Add snapshot types and migrate Calendar.**

Do not redesign the calendar geometry. Preserve Day, Week, Month, source context, event details, and
the existing continuous-corner styling.

- [ ] **Step 4: Migrate the navigation badge.**

Pass `planning.metrics.scheduled_count`, not `view.scheduled.length`. Do not add another count helper
to `App.tsx` or `Nav.tsx`.

- [ ] **Step 5: Run targeted frontend tests.**

```bash
cd frontend
npm test -- src/test/App.test.tsx src/test/notification.test.tsx --no-file-parallelism
```

- [ ] **Step 6: Commit only intended files.**

Before staging, inspect `git diff` and do not absorb unrelated theme or navigation changes into this
commit.

```bash
git add frontend/src/types.ts frontend/src/calendar-data.ts frontend/src/Calendar.tsx frontend/src/App.tsx frontend/src/test/App.test.tsx frontend/src/test/notification.test.tsx
git add -p frontend/src/Nav.tsx
git commit -m "fix(calendar): count every unified commitment" -m "Render and count the backend planning snapshot so external calendars and local work agree across the calendar and navigation."
```

## Task 5: Rebuild Home as a snapshot-driven command center

**Files:**

- Modify: `frontend/src/Home.tsx`
- Modify carefully: `frontend/src/theme.css`
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/test/App.test.tsx`

**Interfaces:**

- Render one underlying agenda from snapshot commitments and tasks.
- Use `focus.now_id` and `focus.next_id` as references, not duplicate item cards.
- Render risk summaries as links or references to the single affected item.
- Preserve separate desktop and mobile layout behavior.

- [ ] **Step 1: Add failing Home behavior tests.**

Cover:

- current commitment and next commitment;
- a free block with a recommended task;
- mixed local/external Today agenda;
- risk references without duplicate item cards;
- external read-only affordances;
- empty, loading, and incomplete-provider states.

- [ ] **Step 2: Replace shortlist-first selection.**

Remove `const next = shortlist[0]` and browser-side `calendarEntries(...)` usage. Render Now, Next,
Today, At Risk, and Upcoming from the snapshot.

- [ ] **Step 3: Wire meaningful local actions.**

Preserve complete, schedule, pin, edit, and drop behavior. Do not show mutation controls on external
events. Do not introduce drag-and-drop.

- [ ] **Step 4: Refine responsive presentation.**

Keep mobile as one vertical flow. Use existing tokens and continuous-corner geometry. Preserve the
unrelated `theme.css` diff and edit only Home-specific selectors.

- [ ] **Step 5: Run targeted tests and a production build.**

```bash
cd frontend
npm test -- src/test/App.test.tsx --no-file-parallelism
npm run build
```

- [ ] **Step 6: Commit the Home migration.**

```bash
git add frontend/src/Home.tsx frontend/src/App.tsx frontend/src/test/App.test.tsx
git add -p frontend/src/theme.css
git commit -m "feat(home): surface the live planning state" -m "Turn Home into a focused Now, Next, Today, and risk view without duplicating the underlying tasks and events."
```

### Task 5B: Add verified local rescheduling

**Files:**

- Modify: `cooper/brain.py`
- Modify: `cooper/app.py`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/Home.tsx`
- Test: `tests/test_cooper.py`
- Test: `tests/test_api.py`
- Test: `frontend/src/test/App.test.tsx`

**Gate:** Start only after Release 1 proves the existing create and schedule receipts against real
mixed-source calendars.

- [ ] **Step 1: Add failing parser and validation tests.**

Cover an exact-time local move, an ambiguous target, invalid or past times, missing duration, and a
request targeting an external event.

- [ ] **Step 2: Add failing API persistence tests.**

Prove that a local move changes database state, records undo, appears at the same time in the fresh
snapshot, and returns the read-only boundary for provider items.

- [ ] **Step 3: Implement one validated reschedule path.**

Use the existing `Action` validation, `find()` ambiguity behavior, owner checks, undo record, and
`app.py` transaction. Extend `ItemIn` only if the direct edit endpoint also needs exact start/end.
Do not add drag-and-drop or provider write-back.

- [ ] **Step 4: Wire Home and Ask to the same receipt.**

Both surfaces must render the actual committed start and end from the refreshed snapshot.

- [ ] **Step 5: Run focused backend and frontend tests.**

```bash
uv run pytest tests/test_cooper.py tests/test_api.py -k "move or reschedul or owner or external" -q
cd frontend
npm test -- src/test/App.test.tsx --no-file-parallelism
```

- [ ] **Step 6: Commit local rescheduling.**

```bash
git add cooper/brain.py cooper/app.py frontend/src/types.ts frontend/src/api.ts frontend/src/Home.tsx tests/test_cooper.py tests/test_api.py frontend/src/test/App.test.tsx
git commit -m "feat(planning): reschedule local work truthfully" -m "Move COOPER-owned commitments through the existing validated writer and report only the timing found in committed state."
```

## Task 6: Ground Ask Mode in explicit planning intents

**Files:**

- Modify: `cooper/brain.py`
- Modify: `cooper/app.py`
- Modify: `cooper/mcp.py`
- Test: `tests/test_cooper.py`
- Test: `tests/test_api.py`

**Interfaces:**

- Add a bounded `AskIntent` vocabulary.
- Accept an optional intent on AI `/api/say` requests; reject unknown values.
- Map common typed questions to the same intents before invoking Gemini.
- Produce deterministic answers from snapshot facts for common product queries.
- Give long-tail Gemini/tool answers only redacted snapshot facts.

- [ ] **Step 1: Add failing intent-classification tests.**

Cover the approved suggested prompts and natural variants. Ensure imperative create/modify requests
remain mutation actions rather than being swallowed as questions.

- [ ] **Step 2: Add failing deterministic-answer API tests.**

Assert that:

- focus answers name actual local work and cite structured reasons;
- remaining-today answers include external commitments;
- fit-duration answers use real free blocks;
- overload and deadline answers expose risk and incompleteness;
- empty data produces a factual empty answer, not generic advice.

- [ ] **Step 3: Add prompt-leakage tests before implementation.**

Capture all Gemini/tool prompts and assert they exclude external titles, descriptions, attendees,
email addresses, locations, and provider metadata not explicitly approved. Keep the current user-own
title sanitization tests.

- [ ] **Step 4: Implement bounded intent handling.**

Use snapshot facts for calculations. Deterministic server rendering may include external titles.
Long-tail model context uses opaque labels, time ranges, safe source types, conflict state, and
health only.

- [ ] **Step 5: Tighten tool behavior.**

Make read tools return the same snapshot-derived availability and plan facts. Do not let the model
choose whether a curated question should consult current state; the server already knows it must.

- [ ] **Step 6: Run the focused privacy and Ask tests.**

```bash
uv run pytest tests/test_cooper.py tests/test_api.py -k "ask or answer or intent or prompt or privacy" -q
```

- [ ] **Step 7: Commit grounded Ask behavior.**

```bash
git add cooper/brain.py cooper/app.py cooper/mcp.py tests/test_cooper.py tests/test_api.py
git commit -m "feat(ai): ground Ask in the planning snapshot" -m "Resolve common planning questions deterministically and keep provider contents outside model prompts while preserving useful calendar awareness."
```

## Task 7: Add verified creation and scheduling receipts

**Files:**

- Modify: `cooper/app.py`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api.ts`
- Test: `tests/test_api.py`

**Interfaces:**

- Add a structured `MutationReceipt` to successful write replies.
- Build receipt messages from the committed item found in a fresh snapshot.
- Cover the existing add, batch-add, manual-create, schedule-one, and schedule-all write paths.

- [ ] **Step 1: Add failing receipt contract tests.**

Assert a stable receipt shape for a local add, manually created item, and scheduled task. The receipt
must identify the operation, committed item, resulting state, actual timing, warnings, and snapshot
generation time.

- [ ] **Step 2: Add failing API persistence tests.**

Prove that:

- a successful add receipt references the committed item;
- a scheduling adjustment reports requested and actual time;
- an incomplete provider capture remains unscheduled with a reason;
- simulated post-commit verification failure returns no success language.

The last case must describe the outcome as unverified and instruct the user to refresh before
retrying; it must not claim the already-committed write rolled back.

- [ ] **Step 3: Implement one receipt builder after existing write paths.**

Use the existing `Action` validation, owner checks, undo records, and transactions. Do not add a
second mutation path for AI and do not add rescheduling in Release 1.

- [ ] **Step 4: Rebuild and verify the snapshot after commit.**

The receipt must be derived from the refreshed snapshot, not from request parameters or model text.
If the item cannot be verified, raise an explicit server error.

- [ ] **Step 5: Add TypeScript receipt types and preserve API error language.**

Do not optimistically show “added” or “scheduled.” Existing uncertain-network copy must
continue telling the user to refresh before retrying.

- [ ] **Step 6: Run mutation and ownership tests.**

```bash
uv run pytest tests/test_api.py -k "receipt or add or schedule or owner" -q
```

- [ ] **Step 7: Commit truthful mutations.**

```bash
git add cooper/app.py frontend/src/types.ts frontend/src/api.ts tests/test_api.py
git commit -m "feat(ai): verify planning mutations before replying" -m "Generate creation and scheduling confirmations only from committed state while keeping uncertain outcomes explicit."
```

## Task 8: Replace prompt examples with typed product actions

**Files:**

- Modify: `frontend/src/Chat.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/types.ts`
- Test: `frontend/src/test/App.test.tsx`

**Interfaces:**

- Represent each suggested prompt as `{ label, intent }`.
- Send the intent to `/api/say` while rendering the natural-language label in the conversation.
- Render snapshot facts, provider warnings, and mutation receipts without inventing a second answer.

- [ ] **Step 1: Add failing suggested-prompt tests.**

Click each Ask suggestion and assert the expected intent is sent. Confirm Manual suggestions remain
plain capture/form behavior and never include an AI intent.

- [ ] **Step 2: Update the Chat callback contract.**

Change `onExample` to receive the typed example. Keep keyboard submission for free text unchanged.

- [ ] **Step 3: Update Ask progress states.**

Use actual request state rather than timers as the authority. The existing sequential trace may
remain as presentation, but it must end in provider warnings or a verified saved result when those
occur.

- [ ] **Step 4: Render receipts and facts.**

Use the backend answer as the primary prose. Show compact supporting facts and warnings; do not
compose another “Start with …” answer from `view.shortlist` in `App.tsx`.

- [ ] **Step 5: Run targeted frontend tests.**

```bash
cd frontend
npm test -- src/test/App.test.tsx --no-file-parallelism
```

- [ ] **Step 6: Commit typed Ask prompts.**

```bash
git add frontend/src/Chat.tsx frontend/src/App.tsx frontend/src/api.ts frontend/src/types.ts frontend/src/test/App.test.tsx
git commit -m "fix(ai): make suggested questions data-aware" -m "Send bounded planning intents and render backend-grounded answers instead of treating product prompts as generic chatbot text."
```

## Task 9: Remove the duplicate calendar interpretation

**Files:**

- Modify: `cooper/app.py`
- Modify: `frontend/src/types.ts`
- Modify or delete: `frontend/src/calendar-data.ts`
- Modify: `frontend/src/Home.tsx`
- Modify: `frontend/src/Calendar.tsx`
- Modify: `frontend/src/App.tsx`
- Test: `tests/test_api.py`
- Test: `frontend/src/test/App.test.tsx`

**Interfaces:**

- Remove legacy `shortlist`, `scheduled`, and `events` only after all consumers use `planning`.
- Remove browser-side merging, count calculation, and conflict calculation.
- Retain pure formatting helpers only where they still reduce duplication.

- [ ] **Step 1: Search all legacy consumers.**

```bash
rg -n "view\.(shortlist|scheduled|events)|calendarEntries\(" frontend/src tests cooper
```

Expected before cleanup: only migration-era backend assertions and known frontend consumers.

- [ ] **Step 2: Migrate or delete every remaining consumer.**

Do not leave fallback calculations that silently diverge when `planning` exists.

- [ ] **Step 3: Remove legacy API fields and update fixtures.**

Keep connection settings, Gmail health, hours, and undo metadata outside `planning` where they are
not planning facts.

- [ ] **Step 4: Run backend and frontend suites.**

```bash
uv run pytest
cd frontend
npm test -- --no-file-parallelism
```

- [ ] **Step 5: Commit the completed migration.**

```bash
git add cooper/app.py frontend/src/types.ts frontend/src/calendar-data.ts frontend/src/Home.tsx frontend/src/Calendar.tsx frontend/src/App.tsx tests/test_api.py frontend/src/test/App.test.tsx
git commit -m "refactor(planning): remove duplicate schedule calculations" -m "Finish the snapshot migration so the backend is the only place that defines commitments, counts, conflicts, and current planning state."
```

## Task 10: Documentation, visual QA, and release verification

**Files:**

- Modify: `PRD.md`
- Modify: `ARCHITECTURE.md`
- Modify: `docs/DESIGN.md`
- Modify conditionally: `docs/LIVE_PROVIDER_ACCEPTANCE.md`
- Read: `docs/superpowers/specs/2026-09-20-unified-planning-system-design.md`

**Interfaces:**

- Document the snapshot boundary, privacy-safe Ask path, receipt semantics, derived task states, and
  external-provider count behavior.
- Update live provider acceptance only after real connected-account checks; never claim mocked tests
  are live acceptance.

- [ ] **Step 1: Synchronize canonical documentation.**

Keep the PRD product-level and the architecture document implementation-level. Record non-goals so
future work does not drift into provider write-back or a synced ledger.

- [ ] **Step 2: Run secret-safe provider preflight.**

```bash
uv run python scripts/live_provider_preflight.py
```

Record only configuration/health outcomes. Never record account names, event titles, credentials,
tokens, message IDs, or `.env` values.

- [ ] **Step 3: Run the complete backend quality gate.**

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

- [ ] **Step 4: Run the complete frontend quality gate.**

```bash
cd frontend
npm test -- --no-file-parallelism
npm run format:check
npm run build
```

- [ ] **Step 5: Run repository hygiene checks.**

```bash
cd ..
git diff --check
git status --short
```

- [ ] **Step 6: Visually inspect the running application.**

Verify signed-in desktop and mobile behavior for:

- initial loading;
- no connected providers;
- mixed local/Google/iCloud day;
- duplicate provider event;
- incomplete provider;
- Now and Next selection;
- at-risk work;
- Ask suggested prompts;
- add and move receipts;
- external read-only mutation attempt;
- sidebar expanded and collapsed calendar counts;
- light and dark themes.

- [ ] **Step 7: Perform live provider acceptance when credentials are available.**

Confirm real Google and iCloud events affect counts, availability, Home, and Ask. Update
`docs/LIVE_PROVIDER_ACCEPTANCE.md` only for behavior actually observed with connected accounts.

- [ ] **Step 8: Inspect the exact release diff.**

Check that the work adds no table, dependency, provider write scope, background process, or external
content to model prompts. Confirm unrelated pre-existing worktree changes are not accidentally
included.

- [ ] **Step 9: Commit documentation separately.**

```bash
git add PRD.md ARCHITECTURE.md docs/DESIGN.md docs/LIVE_PROVIDER_ACCEPTANCE.md docs/superpowers/specs/2026-09-20-unified-planning-system-design.md docs/superpowers/plans/2026-09-20-unified-planning-system.md
git commit -m "docs(planning): define COOPER's unified source of truth" -m "Document the shared planning snapshot, grounded Ask behavior, provider privacy boundary, and evidence required before release."
```

Do not push until the user explicitly requests release or the active task already includes a push.

## GStack CEO review synthesis

### What already exists

- `cooper/app.py::today_view()` already fetches local work and provider events, but exposes them as
  separate collections.
- `cooper/sources.py::busy_windows()` already protects placement from Google, iCloud, Gmail, and
  local busy intervals.
- `cooper/planner.py` already ranks and places tasks deterministically.
- `cooper/brain.py` already validates `Action` values and sanitizes model-bound user text.
- `cooper/app.py::run()` already keeps mutations in the sole database-writer boundary.
- `frontend/src/calendar-data.ts` already demonstrates the frontend's desired mixed-source display,
  but must stop being an independent source of planning truth.
- Existing API tests already prove local AI adds persist and external provider contents stay out of
  model prompts.

The plan extends these boundaries instead of replacing them.

### Not in scope

- Persisted external-event ledger: unproven operational cost and a new table.
- Provider write-back: contradicts the current read-only provider contract.
- Fuzzy event matching: risks hiding distinct commitments.
- Snooze workflow: requires real persisted semantics, not a renamed deadline.
- Projects, assignments, permissions, and reporting: do not serve the seven PRD requirements.
- New queue, watcher, cache, or analytics stack: measure the existing request path first.
- AI reranking: deterministic ranking must remain explainable.

### Dream-state delta

This plan reaches a trustworthy single-owner planning workspace: all surfaces agree, common Ask
questions are grounded, provider time affects decisions, and writes are verified. It does not prove
multi-user demand, automatic provider write-back, or a general autonomous planning agent. Those are
future product decisions, not hidden requirements of this delivery.

### System architecture

```text
authenticated request
        |
        v
     app.py ------------------------------------------------------+
        |                                                         |
        +--> Store: owner-scoped local Items                       |
        +--> Google/iCloud/Gmail: read-only provider records       |
        |                                                         |
        v                                                         |
 sources.py: normalize -> explicit links -> exact dedup -> health |
        |                                                         |
        v                                                         |
 planner.py: states -> rank -> conflicts -> free blocks -> metrics|
        |                                                         |
        v                                                         |
 planning snapshot                                                |
   |             |              |              |                  |
   v             v              v              v                  |
 Calendar       Home            Ask          badges               |
                                  |                               |
                                  +-- mutation intent ------------+
                                      validate -> commit -> rebuild
                                                     |
                                                     v
                                              verified receipt
```

### Snapshot data flow and shadow paths

```text
INPUT --------> VALIDATE -------> NORMALIZE -------> PROJECT -------> OUTPUT
local/provider  owner + shape     UTC + identity     snapshot         consumers
    |               |                  |                 |                |
    + no provider -> local-only, complete for configured sources --------+
    + empty source -> valid empty collection, count zero ----------------+
    + bad record --> reject that malformed record with source warning ---+
    + provider error --------------------------------> incomplete snapshot
    + duplicate ----------------> alias one commitment, count once -------+
```

Disconnected is not failure. A connected source that cannot be read makes the snapshot incomplete.
Only availability-dependent decisions block; safe local inspection and mutation continue with a
warning.

### Task-state machine

```text
                         scheduled block begins
NOT STARTED ----schedule--------------------------> IN PROGRESS
    |                 |                                  |
    |                 + future ----------------> SCHEDULED
    |                                                    |
    + provider unknown -------------------------> BLOCKED|
    |                                                    |
    + deadline passes --------------------------> OVERDUE|
                                                         |
scheduled block passes without completion ----> MISSED BLOCK

any active state --complete--> COMPLETED
any active state --drop------> DROPPED
```

Derived state never creates an invalid persisted transition. The database continues storing only
`open`, `done`, or `dropped`; timing, deadline, and provider health produce the richer projection.

### Error and rescue registry

| Method or path           | Failure                                                  | Rescue                                                            | User sees                                      |
| ------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| Provider fetch           | `CalendarError`, timeout, invalid credential             | Preserve local data, mark source unavailable                      | Incomplete schedule warning                    |
| Event normalization      | malformed time or missing identity                       | Reject record, mark affected source incomplete                    | Provider data may be incomplete                |
| Snapshot projection      | invalid timezone or interval                             | Fail request with explicit server error; never guess              | Could not load planning state                  |
| Gemini intent/answer     | malformed JSON, empty response, refusal, transport error | Use validated rules or deterministic intent answer when available | Factual fallback or clear unavailable response |
| Database mutation        | validation, ambiguity, ownership, integrity error        | Existing 409/422 boundary; transaction rollback                   | Specific correction request                    |
| Post-commit verification | affected item absent from fresh snapshot                 | Mark outcome unverified; instruct refresh before retry            | No success claim                               |
| Frontend request         | network failure after POST                               | Keep uncertain-state copy                                         | Refresh before retrying                        |
| Partial frontend load    | snapshot absent or stale response epoch                  | Keep structural loading state; discard stale auth epoch           | Loading or current signed-in state             |

No error path may log a token, prompt, external title, email body, message ID, attendee, address, or
location.

### Failure modes registry

| Code path          | Failure mode                           | Rescued?                            | Test?                | User sees                           | Logged?                  |
| ------------------ | -------------------------------------- | ----------------------------------- | -------------------- | ----------------------------------- | ------------------------ |
| Mixed-source count | aliases counted twice                  | Yes                                 | Pure + API + UI      | Correct count                       | Aggregate only           |
| Deduplication      | two real events share a title          | Yes, exact time/type still required | Pure                 | Both remain visible                 | No content               |
| Availability       | provider unavailable                   | Yes                                 | API                  | Incomplete warning; no invented fit | Source/status only       |
| Ask intent         | generic model answer bypasses snapshot | Yes, curated intents deterministic  | API                  | Specific factual answer             | Intent type only         |
| AI privacy         | external content enters prompt         | Yes, captured-prompt assertion      | API                  | No visible leak                     | Never content            |
| Mutation           | model claims an unsaved change         | Yes, receipt after commit           | Persistence/API      | Verified result only                | Operation/status only    |
| Post-commit check  | committed write cannot be verified     | Yes                                 | API                  | Outcome unknown; refresh            | Request correlation only |
| UI migration       | old frontend meets new backend         | Yes, compatibility window           | Build + hosted smoke | No broken workspace                 | Deployment health        |
| Home rendering     | same task appears in several sections  | Yes, stable reference IDs           | UI                   | One rendered item                   | No content               |

No row is unrescued, untested, silent, and unlogged.

### Deployment sequence

```text
Release 1A: additive backend snapshot + legacy fields
        |
        v
Release 1B: Calendar, badges, Ask, and receipts consume snapshot
        |
        v
7-day trust gate with real mixed-source schedule
        |
        +-- fails --> fix snapshot/receipt; do not start Home
        |
        v
Release 2: Home command center + local rescheduling
        |
        v
hosted frontend verified on snapshot contract
        |
        v
Release 3: remove legacy API fields and browser reconstruction
```

### Rollback flow

```text
snapshot/backend regression?
  -> revert additive backend commit; legacy frontend remains compatible

snapshot frontend regression?
  -> revert frontend commit; additive backend still serves legacy fields

Home/reschedule regression?
  -> revert Release 2 commits; trusted Release 1 loop remains

legacy-field removal regression?
  -> restore fields from prior commit; no database rollback required
```

### Review findings by section

1. **Architecture:** one issue resolved by keeping normalization, calculation, orchestration, and
   rendering in separate existing modules.
2. **Errors:** post-commit uncertainty and partial-provider behavior are explicitly mapped.
3. **Security:** no new secret, dependency, table, provider scope, or external model content.
4. **Data and interaction:** nil, empty, duplicate, partial, stale response, and retry paths are
   covered by the plan.
5. **Code quality:** the main risk is a monolithic snapshot builder; module boundaries prevent it.
6. **Tests:** pure logic, API integration, frontend behavior, privacy capture, and live acceptance
   are separated.
7. **Performance:** provider I/O is the first likely bottleneck; each source is fetched once per
   snapshot and caching is deferred until measured.
8. **Observability:** source health and privacy-safe operation/status context are sufficient for the
   current single-owner scale; no dashboard stack is added.
9. **Deployment:** the two-release compatibility window resolves independent frontend/backend
   deployment risk.
10. **Trajectory:** reversibility is 5/5 because there is no schema or provider-write migration.
11. **Design:** the information hierarchy, mobile flow, loading, empty, success, error, and partial
    states are specified; a rendered design review remains required after implementation.

### Implementation tasks

The ten task sections above are the executable task list. P1 release blockers are Tasks 1–4 and
6–8. Task 5 and Task 5B are gated on real-use trust evidence. Task 9 must ship separately from the
additive API release. Task 10 is the release gate.

## Final release acceptance matrix

Before declaring the implementation complete, attach evidence for every row:

| Requirement                       | Automated evidence                   | Manual evidence                             |
| --------------------------------- | ------------------------------------ | ------------------------------------------- |
| Unified mixed-source count        | API and frontend tests               | Calendar and badge inspection               |
| Conservative deduplication        | Pure and API tests                   | One known cross-provider duplicate          |
| Provider-aware availability       | Planner/API tests                    | Connected calendar scheduling check         |
| Incomplete-provider safety        | API tests                            | Disconnect or induced provider failure      |
| Grounded suggested prompts        | API/frontend tests                   | Ask responses against visible state         |
| Priority affects behavior         | Planner tests                        | Home ordering inspection                    |
| Derived task states               | Planner/API tests                    | Scheduled, active, missed, overdue examples |
| Home command center               | Frontend tests                       | Desktop and mobile inspection               |
| Truthful mutation receipts        | Persistence/API tests                | Create and move through Ask                 |
| External records remain read-only | API tests                            | Attempted external move                     |
| Model privacy boundary            | Captured-prompt tests                | No secrets or provider contents in logs     |
| Offline/local operation           | API/frontend tests                   | No Gemini and no provider smoke test        |
| Full quality gate                 | pytest, Ruff, Vitest, Prettier, Vite | Running application inspection              |

## GSTACK REVIEW REPORT

| Review        | Trigger               | Why                               | Runs | Status  | Findings                                                                               |
| ------------- | --------------------- | --------------------------------- | ---- | ------- | -------------------------------------------------------------------------------------- |
| CEO Review    | `/plan-ceo-review`    | Scope and strategy                | 1    | CLEAR   | 3 approaches considered, shared snapshot accepted, ledger and surface patches rejected |
| Codex Review  | `/codex review`       | Independent second opinion        | 0    | SKIPPED | Running under Codex; nested Codex review intentionally skipped                         |
| Eng Review    | `/plan-eng-review`    | Architecture and tests (required) | 0    | NOT RUN | Required before implementation begins                                                  |
| Design Review | `/plan-design-review` | UI and UX gaps                    | 0    | NOT RUN | Recommended before the Home release                                                    |
| DX Review     | `/plan-devex-review`  | Developer experience gaps         | 0    | NOT RUN | Not required for this product change                                                   |

**VERDICT:** CEO REVIEW CLEAR. Founder sequence approved. Engineering review required before
implementation; design review required before Release 2 Home work.

NO UNRESOLVED DECISIONS
