# Cadence Phases 0–2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` task-by-task. Every production behavior follows red-green TDD. Every meaningful feature or fix gets its own Conventional Commit; never stage the whole untracked tree.

**Goal:** Deliver a secure localhost Cadence app with manual task/calendar foundation, natural-language capture, deterministic prioritization, and a faithful four-view frontend shell.

**Architecture:** Pure domain functions and Protocols live in `cadence/core`; orchestration lives in `cadence/services`; SQLAlchemy, Gemini, Google Calendar, and parser implementations live in `cadence/adapters`; FastAPI routers remain thin. React consumes Phase 0–2 APIs while Windows and Activity remain clearly labeled previews until the Phase 2 kill gate passes.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Alembic, Pydantic Settings, pytest, Hypothesis, Ruff, mypy, import-linter; React, TypeScript, Vite, Vitest, Testing Library, Lucide. Preserve exact versions already pinned in `pyproject.toml`, `uv.lock`, `frontend/package.json`, and `frontend/package-lock.json`.

**Spec:** `docs/superpowers/specs/2026-08-29-ai-calendar-agent-design.md`

## Global Constraints

- Implement only PRD Phases 0–2. Do not implement scheduling, focus-window placement, calendar write projection, general batch undo, reranking, or background reconciliation.
- The Phase 3–5 Windows and Activity views may exist only as honest visual previews with fixture content and explicit “available after the Phase 2 trial” copy.
- Bind `127.0.0.1` only. Exact-origin CORS, Host allowlist, and a non-empty shared-secret header are mandatory.
- `CADENCE_SHARED_SECRET` must be at least 32 characters; startup fails otherwise.
- `core` imports no SQLAlchemy, FastAPI, Pydantic, vendor SDK, `services`, `adapters`, or `api`.
- The intent compiler sees only text typed by the user. Calendar text never enters its prompt.
- At most two model calls per utterance: initial generation and one repair. Rule parsing and clarification use zero model calls.
- Ranking makes zero model calls and matches the exact formula in spec section 9.
- Model IDs come from environment settings, never literals in production code.
- No confirmation modal on capture. Correction uses parsed-chip edit and task-local undo.
- Every dependency remains exact-pinned and has a reason in the commit body or `docs/CONVENTIONS.md`.
- Meaningful changes use Conventional Commits such as `fix(security): reject weak shared secrets`, `feat(tasks): add task CRUD service`, and `feat(ui): build Today prioritization view`.

## Task dependency table

| Task | Produces | Consumed by |
| --- | --- | --- |
| 1 | Green toolchain, secure app shell, CI gates | Every later task |
| 2 | Enforced schema and repository session | Tasks 3–7 |
| 3 | Task domain, repository Protocol, CRUD service/API | Tasks 5–9 |
| 4 | OAuth credential boundary and scrubbed calendar read | Task 9 status UI |
| 5 | Intent vocabulary, providers, bounded compiler | Task 6 |
| 6 | Capture execution, deterministic disambiguation, parsed result/undo | Task 9 |
| 7 | Scoring, candidate selection, pinning, Today/Backlog APIs | Task 9 |
| 8 | Faithful four-view frontend system and assets | Task 9 |
| 9 | Phase 0–2 frontend/API integration | Task 10 |
| 10 | Full gates, docs, independent review | Delivery |

---

### Task 1: Recover the toolchain and localhost security boundary

**Files:**
- Modify: `pyproject.toml`, `.importlinter`, `cadence/config.py`, `cadence/main.py`, `cadence/api/security.py`
- Modify: `frontend/vite.config.ts`, `frontend/tsconfig*.json`, `frontend/src/App.test.tsx`
- Create: `.github/workflows/ci.yml`
- Test: `tests/test_config.py`, `tests/api/test_health.py`, `frontend/src/api.test.ts`

**Interfaces:**
- Produces `Settings` with `shared_secret: SecretStr`, minimum length 32; `create_app(settings: Settings) -> FastAPI`; frontend `apiRequest<T>(path, init?)` adding `X-Cadence-Secret`.

