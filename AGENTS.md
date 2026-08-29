# AGENTS.md

Instructions for anyone changing this code, human or model.

## What this is

A personal calendar you talk to. One user, one machine. Six backend files, three tables.

Read `PRD.md`, then `ARCHITECTURE.md`. Both are short on purpose.

## Commands

```bash
uv sync
uv run uvicorn cadence.app:app --reload --host 127.0.0.1
uv run pytest
uv run ruff check . && uv run ruff format --check .

cd frontend && npm install
npm run dev
npm test
npm run build
```

No migrations. No linter beyond ruff. That is the whole toolchain.

## The bar for adding anything

This project was rebuilt once because it grew into 55 files and 461 tests for a problem that
needs neither. Before you add code, answer these:

1. **Which of the four requirements in `PRD.md` does this serve?** If none, stop.
2. **Would it still be needed with one user?** Queues, audit logs, and permission models are
   answers to problems this app does not have.
3. **Can it be a smaller change to an existing file instead of a new file?** Usually yes.

If you find yourself writing an abstraction because a second implementation *might* appear, do
not. Write the one that exists.

## Rules that are not negotiable

These are in `PRD.md` as product rules. Here is what they mean in code.

- **`brain.py` never touches the database.** It returns a validated `Action`. If you need it to
  read state, pass the state in.
- **`app.py` is the only writer.** Every mutation goes through it, so undo has one place to hook.
- **Placement only uses working hours.** Never widen `_first_gap` to consider other time.
- **Ambiguity asks.** Do not make `find()` return a best guess. Two matches is a 409.
- **Times are UTC in the database.** Use the `Utc` column type for any new timestamp. A naive
  datetime in SQLite silently shifts by your offset.
- **Never bind `0.0.0.0`.** There is no authentication.
- **Never log a token or a prompt.** The Google token is encrypted at rest.
- **No confirmation dialog on the composer.** Undo is the correction path.
- **It must work with no Gemini key and no Google account.** If your change breaks that, it is
  the wrong change.

## Working style

TDD where the logic is real: parsing, ranking, placing, and anything about time. Skip it for
markup. `tests/test_cadence.py` covers the pure functions, `tests/test_api.py` goes through HTTP.

Run the app and look at it before saying you are done. Three of the bugs in this codebase's
history were invisible in tests and obvious on screen: a timezone shift that displayed 3pm as
11pm, a grid that wrapped, and the same task listed twice.

Small files. If one is hard to describe in a sentence, split it.

Conventional Commits. Explain why in the body; the diff already says what.

## When to stop and ask

- The change needs a new table, a new dependency, or a background process.
- It contradicts a rule above.
- A test fails twice for a reason you have not diagnosed. Stop guessing.
- You are about to touch the shared key, the localhost binding, or token storage.
