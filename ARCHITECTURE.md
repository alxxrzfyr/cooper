# Architecture

Nine files do everything. Read them in this order and you will understand the whole app in
about twenty minutes.

## Backend

```
cooper/
  config.py    ~50 lines   settings from .env; only COOPER_SHARED_KEY is required
  db.py       ~250 lines   three tables, a session helper, the UTC column type
  brain.py    ~380 lines   sentence → validated Action (Gemini, then regex)
  planner.py  ~215 lines   rank() and place(); pure, no I/O, no model
  google.py   ~280 lines   Calendar over REST; no SDK
  app.py      ~580 lines   every route; the only thing that writes to the database
```

## Frontend

```
frontend/src/
  App.tsx           one screen: hero, list, composer
  Row.tsx           a task or event, with its score breakdown
  HoursSheet.tsx    when you may be booked
  Mascot.tsx        the otter, sized from the manifest
  api.ts            the only place that calls the backend
  types.ts          mirrors what app.py returns
  theme.css         tokens, light and dark
```

## Data

Three tables. That is the whole schema.

**`item`** — a task *or* an event. The only difference is whether the time is fixed, so they
share a table. Splitting them into `task` and `scheduled_block` is what made the previous
version sprawl.

```
id kind title notes minutes importance due
start_at end_at google_event_id
status pinned created_at done_at
```

**`setting`** — key/value. Working hours, and the encrypted Google refresh token.

**`change`** — `label`, `item_id`, `before`. Enough to undo the last thing, pruned to twenty
rows. Not an audit log.

There is no migration tool. `Store.__init__` calls `create_all`, which is the right amount of
ceremony for three tables owned by one person.

## The flow

```
you type
   ↓
POST /api/say
   ↓
brain.read()          Gemini with a JSON schema, one retry, then regex
   ↓                  returns Action(verb=…) — never touches the database
_sanity_check()       refuses anything unexecutable; unsure becomes verb="ask"
   ↓
app.run()             the only code that writes
   ↓
planner.rank()        pure scoring
planner.place()       pure fitting, inside working hours only
   ↓
google.add_block()    best effort; a failure leaves it scheduled locally
```

## The rules the code enforces

**The model proposes; `app.py` decides.** `brain.py` returns a frozen `Action` and has no
database access. `_sanity_check` rejects an add with no title, a reference with nothing to
reference, and an event that ends before it starts. Wrong model output becomes a question, not a
mutation.

**Nothing is booked outside your hours.** `_first_gap` builds candidate times from
`Hours.start_hour`, `end_hour`, and `weekdays`. There is no code path that produces a time
outside them, so this is structural rather than checked.

**Unsure means ask.** `find()` in `app.py` resolves by exact id, exact title, then unique
substring. Two matches raise a 409 listing them. Zero matches returns a question. It never
picks the closest.

**Times are UTC in the database.** The `Utc` column type converts on write and re-tags on read.
SQLite drops offsets, and without this a 3pm appointment displayed at 11pm and every due date
slid a day. It is a type rather than a convention so no future query can forget.

**Calendar failures never block you.** Every Google call is wrapped. If it fails the item is
still captured, still ranked, still scheduled locally. The calendar catches up next time.

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

## Placement

Greedy, earliest fit, in ranked order. Blocks are 20–90 minutes with a 10 minute gap, capped
per day, starting no sooner than 15 minutes from now. A task with no estimate is skipped rather
than guessed at.

## Security

One user on one machine, so no login. That is only safe on localhost, so:

- bind `127.0.0.1`
- every route except `/health` and the OAuth callback needs `X-Cooper-Key`
- CORS pinned to one origin
- the Google refresh token is encrypted with Fernet before it touches the database
- the refusal is *returned* from middleware, not raised — exception handlers do not run for
  middleware, so raising would surface as a 500

Exposing this to the internet needs real authentication first. That is a different project.

## What is deliberately absent

No outbox, no job scheduler, no circuit breaker, no quota governor, no mutation ledger, no
reranker, no layered `core`/`services`/`adapters` split, no import contract, no WAL tuning. The
previous version had every one of them. Each was defensible in isolation and together they made
a personal calendar app impossible to hold in your head.
