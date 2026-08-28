# Cadence: AI-Chat-Powered Personal Calendar and Task Manager

- **Date:** 2026-08-29
- **Status:** Approved design, ready for implementation planning
- **Scope:** Single-user personal tool. One implementation plan, delivered in six phases.

`Cadence` is the working name for the project. It is used throughout this document and in
the codebase as the package name.

## 1. Problem

Four failures compound in the author's current workflow:

1. **Capture friction.** Commitments arrive as messy natural language and never reach the
   calendar, because opening Google Calendar and filling a form costs more than the thought
   is worth in the moment.
2. **Decision paralysis.** Work is captured somewhere but nothing says which hour belongs to
   which task, so attention defaults to whatever is loudest.
3. **Plan decay.** A planned week survives until Tuesday. Manual re-planning is tedious
   enough that the plan gets abandoned rather than repaired.
4. **Fragmentation.** Tasks live in notes and memory, time lives in Google Calendar, and the
   two never reconcile.

These are not four products. They are one loop: **capture, prioritize, schedule, re-plan.**
The loop closes, which is why a single system addresses all four. It also means the system
is only useful once the whole loop runs, so phasing is mandatory rather than optional.

## 2. Goals, non-goals, and kill criterion

### Goals

- Turn one typed sentence into a correctly structured task or calendar event with no forms.
- Answer "what should I work on now" with a ranked, explainable shortlist.
- Place that shortlist into real calendar time, inside boundaries the user declared.
- Repair the plan automatically when the day drifts, and record that a task slipped.
- Keep working when the language model is unavailable.

### Non-goals

- **Not a competitor to Motion or Reclaim.ai.** Those products exist and are better resourced.
  This is built because it is private, free, and tunable by its only user. Any feature
  justified by "product X has it" is out of scope by default.
- Not multi-user. No accounts, no sharing, no permissions model.
- Not a meeting scheduler. Cadence never negotiates time with other people.
- No native mobile app, no voice input, no email or chat ingestion.
- No travel timezone handling. One configured home timezone.
- No recurring *tasks*. Recurring *focus windows* are in scope; recurring tasks are not.

### Kill criterion

After Phase 2 ships, use Cadence manually for two weeks with no further development. If the
Today view is not being opened daily by the end of that period, stop. Do not build Phase 3.
This gate exists because the expensive half of the system (scheduler, calendar writes, undo)
is worthless if the cheap half has not already earned a daily habit.

## 3. Locked decisions

| Decision | Choice |
| --- | --- |
| Surface | Web app. React frontend, FastAPI backend. |
| Source of truth | Cadence's own database. Google Calendar is a projection of it. |
| AI autonomy | Full. The AI applies changes without confirmation. Everything is undoable. |
| Autonomy carve-out | Events with other attendees are never automatically moved or deleted. |
| Prioritization | Deterministic scoring ranks candidates. The model may reorder the top 10 and must state a logged reason. |
| Model provider | Google Gemini, free tier only, behind a provider adapter. |
| Privacy | Attendee emails, locations, meeting links, and event descriptions are stripped at ingestion. |
| Scheduling boundary | The scheduler may only write inside user-declared focus windows. |
| LLM role | Intent compiler. The model emits validated intents; deterministic code executes them. |

### Why "intent compiler" and not a tool-calling agent

Three candidate architectures were considered.

An **agent loop** with `create_task` and `schedule_block` registered as callable functions
handles compound requests with less orchestration code, but costs several model round trips
per request against an unpublished free-tier quota, and hands write capability directly to a
non-deterministic component. Combined with full autonomy, one confused loop can produce a
burst of unwanted mutations.

A **batch-only planner** that plans once nightly is nearly immune to quota problems and
entirely predictable, but cannot answer "what should I do right now" with knowledge of the
last hour, which forfeits most of the value.

