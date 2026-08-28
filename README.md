# Cadence

A single-user calendar and task manager where one typed sentence becomes a structured task, a
ranked shortlist says what to work on next, and the top of that shortlist is placed into real
Google Calendar time inside boundaries you declared.

Python FastAPI, React, SQLite, Google Gemini. Runs on localhost. Built for one person.

**Status: design complete, no code yet.** Phase 0 of `PRD.md` is the next step.

## The idea in one paragraph

Four problems compound: commitments never get captured because forms are slower than the thought,
nothing says which hour belongs to which task, plans decay by Tuesday and repairing them by hand
is tedious, and tasks live apart from time. Those are not four problems. They are one loop:
capture, prioritize, schedule, re-plan. Cadence closes it.

## How it works, briefly

You type a sentence. A language model translates it into one validated **intent**, and
deterministic code executes it. The model never touches the database or Google's API. A scoring
formula ranks your tasks; the model may reorder the top ten and must say why. A scheduler places
that shortlist into **focus windows** you declared, and only there. Everything the AI does is
logged with its inverse, so any batch can be undone.

When the model is unavailable, a rule-based parser takes over, ranking continues unchanged, and
scheduling never needed a model at all. The app degrades from smart to merely useful, which is the
point.

## Documentation

| File | Purpose |
| --- | --- |
| `PRD.md` | What must be true. Stories, acceptance criteria per phase, success metrics, kill criterion. |
| `ARCHITECTURE.md` | Structure, directory map, the nine invariants, data flows. |
| `AGENTS.md` | Operating instructions for AI coding agents and contributors. |
| `CLAUDE.md` | Pointer to `AGENTS.md` plus Claude-specific notes. |
| `docs/superpowers/specs/2026-08-29-ai-calendar-agent-design.md` | The frozen design record and its full rationale. |
| `docs/DECISIONS.md` | Decision log. Read before proposing an alternative. |
| `docs/GLOSSARY.md` | Domain vocabulary. The terms are precise. |
| `docs/CONVENTIONS.md` | Code style, error handling, commit format. |
| `docs/TESTING.md` | Test strategy, including how to test a non-deterministic model. |
| `docs/SECURITY.md` | Threat model and the assumptions this design depends on. |
| `docs/SETUP.md` | First-run guide, including the seven-day OAuth token trap. |

New to the project: read this file, then `PRD.md`, then `ARCHITECTURE.md`. Read the spec when you
need to know why something is the way it is.

## Getting started

See `docs/SETUP.md`. Nothing runs until Phase 0 is built.

## Deliberate limits

Not a competitor to Motion or Reclaim.ai. Single user, no accounts, no sharing. No native mobile
app, no voice, no meeting negotiation with other people. Localhost only: exposing this service
requires real authentication first, and that is out of scope.

Scale is not a concern and must not be engineered for. One user, a few thousand tasks. Any pull
request adding a cache, a queue broker, or a replica has misread the design.
