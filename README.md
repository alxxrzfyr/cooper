# Cadence

A single-user calendar and task manager where one typed sentence becomes a structured task, a
ranked shortlist says what to work on next, and the top of that shortlist is placed into real
Google Calendar time inside boundaries you declared.

Python FastAPI, React, SQLite, Google Gemini. Runs on localhost. Built for one person.

## Status

**Capture and prioritisation work end to end. Calendar integration does not exist yet.**

Being precise, because the phase numbers alone would overstate this. `PRD.md` gives Phase 0
five acceptance criteria:

| Phase 0 criterion | State |
| --- | --- |
| 1 Full section 6 schema via `alembic upgrade head` | Done |
| 2 OAuth flow storing an encrypted refresh token | **Not built** |
| 3 Existing calendar events cached with sensitive fields absent | **Not built** |
| 4 API refuses missing secret, unknown origin, unexpected host; binds `127.0.0.1` | Done |
| 5 `import-linter` contract enforced in CI | Done |

So the honest summary is:

| Phase | State |
| --- | --- |
| 0 Foundation | Partial. Schema, localhost hardening, manual task CRUD. OAuth and calendar reading deferred to Phase 3, where the first code that needs them lives. |
| 1 Capture | Done. Sentence to validated intent, parsed chip, undo. |
| 2 Prioritise | Done. Deterministic scoring, Today and Backlog. |
| 3 Schedule | Not started. OAuth, calendar reading, focus windows, placement, calendar writes. |
| 4 Intelligence | Not started. Reranker, nightly plan, digest. |
| 5 Hardening | Not started. Quota governor, sync reconciliation. |

Deferring OAuth is a deliberate call, not an oversight: nothing in Phases 1 or 2 reads or
writes a calendar, so building the token flow now would ship an untestable credential path
months before its first caller. The `calendar_event_cache` table exists with no column for
descriptions, locations, meeting links, or attendee addresses, so the scrubbing guarantee is
already structural.

What works right now:

- Type `write the quarterly report, 3h, important, due friday` and get a structured task.
- Type `dentist thursday 3pm` and get a parsed fixed event. It is **not** written to Google
  Calendar; that is Phase 3.
- Type `done quarterly` to close a task by partial title, or `pin the report` to force it to
  the top of today.
- Open Today for a ranked shortlist where every row explains its own score.
- Undo any capture from the chip it produced.

Not yet wired: Google OAuth, calendar reading, focus windows, automatic scheduling, and the
activity history view. The Windows and Activity screens exist as labelled previews.

Runs with **no API key at all**, using a rule-based parser. Configuring Gemini improves
parsing; it is not required, and ranking never uses a model.

## Verified

Every command below was run against this tree.

```
uv run pytest                 260 passed
uv run ruff check .           All checks passed
uv run ruff format --check .  77 files already formatted
uv run mypy cadence           Success: no issues found in 36 source files
uv run lint-imports           Contracts: 1 kept, 0 broken
cd frontend && npm test       24 passed
cd frontend && npm run build  built successfully
```

End-to-end smoke test: `alembic upgrade head` on a fresh database, server bound to
`127.0.0.1`, `403` without the shared secret, `403` from an unknown origin, a sentence
captured into a correctly parsed task, and a correctly ranked shortlist returned.

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