- [ ] Run existing backend and frontend tests and record the expected failures: import path, weak secret acceptance, missing API client, and invalid TypeScript config.
- [ ] Make `cadence` importable under `uv run pytest` without modifying `sys.path` inside tests.
- [ ] Add a Pydantic validator proving `Settings(shared_secret="")` and a 31-character value fail while 32 characters pass.
- [ ] Ensure missing/incorrect secret returns 403, unknown Origin is rejected, unexpected Host is rejected, and `/health` returns 200 only through the allowed boundary.
- [ ] Implement `frontend/src/api.ts`; test exact header injection and non-2xx error propagation.
- [ ] Add CI jobs running all backend gates and frontend tests/build.
- [ ] Run targeted tests, then Ruff, format check, mypy, import-linter, frontend tests/build.
- [ ] Stage only Task 1 files and commit `fix(foundation): restore secure green toolchain`.

### Task 2: Enforce the Phase 0 schema

**Files:**
- Modify: `cadence/adapters/models.py`, `migrations/versions/0001_create_section_6_schema.py`
- Test: `tests/adapters/test_migrations.py`, `tests/adapters/test_models.py`

**Interfaces:**
- Produces all spec section 6 tables with database-level checks for `task.status`, `scheduled_block.state`, `mutation_log.actor`, `ai_decision.kind`, and `outbox.state`.

- [ ] Run migration tests and confirm invalid enum values fail because constraints are absent.
- [ ] Add matching named `CheckConstraint`s to ORM metadata and migration.
- [ ] Upgrade a fresh temporary SQLite database and assert all tables/columns exist.
- [ ] Insert each invalid enum value and assert `IntegrityError`; insert every valid value and assert success.
- [ ] Run migration/model tests, Ruff, mypy, and import-linter.
- [ ] Commit `fix(db): enforce domain state constraints`.

### Task 3: Build task CRUD through clean boundaries

**Files:**
- Create: `cadence/core/tasks.py`, `cadence/core/protocols.py`, `cadence/services/task_service.py`, `cadence/adapters/task_repository.py`, `cadence/api/routes_tasks.py`
- Modify: `cadence/main.py`
- Test: `tests/core/test_tasks.py`, `tests/services/test_task_service.py`, `tests/api/test_tasks.py`

**Interfaces:**
- `TaskStatus = Literal["active", "done", "dropped"]`
- `TaskDraft(title, notes, effort_minutes, importance, deadline, earliest_start, tags, allow_split)`
- `TaskRepository.add/get/list/update` and `TaskService.create/update/complete/drop/list`.
- HTTP: `POST /api/tasks`, `GET /api/tasks`, `PATCH /api/tasks/{id}`, `POST /api/tasks/{id}/complete`, `POST /api/tasks/{id}/drop`.

- [ ] Write pure validation tests: trimmed non-empty title, importance 1–5, positive optional effort, and timezone-aware optional datetimes.
- [ ] Run them RED because domain types do not exist.
- [ ] Implement frozen domain value objects and repository Protocol with no framework imports.
- [ ] Write service tests against a small in-memory fake, run RED, then implement lifecycle methods.
- [ ] Write API tests against temporary SQLite, run RED, then add thin routes and repository adapter.
- [ ] Run task/core/service/API tests plus all backend gates.
- [ ] Commit domain/service separately as `feat(tasks): add task lifecycle service`, then adapter/API as `feat(api): expose task CRUD endpoints`.

### Task 4: Add OAuth credential storage and scrubbed calendar read

**Files:**
- Create: `cadence/core/calendar.py`, `cadence/adapters/token_cipher.py`, `cadence/adapters/google_calendar.py`, `cadence/services/calendar_service.py`, `cadence/api/routes_auth.py`, `cadence/api/routes_calendar.py`
- Modify: `cadence/config.py`, `cadence/main.py`, schema/migration only if the frozen schema has no credential location
- Test: `tests/adapters/test_token_cipher.py`, `tests/adapters/test_google_calendar.py`, `tests/services/test_calendar_service.py`, `tests/api/test_auth.py`

**Interfaces:**
- OAuth scope exactly `https://www.googleapis.com/auth/calendar.events`.
- `CalendarClient.list_events(sync_token: str | None) -> CalendarPage`.
- Scrubbed `CalendarEvent` contains ID, calendar ID, title, start/end UTC, ownership flag, attendee-presence boolean, updated time; never descriptions, locations, links, or attendee addresses.

- [ ] Test encrypted refresh-token round trip and assert plaintext never appears in storage/log output.
- [ ] Test the calendar adapter allowlist against a vendor response containing every forbidden field.
- [ ] Test token-health states and `410 Gone` full-read fallback without implementing Phase 3 polling jobs.
- [ ] Implement authorization URL/callback boundary and status endpoints; do not contact Google in tests.
- [ ] Run targeted tests and backend gates.
- [ ] Commit `feat(auth): add encrypted Google OAuth boundary`, then `feat(calendar): cache scrubbed busy events`.