The **intent compiler** was chosen. The model translates one sentence into one validated
intent object and never touches the database or Google API. Deterministic services execute
intents behind a validation layer that acts as the security boundary. This costs one model
call per utterance, is testable without mocking a model, and degrades to a rule-based parser
when quota is exhausted. The nightly batch planner from the third approach is retained as a
scheduled job that calls the same services the chat path calls. From the agent-loop approach,
only a single clarification round is retained, never a free-running loop.

## 4. Product surface

**The Today view is the primary surface. Chat is an input method, not the application.**

Reading a plan by typing questions at it is slower than looking at a list already on screen.
Chat is excellent for input and poor for review, so the two roles are split:

- **Capture bar.** A single always-focused text input at the top of every view, reachable by
  keyboard shortcut. Submitting it compiles an intent, applies it, and echoes a compact
  **parsed chip** such as `Task · dentist · Thu 15:00 · 60m`. The chip has inline edit and
  undo controls.
- **Today view.** Ranked shortlist for today, each item showing its score contribution
  summary and, when the reranker moved it, the reason text. Scheduled blocks for today are
  shown alongside, with their calendar state.
- **Backlog view.** Everything unscheduled, sorted by score, filterable by tag.
- **Windows view.** Declare and edit recurring focus windows and their daily caps.
- **Activity view.** The mutation log grouped into batches, each with an undo control, plus
  the daily digest of actions the AI took unattended.

Because full autonomy removes confirmation prompts, the correction path replaces the
confirmation path. A wrong parse must cost one click to fix, which is what the parsed chip
provides. No modal ever interrupts capture.

## 5. Architecture

Four layers. Dependencies point inward only.

```
React (Vite, TypeScript)
        |
        v
FastAPI routers  ->  Application services  ->  Domain core
                              |
                              v
              Adapters: LLMProvider, GoogleCalendarClient, Repository
```

- **`cadence/core/`** is pure Python. Intent types, scoring, window expansion, placement,
  disambiguation rules. No I/O, no network, no framework imports, no ORM. Unit tested with
  zero mocks.
- **`cadence/services/`** orchestrates. `TaskService`, `PlanService`, `SyncService`,
  `UndoService`. Owns database transactions and the outbox.
- **`cadence/adapters/`** holds everything that talks to the outside world, each behind a
  `Protocol` declared in `core`. `GeminiProvider`, `RuleBasedProvider`,
  `GoogleCalendarClient`, `SqlAlchemyRepository`.
- **`cadence/api/`** is thin FastAPI routers. Request validation and serialization only.

**Layer purity is enforced in CI by an `import-linter` contract**, not by convention. `core`
may not import `services`, `adapters`, `api`, SQLAlchemy, FastAPI, or any Google or Gemini
SDK. A documented rule with no enforcement decays; a failing build does not.

### Runtime and storage

SQLite through SQLAlchemy, migrated with Alembic. One user on one machine does not need
Postgres, and the connection string is the only thing that changes if that ceases to be true.
Background work runs on APScheduler inside the FastAPI process. Celery and Redis would add
operational failure modes to buy capacity that will never be consumed.

Two provider implementations exist from the first day that the AI subsystem lands:
`GeminiProvider` and `RuleBasedProvider`. The second is required by the degraded path anyway,
and a second implementation is what proves an interface is real rather than aspirational.

## 6. Data model

- **`task`** — `id`, `title`, `notes`, `effort_minutes`, `importance` (1 to 5), `deadline`,
  `earliest_start`, `status` (`active` | `done` | `dropped`), `slip_count`, `pinned_for_date`,
  `allow_split`, `tags`, `created_at`, `completed_at`
- **`task_dependency`** — `blocker_id`, `blocked_id`
- **`focus_window`** — `id`, `weekday`, `start_local`, `end_local`, `timezone`,
  `daily_block_cap`, `active`
- **`scheduled_block`** — `id`, `task_id`, `start_utc`, `end_utc`, `google_event_id`,
  `state` (`planned` | `pushed` | `user_moved` | `orphaned` | `completed`)
- **`calendar_event_cache`** — `google_event_id`, `calendar_id`, `title`, `start_utc`,
  `end_utc`, `is_app_owned`, `has_other_attendees`, `updated_at`
