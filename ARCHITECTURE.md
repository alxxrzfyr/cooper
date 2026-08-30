# Architecture

Nine files do everything that exists today. Read them in this order and you will understand the
whole app in about twenty minutes. What is planned is marked as planned; nothing below describes
code that is not there.

## Backend, today

```
cooper/
  config.py    ~50 lines   settings from .env; only COOPER_SHARED_KEY is required
  db.py       ~250 lines   three tables, a session helper, the UTC column type
  brain.py    ~380 lines   sentence → validated Action (Gemini, then regex)
  planner.py  ~215 lines   rank() and place(); pure, no I/O, no model
  google.py   ~280 lines   Calendar over REST; no SDK
  app.py      ~580 lines   every route; the only thing that writes to the database
```

## Backend, planned

Four new files, one per idea in requirement 7 and its neighbours. If any of these can be a
smaller change to a file above instead, do that.

```
cooper/
  sources.py   the busy-time pipe: every remote commitment becomes one list of busy intervals
  microsoft.py Graph over REST; mirrors google.py in shape — meetings, then class assignments
  watcher.py   the timer loop that reads Gmail; the only part that runs unprompted
```

None of these exist yet. Requirement 5 needed no backend change at all: the dashboard is built
entirely from the `/api/today` payload the app already fetched.

**`sources.py` is the load-bearing one.** Google events, Outlook meetings and events parsed out
of email are all the same thing to the scheduler: `(start, end)` pairs that are already spoken
for. `planner.place()` takes busy intervals and does not care where they came from. Build this
before the second source exists, or the second source becomes a rewrite.

Teams class assignments are the one exception. They are tasks with due dates, so they enter as
items and go through `rank()`, not through `sources.py`.

## Frontend, today

```
frontend/src/
  App.tsx           one screen: banner, plan, setup, composer
  Home.tsx          the dashboard, and the landing screen — next, today, attention, waiting
  Chat.tsx          the conversation, grouped into runs like a messages app
  Calendar.tsx      day, week and month, coloured by category
  Nav.tsx           top bar, bottom tabs, and the wide-screen rail
  Row.tsx           a task or event, with its score breakdown
  Mascot.tsx        Cooper, one name per file in public/assets/mascot
  api.ts            the only place that calls the backend
  types.ts          mirrors what app.py returns
  theme.css         tokens, light and dark
```

## Frontend, planned

```
  Form.tsx          Manual mode as fields rather than a sentence
```

`Home.tsx` reuses `Row.tsx` and the `slot` classes from `Calendar.tsx`, because the dashboard is a
new arrangement of things that already render rather than a new set of components. The one piece
of real logic in it is deciding what counts as today, which is done from the local calendar day so
it cannot drift with the viewer's zone.

## Data

Three tables today. The planned changes are additive columns, no new tables.

**`item`** — a task *or* an event. The only difference is whether the time is fixed, so they
share a table. Splitting them into `task` and `scheduled_block` is what made the previous
version sprawl.

```
id kind title notes minutes importance due category
start_at end_at google_event_id
status pinned created_at done_at
```

Planned columns:

```
owner_id      who this belongs to; one value today, cheap now and brutal later
source        where it came from: "me", "google", "microsoft", "email"
source_ref    the id it has over there, so an update finds it again
```

`google_event_id` and `source_ref` are not the same thing and must not be merged.
`google_event_id` is an event Cooper *wrote*. `source_ref` is an event Cooper *read*. One is a
mirror Cooper owns, the other is a fact it does not.

**`setting`** — key/value. Working hours, encrypted tokens, and the watcher's last-seen marker
and last-checked time. Planned: keyed by owner, not global.

**`change`** — `label`, `item_id`, `before`. Enough to undo the last thing, pruned to twenty
rows. Not an audit log. Planned: `owner_id`.

### Databases

SQLite today, via SQLAlchemy. `Store.__init__` calls `create_all`, which is the right amount of
ceremony for three tables owned by one person.

Postgres arrives with accounts, in the same piece of work, and should be a change to
`COOPER_DATABASE_URL` and nothing else. Two things stand in the way, both known:

- **`_add_new_columns()` uses `PRAGMA table_info`, which is SQLite-only.** It exists because
  `create_all` adds missing tables but not missing columns. It is the one place that must be
  replaced rather than ported.
- **`create_all` is not a migration tool.** It works because a single owner can delete
  `cooper.db`. Real users cannot, so accounts and a migration tool arrive together.

Write no database-specific SQL from here on. That rule is what keeps the swap to one line.

## The flow

