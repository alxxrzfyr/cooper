# Cadence

A single-user calendar and task manager where one typed sentence becomes a structured task, a
ranked shortlist says what to work on next, and the top of that shortlist is placed into real
Google Calendar time inside boundaries you declared.

Python FastAPI, React, SQLite, Google Gemini. Runs on localhost. Built for one person.

## Status

**The loop is closed.** Capture, prioritisation, scheduling, and re-planning all work.
Google Calendar projection is built and tested, and needs your own Google Cloud credentials
to run against a real calendar.

| Phase | State |
| --- | --- |
| 0 Foundation | Done. Schema, localhost hardening, task CRUD, OAuth boundary, scrubbed calendar read. |
| 1 Capture | Done. Sentence to validated intent, parsed chip, undo. |
| 2 Prioritise | Done. Deterministic scoring, Today and Backlog. |
| 3 Schedule | Done. Focus windows, DST-safe expansion, placement, outbox projection, batch undo, activity feed. |
| 4 Intelligence | Done. Reranker containment, nightly plan, day-drift reconcile, digest. |
| 5 Hardening | Done. Quota governor, degraded mode, sync-token recovery, WAL concurrency. |

What works right now, with no API key and no Google account:

- Type `write the quarterly report, 90m, important, due friday` and get a structured task.
- Type `dentist thursday 3pm` and get a parsed fixed event.
- Type `done quarterly` to close a task by partial title, or `pin the report` to force it to
  the top of today.
- Open Today for a ranked shortlist where every row explains its own score.
- Paint focus windows, then press **Schedule shortlist** to place work inside them.
- Watch the timeline shade the hours the scheduler may use, and hatch the hours it may not.
- Open Activity to see every change grouped into batches, each reversible as a unit.

What needs your Google credentials: projecting those blocks into Google Calendar, reading
your existing events as busy time, and adopting edits you make by hand. Set
`CADENCE_GOOGLE_CLIENT_ID`, `CADENCE_GOOGLE_CLIENT_SECRET`, and a generated
`CADENCE_TOKEN_ENCRYPTION_KEY`. Until then the app runs fully and says plainly that the
calendar is not connected.

Configuring Gemini improves parsing on messier sentences. It is not required, and neither
ranking nor scheduling ever calls a model.

## Verified

Every command below was run against this tree.

```
uv run pytest                 461 passed
uv run ruff check .           All checks passed
uv run ruff format --check .  107 files already formatted
uv run mypy cadence           Success: no issues found in 55 source files
uv run lint-imports           Contracts: 1 kept, 0 broken
cd frontend && npm test       43 passed
cd frontend && npm run build  built successfully
```

Also confirmed in a running process and a real browser: fresh `alembic upgrade head`,
`403` without the shared secret, `403` from an unknown origin, `400` on a spoofed `Host`,
six sentences captured and correctly parsed, weekday-morning windows declared, the shortlist
placed into them, the whole schedule batch undone, and all five background jobs recorded in
`job_run` at startup.

## The two invariants that make autonomy safe

The AI applies changes without asking, which is a deliberate choice. Two structural
properties are what make that acceptable rather than reckless.

**The scheduler cannot write outside a declared window.** Candidate time is constructed from
your windows, so there is no code path that reaches other calendar time. It is not a check
that could be forgotten; it is the shape of the data.

**The reranker cannot mutate anything.** Other people's event titles are untrusted text, and
they reach only that component, whose output is validated as a permutation of IDs Cadence
supplied. A fully hijacked reranker can do exactly one thing: order ten of your own tasks
wrongly. The component that does cause mutations never sees third-party text at all.

Both are asserted by tests named after them.

## The idea in one paragraph

Four problems compound: commitments never get captured because forms are slower than the
thought, nothing says which hour belongs to which task, plans decay by Tuesday and repairing
them by hand is tedious, and tasks live apart from time. Those are not four problems. They are
one loop: capture, prioritize, schedule, re-plan. Cadence closes it.

## How it works, briefly

You type a sentence. A language model translates it into one validated **intent**, and
deterministic code executes it. The model never touches the database or Google's API. A scoring
formula ranks your tasks; the model may reorder the top ten and must say why. A scheduler places
that shortlist into **focus windows** you declared, and only there. Everything the AI does is
logged with its inverse, so any batch can be undone.

When the model is unavailable, a rule-based parser takes over, ranking continues unchanged, and
scheduling never needed a model at all. The app degrades from smart to merely useful, which is the
point.

## Quick start

```bash
uv sync
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(32))"   # paste as CADENCE_SHARED_SECRET
uv run alembic upgrade head
uv run uvicorn cadence.main:app --reload --host 127.0.0.1

cd frontend && npm install
echo "VITE_CADENCE_SHARED_SECRET=<same value as .env>" > .env.local
npm run dev
```

Full instructions, including the seven-day OAuth token trap, are in `docs/SETUP.md`.

## Documentation

| File | Purpose |
| --- | --- |
| `PRD.md` | What must be true. Stories, acceptance criteria per phase, success metrics, kill criterion. |
| `ARCHITECTURE.md` | Structure, directory map, the nine invariants, data flows. |
| `AGENTS.md` | Operating instructions for AI coding agents and contributors. |
| `CLAUDE.md` | Pointer to `AGENTS.md` plus Claude-specific notes. |
| `docs/superpowers/specs/2026-08-29-ai-calendar-agent-design.md` | The frozen design record and its full rationale. |
| `docs/superpowers/plans/2026-08-29-cadence-phases-0-2.md` | The implementation plan this build followed. |
| `docs/DECISIONS.md` | Decision log. Read before proposing an alternative. |
| `docs/GLOSSARY.md` | Domain vocabulary. The terms are precise. |
| `docs/CONVENTIONS.md` | Code style, error handling, commit format. |
| `docs/TESTING.md` | Test strategy, including how to test a non-deterministic model. |
| `docs/SECURITY.md` | Threat model and the assumptions this design depends on. |
| `docs/SETUP.md` | First-run guide. |

New to the project: read this file, then `PRD.md`, then `ARCHITECTURE.md`. Read the spec when you
need to know why something is the way it is.

## Deliberate limits

Not a competitor to Motion or Reclaim.ai. Single user, no accounts, no sharing. No native mobile
app, no voice, no meeting negotiation with other people. Localhost only: exposing this service
requires real authentication first, and that is out of scope.

Scale is not a concern and must not be engineered for. One user, a few thousand tasks. Any pull
request adding a cache, a queue broker, or a replica has misread the design.