- **`mutation_log`** — `id`, `batch_id`, `ts`, `actor` (`user` | `ai`), `intent_kind`,
  `entity_type`, `entity_id`, `op`, `before_json`, `after_json`, `inverse_applied_at`
- **`ai_decision`** — `id`, `ts`, `model_id`, `kind` (`parse` | `rerank`), `input_digest`,
  `output_json`, `reason_text`, `latency_ms`, `token_estimate`
- **`outbox`** — `id`, `mutation_id`, `operation`, `payload_json`, `attempts`,
  `next_attempt_at`, `state` (`pending` | `sent` | `failed`)
- **`job_run`** — `job_name`, `last_run_at`, `last_status`

Three notes on non-obvious columns.

`slip_count` is first class because plan decay is a named problem. A task pushed three times
should climb the ranking rather than quietly rot.

`calendar_event_cache` stores no descriptions, no locations, and no attendee emails. Scrubbing
happens at ingestion, not at prompt construction. The distinction matters: sensitive fields
that never enter the database cannot leak from it later, through a prompt or otherwise.

`job_run` exists because scheduled jobs are catch-up based. See section 14.

## 7. Intent vocabulary

The model's entire output space. Any response failing to validate against one of these is
not executed.

| Intent | Fields |
| --- | --- |
| `CreateTask` | title, effort_minutes?, importance?, deadline?, earliest_start?, tags[] |
| `UpdateTask` | task_ref, changed fields |
| `CompleteTask` | task_ref |
| `DropTask` | task_ref |
| `PinTask` | task_ref, date |
| `CreateEvent` | title, start, end |
| `ScheduleTask` | task_ref, window_hint? |
| `RescheduleBlock` | block_ref, target |
| `ReleaseBlock` | block_ref |
| `DeclareWindow` | weekdays[], start_local, end_local, daily_block_cap? |
| `RemoveWindow` | window_ref |
| `Replan` | scope (`today` \| `rest_of_week`) |
| `Query` | kind (`today` \| `backlog` \| `next` \| `date`), date? |
| `Undo` | batch_ref? |
| `Clarify` | question, candidates[] |

`CreateEvent` covers fixed commitments such as a dentist appointment, which are not tasks and
are never re-placed by the scheduler. A `*_ref` is either an internal ID or a title fragment
resolved by the disambiguation rules in section 8.

## 8. AI subsystem

### Intent compiler

Input is the user's sentence plus a compact context header: today's date, configured
timezone, active focus windows, and the last five referenced entity IDs. Output is one intent,
requested with Gemini structured output against a response schema, temperature 0.

The pipeline is bounded at **two model calls per utterance**:

1. Schema-constrained generation.
2. On validation failure, one repair attempt that includes the validation error.
3. On second failure, the `RuleBasedProvider` attempts the common shapes.
4. On failure of all three, return `Clarify`.

### Deterministic disambiguation

Entity references are resolved by code, not by model confidence. Model self-reported certainty
is uncalibrated and is not consulted. A `*_ref` resolves only when exactly one candidate scores
above the configured title-similarity threshold. Zero matches or a near-tie both produce
`Clarify` with the candidates listed, regardless of how certain the model's phrasing sounded.

### Reranker

Receives the top 10 candidates already ranked by the scoring function, as titles plus numeric
metadata. It may reorder those 10. It may not introduce anything outside them, and it may not
create, modify, schedule, or delete anything. It must return a reason of at most 200
characters, stored in `ai_decision.reason_text` and displayed beside the affected item.

### Prompt injection containment (architectural invariant)

Calendar events created by other people put third-party text into Cadence. That text reaches
only the reranker, whose output is validated as a permutation of IDs the system itself
supplied plus a reason string. **A fully hijacked reranker can do exactly one thing: order ten
of the user's own tasks incorrectly.** The intent compiler, which is the only component whose
output causes mutations, sees only text the user typed.

This separation is a load-bearing invariant. No future change may pass calendar text, or any
other third-party content, into the intent compiler's prompt.

### Scrubber

