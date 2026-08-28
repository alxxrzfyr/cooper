# AGENTS.md

Operating instructions for AI coding agents working in this repository. Read this before
touching any file. Human contributors will also find it accurate.

## What this is

Cadence is a single-user web app that turns typed sentences into tasks and calendar events,
ranks what to work on next, and places the top of that ranking into Google Calendar inside
user-declared focus windows. Python FastAPI backend, React frontend, SQLite, Gemini free tier.

## Read in this order

1. `PRD.md` for what must be true.
2. `ARCHITECTURE.md` for structure and the nine invariants.
3. `docs/superpowers/specs/2026-08-29-ai-calendar-agent-design.md` for the full design and its
   rationale. This is the frozen record. If your change contradicts it, the spec is wrong or
   your change is. Resolve that before writing code.
4. `docs/GLOSSARY.md` when a term is unfamiliar. The vocabulary is precise and worth respecting.
5. `docs/DECISIONS.md` before proposing an alternative approach. Most alternatives were already
   considered and rejected for stated reasons.

## Current state

The repository contains documentation only. No code exists yet. Phase 0 of
`PRD.md` establishes the toolchain, so the commands below are the target contract that Phase 0
must satisfy, not commands that work today. Do not report them as working until you have run
them and seen output.

## Commands

```bash
# Backend
uv sync                          # install
uv run alembic upgrade head      # migrate
uv run uvicorn cadence.main:app --reload --host 127.0.0.1
uv run pytest                    # all tests
uv run pytest tests/core -q      # fast, pure, no I/O
uv run ruff check . && uv run ruff format --check .
uv run mypy cadence
uv run lint-imports              # layer purity contract

# Frontend
cd frontend && npm install
npm run dev
npm run test
npm run build
```

## Workflow for any change

1. **Locate the requirement.** Find the phase and acceptance criterion in `PRD.md` that your
   change serves. If none exists, stop and ask. Unrequested features are the main failure mode
   here.
2. **Write the test first.** Every change starts with a failing test. Domain logic goes in
   `tests/core` with no mocks. See `docs/TESTING.md`.
3. **Implement the smallest change that passes.**
4. **Run the gates.** `pytest`, `ruff`, `mypy`, `lint-imports`. All four, every time.
5. **State what you verified.** Cite the command and its result. Do not claim a test passes
   without having run it.

## Non-negotiable rules

- **Never weaken an invariant** from `ARCHITECTURE.md` to make a test pass. If an invariant
  blocks you, the design needs a decision, so stop and ask.
- **Never put a model ID literal in code.** It belongs in `config.py`, read from the environment.
- **Never pass calendar text into the intent compiler's prompt.** That separation is what
  contains prompt injection. Invariant 4.
- **Never let `core` import SQLAlchemy, FastAPI, a vendor SDK, `services`, `adapters`, or
  `api`.** `lint-imports` will fail, and correctly so.
- **Never add infrastructure for scale.** No cache, no broker, no replica, no worker process.
  One user. Spec section 19 is explicit.
- **Never commit secrets.** `.env` is git-ignored. Tokens never appear in logs. `ai_decision`
  stores a digest of input, not raw prompt text.
- **Never bind `0.0.0.0`.** Localhost only. Exposing this service is a separate decision that
  requires real authentication first, and it is out of scope.
- **Never add a confirmation modal to the capture path.** Autonomy is full by decision. The
  correction path is the parsed chip. See `docs/DECISIONS.md` entry 4.
- **Never trust model-reported confidence.** Disambiguation is deterministic. Invariant in
  spec section 8.
- **Never exceed two model calls per utterance,** or the per-turn mutation cap.

## Definition of done

A change is done when all of these hold, and you have output proving each:

- [ ] The acceptance criterion from `PRD.md` is satisfied.
- [ ] A test exists that fails without the change.
- [ ] `uv run pytest` passes.
- [ ] `uv run ruff check .` and `uv run ruff format --check .` pass.
- [ ] `uv run mypy cadence` passes.
- [ ] `uv run lint-imports` passes.
- [ ] No new dependency was added without a pinned version and a stated reason.
- [ ] Docs updated if behavior described in `PRD.md` or `ARCHITECTURE.md` changed.

## When to stop and ask

- The change requires modifying an invariant, or contradicts the spec.
- The requirement is absent from `PRD.md`.
- A test fails twice for reasons you have not diagnosed. Stop. Do not try a third variation.
- The work touches OAuth scopes, the localhost hardening, or secret handling.
- A dependency needs adding.
- The change would make the app unusable when the model is unavailable.

## Working style

Small, focused files. One clear purpose each. A file that is hard to describe in one sentence is
doing too much and should be split. Prefer boring code: this codebase has one user and needs to
be readable in six months more than it needs to be clever.

Commit messages use Conventional Commits. See `docs/CONVENTIONS.md`.