### Task 5: Define intents and bounded providers

**Files:**
- Create: `cadence/core/intents.py`, `cadence/core/intent_context.py`, `cadence/adapters/rule_provider.py`, `cadence/adapters/gemini_provider.py`, `cadence/adapters/intent_compiler.py`
- Modify: `cadence/core/protocols.py`, `cadence/config.py`
- Test: `tests/core/test_intents.py`, `tests/adapters/test_rule_provider.py`, `tests/adapters/test_intent_compiler.py`, `tests/fixtures/intents.jsonl`

**Interfaces:**
- Phase 0–2 intents: `CreateTask`, `UpdateTask`, `CompleteTask`, `DropTask`, `PinTask`, `CreateEvent`, `Query`, `Undo`, `Clarify`.
- `LLMProvider.compile_intent(utterance: str, context: IntentContext) -> Intent`.
- `BoundedIntentCompiler.compile` invokes model at most twice, then rule provider, then returns `Clarify`.

- [ ] Add golden fixtures for task creation, fixed event parsing, completion, query, and ambiguous reference.
- [ ] Run rule-provider tests RED, then implement common patterns with deterministic date handling.
- [ ] Test compiler call counts: valid first response = 1; repaired response = 2; two failures = 2 plus rule fallback; never 3.
- [ ] Implement Gemini structured-output adapter behind the Protocol. Model IDs must come only from settings. Tests use a deterministic transport fake, not the live service.
- [ ] Assert compiler context has no field capable of carrying calendar event text.
- [ ] Run targeted tests and backend gates.
- [ ] Commit `feat(capture): add bounded intent compiler`.

### Task 6: Execute capture with deterministic correction

**Files:**
- Create: `cadence/core/disambiguation.py`, `cadence/services/intent_executor.py`, `cadence/api/routes_capture.py`
- Modify: `cadence/services/task_service.py`, `cadence/adapters/task_repository.py`, `cadence/main.py`
- Test: `tests/core/test_disambiguation.py`, `tests/services/test_intent_executor.py`, `tests/api/test_capture.py`

**Interfaces:**
- `POST /api/capture` returns `{intent, parsed_chip, mutation_id}` or `{intent: "clarify", question, candidates}`.
- `POST /api/capture/{mutation_id}/undo` supports only Phase 1 task-local correction. It does not expose general batch undo.

- [ ] Test exact-match resolution, one above-threshold match, no match, and near tie. Confidence from provider output is never read.
- [ ] Test capture applies one task mutation atomically and writes its before/after mutation row.
- [ ] Test correction undo restores the prior task state and is idempotent.
- [ ] Persist `CreateEvent` as a validated capture result only; do not write Google Calendar or claim projection before Phase 3.
- [ ] Add thin capture routes and run targeted tests plus backend gates.
- [ ] Commit `feat(capture): execute validated task intents`, then `feat(capture): add parsed-result correction`.

### Task 7: Implement deterministic prioritization

**Files:**
- Create: `cadence/core/scoring.py`, `cadence/core/candidates.py`, `cadence/services/plan_service.py`, `cadence/api/routes_plan.py`
- Modify: `cadence/config.py`, `cadence/main.py`
- Test: `tests/core/test_scoring.py`, `tests/core/test_candidates.py`, `tests/services/test_plan_service.py`, `tests/api/test_plan.py`

**Interfaces:**
- `ScoreBreakdown(deadline_pressure, importance, slip_pressure, unblocks, age, total)`.
- `score_task(task, now, weights) -> ScoreBreakdown` uses the exact formula from spec section 9.
- `GET /api/plan/today`; `GET /api/plan/backlog`; `PUT /api/tasks/{id}/pin`.

- [ ] Test each normalized term at boundaries and monotonicity.
- [ ] Test exact composite totals and deterministic tie ordering by creation time then ID.
- [ ] Test blocked tasks are excluded, earliest-start filtering works, and today-pinned tasks bypass score order.
- [ ] Use a provider fake that raises on every call and prove ranking still succeeds.
- [ ] Implement service/routes, run targeted tests and backend gates.
- [ ] Commit `feat(priority): rank actionable tasks deterministically`.

