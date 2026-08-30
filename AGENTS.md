# AGENTS.md

Instructions for anyone changing this code, human or model.

## What this is

One place for everything that takes your time — tasks, events, and errands — that you talk to.
Six backend files, three tables. Runs on one machine for one person today, built so other people
can use it later.

Read `PRD.md`, then `ARCHITECTURE.md`. Both are short on purpose. `PRD.md` has seven
requirements; four of them work and three are the build. Know which is which before you start.

## Commands

```bash
uv sync
uv run uvicorn cooper.app:app --reload --host 127.0.0.1
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

1. **Which of the seven requirements in `PRD.md` does this serve?** If none, stop.
2. **Would one person, today, notice it was missing?** Queues, permission models and reporting
   are answers to problems this app does not have. "Other users later" is not a licence to build
   for them now — `PRD.md` lists the only four things being done early for that reason.
3. **Can it be a smaller change to an existing file instead of a new file?** Usually yes.

If you find yourself writing an abstraction because a second implementation *might* appear, do
not. Write the one that exists. The one exception is `sources.py`, where the second, third and
fourth implementations are named in `PRD.md` and are the point.

## Rules that are not negotiable

These are in `PRD.md` as product rules. Here is what they mean in code.

### Who writes

- **`brain.py` never touches the database.** It returns a validated `Action`. If you need it to
  read state, pass the state in.
- **`app.py` is the only writer.** Every mutation goes through it, so undo has one place to hook.
  An event parsed out of an email is not a shortcut past this: it becomes an `Action` and goes
  through `_sanity_check` like anything else. There is no second write path.
- **An AI answer is text.** The answer path returns a string and writes nothing.
- **Cooper writes to exactly one remote place:** blocks it placed, in Google Calendar. Microsoft
  and the mail watcher are read-only. No RSVP, no creating Teams meetings, no posting anywhere.

### Time

- **Placement only uses working hours.** Never widen `_first_gap` to consider other time. Busy
  intervals from remote sources subtract from candidate times; they never add to them.
- **Times are UTC in the database.** Use the `Utc` column type for any new timestamp, including
  anything read from a remote calendar. A naive datetime in SQLite silently shifts by your offset.

### Asking

- **Ambiguity asks.** Do not make `find()` return a best guess. Two matches is a 409.
- **Bulk destructive verbs show the list first.** Undo is enough correction for one item and not
  enough for twenty.
- **No confirmation dialog on the composer.** These two are not in conflict: a bulk verb answers
  in the conversation, the way an ambiguous reference does. It is a reply, not a modal. Frames are
  for detail you asked to see, never for permission.

### Working without anything connected

- **It must work with no Gemini key, no Google account and no Microsoft account.** If your change
  breaks that, it is the wrong change. Every integration is additive.
- **Manual mode never touches the network.** `Brain.read(use_model=False)` is the whole contract.
  Manual is a form now, which makes this easier, not optional.
- **A failed remote never blocks the user.** Wrap every call. The item is still captured, still
  ranked, still scheduled locally. Local is the source of truth; every remote is a mirror.

### The watcher

- **It must report that it is alive.** Last-checked time goes to the dashboard. This is the only
  part of Cooper that runs unprompted and so the only part that can fail silently.
- **It is a timer and a loop.** If it grows a retry policy with backoff tiers, a dead letter path,
  or a second consumer, that is the old version returning. Delete it.

### Data and secrets

- **Never bind `0.0.0.0`.** There is no authentication.
- **Never log a token, a prompt, an email body, or a message id.** The Google token is encrypted
  at rest.
- **Only your own words and your own titles go to a model** — except email bodies, which are the
  one knowing exception, fenced in `PRD.md`. Never attendees, never other people's addresses,
  never your calendar entries' contents.
- **New rows carry `owner_id`.** One value today. Retrofitting ownership later is the worst
  version of this change.
- **No database-specific SQL.** Everything through SQLAlchemy, so Postgres is a connection string.
  `_add_new_columns()` is the existing violation and is documented as such — do not add a second.
- **`google_event_id` and `source_ref` are different things.** One is an event Cooper wrote, one
  is an event Cooper read. Merging them looks tidy and quietly corrupts data.
- **The shared key is a placeholder, not authentication.** Do not extend it into a pretend
  version of one.

### Colour

- **Green means done, red means gone.** Those two colours are reserved app-wide. The four category
  colours are purple, blue, orange and teal for exactly that reason.
- **Four categories, no fifth.** Unrecognised is personal.

## Working style

TDD where the logic is real: parsing, ranking, placing, and anything about time. Skip it for
markup. `tests/test_cooper.py` covers the pure functions, `tests/test_api.py` goes through HTTP.

Run the app and look at it before saying you are done. Three of the bugs in this codebase's
history were invisible in tests and obvious on screen: a timezone shift that displayed 3pm as
11pm, a grid that wrapped, and the same task listed twice.

Small files. If one is hard to describe in a sentence, split it.

Conventional Commits. Explain why in the body; the diff already says what.

## When to stop and ask

- The change needs a new table, a new dependency, or a second background process.
- It contradicts a rule above.
- A test fails twice for a reason you have not diagnosed. Stop guessing.
- You are about to touch the shared key, the localhost binding, or token storage.
- You are about to request a broader OAuth scope than the one already in use.
- You are about to build accounts, hosting, or Postgres. Those are one deliberate piece of work,
  not something to drift into.