Enforced inside the adapter boundary, so no caller can bypass it. Payloads leaving the process
are built from a **field allowlist**, never a denylist of patterns. A field added to the model
later is excluded by default rather than accidentally transmitted.

### Provider adapter

```python
class LLMProvider(Protocol):
    def compile_intent(self, utterance: str, context: IntentContext) -> Intent: ...
    def rerank(self, candidates: list[Candidate]) -> RerankResult: ...
```

The model ID comes from configuration and never appears as a literal in code. As of
2026-08-29 the Gemini lineup includes 3.7 Flash, 3.5 Flash-Lite, 3.1 Flash Lite, and the 2.5
family concurrently, and names change frequently. A Flash-Lite class model is the default for
compilation; a Flash class model is the default for reranking.

## 9. Prioritization

Candidates are active tasks with no incomplete blockers and `earliest_start` within the
horizon. Blocked tasks are excluded outright rather than ranked low.

```
score = 0.35 * deadline_pressure
      + 0.25 * importance_norm
      + 0.15 * slip_pressure
      + 0.15 * unblocks
      + 0.10 * age
```

| Term | Definition |
| --- | --- |
| `deadline_pressure` | 0 with no deadline. 1.0 if overdue or due today. Otherwise `max(0, 1 - days_until / horizon_days)`, horizon default 14. |
| `importance_norm` | `(importance - 1) / 4` |
| `slip_pressure` | `min(slip_count / 3, 1.0)` |
| `unblocks` | `min(direct_incomplete_dependents / 3, 1.0)` |
| `age` | `min(days_since_created / 30, 1.0)` |

All weights and constants live in configuration. Weights are documented as summing to 1.0.

**Effort is deliberately not a score term.** Penalizing large tasks means large tasks never get
done. Effort is a fit constraint applied at placement time instead.

A task with `pinned_for_date` set to today bypasses scoring entirely and is placed first. This
override exists so the tool never argues with its user, and it costs almost nothing to
implement.

## 10. Scheduler

Placement is fully deterministic and consumes the already-reranked order.

1. Expand active focus windows across the horizon into concrete local intervals, then convert
   to UTC.
2. Subtract busy time drawn from `calendar_event_cache` and from existing blocks.
3. Clamp the earliest candidate start to `now + 15 minutes`, so the scheduler never places
   work in the past or in the next few seconds.
4. Greedily first-fit the ranked shortlist into remaining space.

Constraints: minimum block 25 minutes, maximum contiguous block 90 minutes, 10 minute buffer
between blocks, per-window `daily_block_cap` (default 3). A task is split only when
`allow_split` is set and every piece clears the 25 minute minimum. Anything that does not fit
stays in the backlog with no time attached.

**Invariant: the scheduler cannot emit a block outside a declared focus window.** The candidate
interval set is constructed from the user's windows, so no code path reaches other calendar
time. This is what makes full autonomy safe without confirmation prompts.

### DST handling

Windows are stored as local wall-clock times plus an IANA zone, so expansion crosses DST
transitions. Rules, with tests required on both transitions:

- A local time that does not exist (spring forward gap) shifts forward to the first valid time.
- An ambiguous local time (fall back repeat) resolves to the first occurrence.

## 11. Google Calendar integration

Cadence's database is the writer. Google Calendar is the projection.

- **Scope** is `https://www.googleapis.com/auth/calendar.events`. Not full calendar access.
- **Calendars.** Configuration names one write-target calendar and a list of busy-read
  calendars, defaulting to primary. Writing app blocks to a dedicated calendar keeps
  app-owned time visually separable in Google Calendar.
- **Ownership tagging.** App-created events carry
  `extendedProperties.private.cadence_block_id`. That tag is the only way the app recognizes
  its own events, so it never touches anything else.
- **Idempotent creation.** Client-generated event IDs on `events.insert`, so a retry after a
  timeout cannot create a duplicate.