### Task 8: Build the Cadence visual system and four-view shell

**Files:**
- Create/modify focused files under `frontend/src/components/`, `frontend/src/views/`, `frontend/src/styles/`, and `frontend/src/types.ts`
- Modify: `frontend/src/App.tsx`, `frontend/src/App.css`
- Test: colocated `*.test.tsx` files

**Interfaces:**
- Shared components: `Sidebar`, `CaptureBar`, `ParsedChip`, `StatusPanel`, `MascotState`, `ScoreBreakdown`.
- Views: `TodayView`, `BacklogView`, `WindowsPreview`, `ActivityPreview`, `StateGallery`.

- [ ] Write navigation/accessibility tests before splitting the shell.
- [ ] Build warm cream editorial layout matching the supplied reference: narrow sidebar, dense data surfaces, restrained forest-green schedule accent, no gradients/glass/chat transcript.
- [ ] Use actual files declared in `frontend/public/assets/manifest.json`; if an asset is absent, render a layout-safe neutral placeholder and report it.
- [ ] Implement persistent capture bar and parsed-chip focus/edit/undo interaction tests.
- [ ] Build Today shortlist, score disclosure, timeline, Backlog table/blocked group, and all five state previews.
- [ ] Label Windows/Activity as post-trial previews; controls that would mutate Phase 3 state remain disabled with explanatory text.
- [ ] Verify semantic landmarks, labels, visible focus, reduced motion, and 1024px desktop layout.
- [ ] Run frontend tests and production build.
- [ ] Commit by meaningful surface: `feat(ui): establish Cadence application shell`, `feat(ui): build Today and Backlog views`, `feat(ui): add required application states`.

### Task 9: Integrate Phase 0–2 APIs

**Files:**
- Modify: `frontend/src/api.ts`, view/component files from Task 8
- Test: `frontend/src/api.test.ts` and integration component tests

- [ ] Test loading, success, validation, clarification, and explicit API-error states before integration.
- [ ] Connect task CRUD, capture/correction, Today, Backlog, pin, complete, calendar status, and health.
- [ ] Never silently replace API errors with demo data. Fixture mode must be explicitly selected and visibly labeled.
- [ ] Ensure system status derives from real health/calendar responses rather than hardcoded “Ready”.
- [ ] Run frontend tests/build and targeted backend API tests.
- [ ] Commit `feat(ui): connect Phase 0-2 workflows`.

### Task 10: Verify, review, and document delivery

**Files:**
- Modify: `README.md`, `docs/SETUP.md`, `AGENTS.md` only where commands/status changed

- [ ] Run `uv run alembic upgrade head` against a fresh temporary database.
- [ ] Run `uv run pytest` and record count with zero failures.
- [ ] Run `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy cadence`, and `uv run lint-imports`.
- [ ] Run `npm test`, configured typecheck, and `npm run build` from `frontend/`.
- [ ] Independently review the branch against PRD Phase 0–2 acceptance criteria, all architecture invariants, supplied UI reference, asset manifest, and dependency pins.
- [ ] Fix every Critical/Important finding test-first in scoped Conventional Commits; run one focused re-review.
- [ ] Update docs with exact commands that ran, implemented scope, known limits, Gemini/OAuth setup, and the binding two-week Phase 2 kill gate.
- [ ] Commit `docs: document Phase 0-2 delivery`.

## Plan self-review

- **Spec coverage:** Phase 0 foundation/OAuth/calendar read/manual CRUD appears in Tasks 1–4; Phase 1 capture and correction in Tasks 5–6; Phase 2 deterministic priority and UI in Tasks 7–9. Phase 3–5 behavior remains excluded.
- **Placeholder scan:** No TBD, TODO, “implement later,” or undefined “appropriate handling” instructions.
- **Type consistency:** Intent, task, score, repository, provider, and HTTP interfaces are defined before consumers.
- **Recovery ruling:** Existing untracked files are input, not completed work. Each task proves and stages its own slice. Generated `*.tsbuildinfo`, emitted Vite config JS/declarations, databases, credentials, and `.env` are never staged.
- **CreateEvent ruling:** Phase 1 may parse and display a fixed-event capture result, but Google Calendar projection remains Phase 3. This preserves the frozen source-of-truth and outbox boundaries.
- **Undo ruling:** Phase 1 receives narrow task-local correction only. General batch undo and Activity history remain Phase 3.
