# Cadence: Architecture

Structural reference. Rationale for these choices lives in the design spec at
`docs/superpowers/specs/2026-08-29-ai-calendar-agent-design.md`; this document states the
structure and the rules that protect it.

## Shape

Four layers, dependencies pointing inward only.

```
frontend/                       React, Vite, TypeScript
     |  HTTP + shared-secret header
     v
cadence/api/                    FastAPI routers. Validation and serialization only.
     v
cadence/services/               Orchestration. Owns transactions and the outbox.
     v
cadence/core/                   Pure Python. No I/O. No frameworks.
     ^
cadence/adapters/               Implements Protocols declared in core.
```

`adapters` depends on `core` for the Protocols it satisfies. `services` composes `core` and
`adapters`. Nothing depends on `api`.

## Directory map

```
cadence/
  core/
    intents.py          Intent dataclasses. The model's entire output space.
    scoring.py          score() and its per-term functions. Pure.
    windows.py          Focus window expansion, including DST rules.
    placement.py        Greedy first-fit placement. Pure.
    disambiguation.py   Title similarity, threshold and tie rules.
    protocols.py        LLMProvider, CalendarClient, Repository.
    errors.py           Domain error types.
  services/
    task_service.py     Task lifecycle, mutation log writes.
    plan_service.py     Rank, rerank, place, reconcile.
    sync_service.py     Calendar pull, outbox drain.
    undo_service.py     Batch inverse application.
    intent_executor.py  Maps a validated Intent to service calls.
  adapters/
    gemini_provider.py     LLMProvider via Gemini structured output.
    rule_provider.py       LLMProvider via dateparser and regex. No network.
    scrubber.py            Field allowlist. Enforced here, not by callers.
    quota_governor.py      Backoff, circuit breaker, degraded-mode flag.
    google_calendar.py     CalendarClient. Tagging, sync tokens, idempotent insert.
    repository.py          SQLAlchemy implementation of Repository.
  api/
    routes_tasks.py  routes_plan.py  routes_windows.py
    routes_chat.py   routes_activity.py  routes_auth.py
    security.py      Shared secret, CORS, Host validation.
  jobs/
    scheduler.py     APScheduler wiring. Catch-up logic via job_run.
    definitions.py   The five jobs from spec section 14.
  config.py          Pydantic settings. All weights, model IDs, intervals, thresholds.
  main.py            App factory. Binds 127.0.0.1.
frontend/src/
  views/   Today.tsx  Backlog.tsx  Windows.tsx  Activity.tsx
  components/  CaptureBar.tsx  ParsedChip.tsx  ScoreBreakdown.tsx  DegradedBanner.tsx
  api/     client.ts  types.ts
migrations/          Alembic
tests/
  core/  services/  adapters/  fixtures/intents.jsonl  e2e/
```

## Invariants

These are load-bearing. Breaking any one of them is a design regression, not a refactor. Each is
covered by a test named after it.

1. **`core` is pure.** No I/O, no network, no ORM, no framework imports. Enforced by an
   `import-linter` contract in CI, not by reviewer memory.
2. **The scheduler cannot emit a block outside a declared focus window.** The candidate interval
   set is built from the user's windows, so no code path reaches other calendar time.
3. **The reranker cannot mutate anything.** Its output is validated as a permutation of the IDs
   the system supplied, plus a reason string. Nothing else is accepted.
4. **The intent compiler never sees third-party text.** Only text the user typed. This is what
   contains prompt injection arriving through other people's calendar event titles.
5. **Multi-attendee events are never moved or deleted automatically.** Moving them emails real
   people, and undo cannot un-send email.
6. **Sensitive fields are stripped at ingestion, not at prompt time.** Descriptions, locations,
   meeting links, and attendee emails never enter the database, so they cannot leak from it.
7. **Calendar writes never share a transaction with database writes.** They go through the
   outbox. A Google outage delays projection; it does not corrupt state.
8. **Every mutation is logged with its inverse and a `batch_id`.** Undo operates on batches.
9. **Scheduled jobs are catch-up based and idempotent.** A machine asleep at the trigger time
   must still run the job at next startup, exactly once.

## Data flow: capture

```
CaptureBar -> POST /chat -> IntentCompiler (adapters, <=2 model calls)
           -> Intent validated against core.intents
           -> disambiguation resolves *_ref, or returns Clarify
           -> IntentExecutor -> service call
           -> mutation_log row (+ outbox row if calendar is affected)
           -> ParsedChip rendered with edit and undo
```

Validation failure at any step yields `Clarify` and zero writes. Partial application is not a
reachable state.

## Data flow: plan

```
PlanService.rank()      candidates -> core.scoring -> ranked list
PlanService.rerank()    top 10 -> LLMProvider.rerank -> permutation validated -> reason logged
PlanService.place()     windows -> expand -> subtract busy -> core.placement -> blocks
SyncService.drain()     outbox -> GoogleCalendar.insert/patch -> block.state = pushed
```

Skipping the rerank step changes ordering quality and nothing else. This is what makes degraded
mode a product state rather than an outage.

## Data flow: sync in

```
calendar_poll -> events.list(syncToken) -> scrubber (allowlist) -> calendar_event_cache
              -> app-owned event moved by user  -> block.state = user_moved
              -> app-owned event deleted by user -> block.state = orphaned, task to backlog
              -> 410 Gone -> full resync, new token
```

## Storage

SQLite through SQLAlchemy, migrated with Alembic. One user on one machine. The connection
string is the only change required if Postgres ever becomes necessary. Do not add a cache, a
broker, or a replica. See spec section 19.

## Configuration

Everything tunable lives in `config.py`, read from the environment. Notably: scoring weights,
`horizon_days`, similarity threshold, block minimum and maximum, buffer, daily cap, poll
intervals, per-turn mutation cap, and both model IDs.

Model IDs must never appear as literals in code. The Gemini lineup shifts frequently, and a
model rename should be a one-line environment change rather than a code search.