```
you type                              email arrives
   ↓                                       ↓
POST /api/say                         watcher.py, on a timer
   ↓                                       ↓
brain.read()                          known sender?  no → stop
   ↓                                       ↓
Action(verb=…)                        brain parses it → proposed event
   ↓                                       ↓
_sanity_check()   ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┘  same gate, no exceptions
   ↓
app.run()             the only code that writes
   ↓
planner.rank()        pure scoring
planner.place()       pure fitting, inside working hours, around sources.busy()
   ↓
google.add_block()    best effort; a failure leaves it scheduled locally
```

The important part of that diagram is the join. An event parsed out of an email is a *proposal*
and goes through the same validation as a sentence you typed. There is no second write path.

## The rules the code enforces

**The model proposes; `app.py` decides.** `brain.py` returns a frozen `Action` and has no
database access. `_sanity_check` rejects an add with no title, a reference with nothing to
reference, and an event that ends before it starts. Wrong model output becomes a question, not a
mutation.

**Nothing is booked outside your hours.** `_first_gap` builds candidate times from
`Hours.start_hour`, `end_hour`, and `weekdays`. There is no code path that produces a time
outside them, so this is structural rather than checked. Busy intervals from `sources.py` subtract
from those candidates; they never add to them.

**Unsure means ask.** `find()` in `app.py` resolves by exact id, exact title, then unique
substring. Two matches raise a 409 listing them. Zero matches returns a question. It never
picks the closest. Bulk verbs return the list for confirmation rather than acting.

**Times are UTC in the database.** The `Utc` column type converts on write and re-tags on read.
SQLite drops offsets, and without this a 3pm appointment displayed at 11pm and every due date
slid a day. It is a type rather than a convention so no future query can forget. Incoming remote
events carry their own offsets and must go through the same type.

**Remote failures never block you.** Every Google call is wrapped. If it fails the item is
still captured, still ranked, still scheduled locally. Same contract for Microsoft and for the
watcher.

**The watcher says when it last ran.** Its last-checked time is on the dashboard. It is the only
part of Cooper that can fail while nobody is watching, so it is the only part that has to report
that it is alive.

**Read-only means read-only.** `microsoft.py` and the watcher never write to the remote. Cooper
writes to exactly one remote place: blocks it placed, in Google Calendar.

## Scoring

In `planner.py`, weights summing to 1:

```
score = 0.40·due + 0.30·importance + 0.15·age + 0.15·quick
```

- `due` — 0 with no deadline, ramps over 14 days, 1.0 once overdue
- `importance` — your 1–5, normalised
- `age` — how long it has been waiting, capped at three weeks
- `quick` — shorter scores higher, because finishing beats starting; no estimate sits at 0.5

Pinned items sort first regardless. Tuning these numbers is the intended way to disagree with
the ranking, and each row shows its own breakdown so you can see which term is responsible.

Teams assignments arrive with a due date and no estimate, which puts them in the ranking on the
strength of their deadline alone. That is correct and needs no special case.

## Placement

Greedy, earliest fit, in ranked order. Blocks are 20–90 minutes with a 10 minute gap, capped
per day, starting no sooner than 15 minutes from now. A task with no estimate is skipped rather
than guessed at.

That last sentence is why errands work without new code: `buy milk` has no estimate, so it is
ranked and shown but never given a block.

## Security

One user on one machine today, so no login. That is only safe on localhost, so:

- bind `127.0.0.1`
- every route except `/health` and the OAuth callback needs `X-Cooper-Key`
- CORS pinned to one origin
- the Google refresh token is encrypted with Fernet before it touches the database
- the refusal is *returned* from middleware, not raised — exception handlers do not run for
  middleware, so raising would surface as a 500

The shared key is one user's front door, not authentication. Do not extend it into a pretend
version of one. Real accounts arrive with Postgres and hosting, as one piece of work.

**Gmail is a restricted scope.** Reading mail is among the heaviest permissions Google grants.
Free in testing mode for a single developer; a published multi-user app requires a paid annual
third-party security assessment. Ask for the narrowest read scope that works, never request
send, and never log a message id or a body.

## What is deliberately absent

No outbox, no job scheduler, no circuit breaker, no quota governor, no mutation ledger, no
reranker, no layered `core`/`services`/`adapters` split, no import contract, no WAL tuning. The
previous version had every one of them. Each was defensible in isolation and together they made
a personal calendar app impossible to hold in your head.

`watcher.py` is a timer and a loop, and it is the only concession on this list. It is not the
beginning of a job system. If it grows a retry policy with backoff tiers, a dead letter path, or
a second consumer, that is the old version returning and it should be deleted.