- **Outbox pattern.** A calendar write never shares a transaction with a database write. The
  service commits the domain change and an `outbox` row atomically; a worker drains the outbox
  with exponential backoff. This is what makes "the database is the source of truth" true
  rather than aspirational: a Google outage delays projection instead of corrupting state.
- **Reading back.** Incremental `events.list` with a stored `syncToken`, polled every 5
  minutes (configurable). `410 Gone` triggers a full resync and a new token.
- **Manual edits win.** An app-owned block moved by hand in Google Calendar is marked
  `user_moved` and excluded from automatic re-placement. A deleted app block becomes
  `orphaned` and its task returns to the backlog. The user's edit is a signal, not noise.
- **Attendee guard.** Any cached event with other attendees is flagged, and no automatic path
  may move or delete it. Moving such an event emails real people, and no undo stack un-sends
  email.
- **OAuth token lifetime.** A consent screen left in Testing mode expires refresh tokens after
  seven days. This is the most likely thing to make the project appear broken while the code is
  correct. Cadence therefore ships a token health check surfaced in the UI, an explicit
  re-auth flow, and a setup document step covering the consent screen decision.

## 12. Undo and audit

Every mutation writes a `mutation_log` row containing before and after state. All mutations
produced by one user turn or one job run share a `batch_id`. Undo replays inverses newest-first
across a whole batch, so "undo that re-plan" reverses the entire re-plan rather than one block.
Calendar corrections flow through the same outbox as any other write.

The Activity view lists batches with undo controls and shows a daily digest of what the AI did
unattended. Given that autonomy is full, this feed is the only place oversight can live, which
makes it a Phase 3 requirement rather than a later addition.

## 13. Error handling and degraded mode

- **Quota governor** wraps every model call. It learns the observed ceiling rather than
  hardcoding a published number, because Google no longer publishes free-tier limits and states
  that actual limits are per-project and not guaranteed. On `429` it backs off exponentially
  with jitter, honoring `RetryInfo` when present. After repeated exhaustion a circuit breaker
  opens and sets degraded mode until the daily quota resets at midnight Pacific.
- **Degraded mode is a product state, not an error page.** The compiler falls back to
  `RuleBasedProvider`. The reranker is skipped and deterministic order stands. The scheduler is
  unaffected, having never needed a model. The UI shows a quiet banner. Capture,
  prioritization, and scheduling all keep working.
- **Validation failure** produces a clarifying question and zero writes. Partial application is
  not a reachable state.
- **Per-turn mutation cap**, default 20. A turn that would exceed it aborts as a batch rather
  than half-applying.
- **Free tier availability.** Third-party sources report the Gemini free tier is unavailable to
  EU users. This was not confirmed in Google's own documentation and is recorded as a setup-time
  risk to verify, not a design assumption.

## 14. Scheduled jobs

All jobs are **catch-up based, not fire-based**, and all are idempotent. Each records
`last_run_at` in `job_run`; on process startup anything overdue runs immediately. A cron-style
trigger would silently never fire on a laptop that sleeps at 03:00, which would make the design
quietly fail rather than visibly fail.

| Job | Interval | Purpose |
| --- | --- | --- |
| `outbox_drain` | 30 seconds | Push pending calendar writes. |
| `calendar_poll` | 5 minutes | Incremental sync, refresh busy times. |
| `nightly_plan` | daily | Rank and place tomorrow's shortlist. |
| `day_drift_reconcile` | on first open, and hourly | Release past unstarted blocks, increment `slip_count`, re-place the remainder of the day, resolve overlapping blocks by releasing the later one. |
| `token_health` | hourly | Verify OAuth credentials, surface re-auth need. |

`day_drift_reconcile` is the mechanism that addresses plan decay, so it is a named routine
with its own tests rather than an incidental cleanup.

## 15. Security

Single user, secrets local. The OAuth refresh token is encrypted at rest with a key from the
environment. `.env` is git-ignored from the first commit. Tokens never appear in logs.
`ai_decision` stores a digest of input rather than raw prompt text.

**A no-authentication local API holding a live calendar write token is reachable by any web
page the user visits.** Browsers permit a malicious page to issue requests to `localhost`, and
DNS rebinding defeats naive origin checks. Mitigations, all required in Phase 0:

- Bind `127.0.0.1` explicitly. Never `0.0.0.0`.
- Lock CORS to the app origin.
- Validate the `Host` header against an allowlist.
- Require a shared-secret header that the frontend injects from `.env`.

None of this is authentication. It is what makes the localhost-only assumption hold. Exposing
Cadence so a phone can reach it is a separate, deliberate decision that must add session login
and HTTPS first, and it is out of scope for all six phases.

## 16. Testing

- **Domain core:** plain unit tests, no mocks. Property tests assert the scheduler invariants,
  that no block falls outside a declared window, that no daily cap is exceeded, and that no
  block overlaps busy time. Explicit tests for both DST transitions.
- **Intent compiler:** a golden fixture file of sentence-to-intent pairs. CI runs against
  recorded responses, so it is fast and offline. A separate nightly job runs the same fixtures
  against the live model. That nightly contract test is how a model swap is caught before it
  reaches the calendar.
- **Calendar adapter:** tested against a fake implementing the same `Protocol`, covering
  `410 Gone`, rate limiting, and duplicate inserts.
- **Undo:** round-trip tests asserting that apply-then-undo returns the database to its prior
  state.
- **Layer purity:** the `import-linter` contract runs in CI as a test.
- **One end-to-end happy path:** sentence in, block on the fake calendar.

## 17. Phasing

Each phase is independently useful. Work stops at any boundary and still leaves a tool worth
opening.

- **Phase 0, foundation, no AI.** Project skeleton, SQLite schema, Alembic, Google OAuth,
  calendar read, manual task CRUD in the web UI, localhost hardening from section 15,
  `import-linter` contract.
- **Phase 1, capture.** Capture bar, intent compiler, `RuleBasedProvider`, parsed chips,
  `CreateTask` and `CreateEvent` and `Query` intents.
- **Phase 2, prioritize, still no scheduling.** Scoring function, Today view, Backlog view,
  pin override. **Kill criterion gate applies here.**
- **Phase 3, schedule.** Focus windows, Windows view, placement algorithm, outbox, calendar
  writes, mutation log, undo, Activity view.
- **Phase 4, intelligence.** Reranker with logged reasons, `nightly_plan`,
  `day_drift_reconcile`, daily digest, remaining intents.
- **Phase 5, hardening.** Quota governor, degraded mode UI, sync token reconciliation,
  token health check, nightly model contract test.

## 18. Risks

| Risk | Handling |
| --- | --- |
| Novelty wears off and the tool is abandoned | Phase 2 kill criterion. |
| Free-tier quota proves too small for daily use | Deterministic core works with zero model calls. Degraded mode is a designed state. |
| Free tier trains on prompt content | Sensitive fields stripped at ingestion. Provider adapter makes paid tier or a local model a configuration change. |
| Free tier unavailable in the user's region | Verify at setup. Provider adapter is the fallback path. |
| Gemini model IDs change or are deprecated | Model ID in configuration. Nightly live contract test on parse fixtures. |
| OAuth refresh token expires weekly in Testing mode | Token health check, explicit re-auth flow, documented setup step. |
| Full autonomy produces unwanted calendar changes | Window boundary invariant, attendee guard, per-turn mutation cap, batch undo, daily digest. |
| Prompt injection through third-party event titles | Reranker output constrained to a permutation of supplied IDs. Compiler never sees third-party text. |
| Scope creep toward commercial feature parity | Explicit non-goals. Effort-based and history-based intelligence deferred out of v1. |

## 19. Explicitly not to be built

Scale is not a concern and must not be engineered for. One user, a few thousand tasks, O(n)
scoring over an indexed candidate filter. No caching layer, no queue broker, no read replica,
no pagination beyond a simple limit, no horizontal anything. An implementation that adds
infrastructure for throughput has misread this document.

Also deferred out of v1: energy-pattern and completion-history learning in the reranker,
recurring tasks, multi-timezone travel, and any form of remote access.
