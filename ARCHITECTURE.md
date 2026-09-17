# Architecture

The small set of files below does everything that exists today. Read them in this order and you
will understand the whole app in about twenty minutes. Future integrations are marked explicitly;
nothing below describes code that is not there.

## Backend, today

```
cooper/
  auth.py      ~90 lines   Firebase ID-token verification for hosted mode
  config.py   ~140 lines   local/shared-key and hosted/Firebase settings
  db.py       ~340 lines   three owner-scoped tables, a session helper, the UTC column type
  brain.py    ~380 lines   sentence → validated Action (Gemini, then regex)
  planner.py  ~215 lines   rank() and place(); pure, no I/O, no model
  google.py   ~390 lines   Calendar and Gmail over REST; no SDK
  icloud.py   ~120 lines   Read-only iCloud calendars over CalDAV
  mcp.py      ~90 lines    Bounded tool schemas and MCP result shapes
  sources.py  ~100 lines   one busy-time pipe for every commitment source
  watcher.py  ~250 lines   one fixed Gmail sync timer
  app.py      ~1,450 lines every route; the only thing that writes to the database
```

## Backend, future

Microsoft Teams and Google Classroom remain separate future read-only integrations. Meetings
would add busy intervals; assignments would add ranked tasks.

```
cooper/
  microsoft.py Graph over REST; meetings when an Azure app is configured
  classroom.py assignments when a Google Classroom grant is configured
```

`sources.py` turns every commitment into one list of busy intervals the planner routes around.
Today it combines Google Calendar, read-only iCloud calendars, Cooper's own blocks, and
reconciled Gmail confirmations.
`watcher.py` reads Gmail on one fixed interval and reports its last check through the dashboard;
it never writes directly. Requirement 6's form reuses the existing add path rather than adding a
second writer.

## Operational verification

The owner manually verified the Google Calendar and iCloud Calendar acceptance flows on
2026-09-14. The repeatable checklist and the privacy-safe verification record are in
`docs/LIVE_PROVIDER_ACCEPTANCE.md`; do not infer live provider readiness from transport mocks or
unit tests alone.

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
  Form.tsx          Manual mode as fields rather than a sentence — the built requirement 6
  AvailabilitySettings.tsx weekday windows, overnight hours, breaks, and daily limits
  Chat.tsx          the conversation, grouped into runs like a messages app
  Calendar.tsx      day, week and month, coloured by category
  Nav.tsx           top bar, bottom tabs, and the wide-screen rail
  Row.tsx           a task or event, with its score breakdown
  Mascot.tsx        Cooper, one name per file in public/assets/mascot
  api.ts            the only place that calls the backend
  types.ts          mirrors what app.py returns
  theme.css         tokens, light and dark
```

The frontend can run in local mode with `X-Cooper-Key` or hosted mode with Firebase Google or verified email/password sign-in.
Firebase sign-in only identifies the user; Google Calendar, Gmail, and iCloud access are separate
Settings connections. Google uses OAuth, while iCloud uses an encrypted app-specific password.

The browser resolves its public configuration at startup: Firebase Hosting supplies the Firebase
Web config through `/__/firebase/init.json`, while local Vite development keeps the browser on
same-origin `/api` paths and attaches the backend key in the development proxy. A frontend
environment file is therefore optional compatibility input, not part of the normal setup.

`Form.tsx` posts to `POST /api/items`, which builds an `Action` by hand, hands it to the same
`add` the sentence path uses, and runs it through the public `validate` in `brain.py`. The form
needs no model, but placement checks any calendars the user connected. A typed
task is booked and undone in Cooper's calendar exactly like a parsed one, and `app.py` is still the
only writer. Bulk verbs are `POST /api/bulk/match` (lists hits, writes nothing) and `POST
/api/bulk` (acts on confirmed ids, one change row for the batch); `undo_last` has a `bulk` branch
that restores every snapshot in a single step.

`Home.tsx` reuses `Row.tsx` and the `slot` classes from `Calendar.tsx`, because the dashboard is a
new arrangement of things that already render rather than a new set of components. The one piece
of real logic in it is deciding what counts as today, which is done from the local calendar day so
it cannot drift with the viewer's zone.

## Data

Three tables today, all owner-scoped.

**`item`** — a task _or_ an event. The only difference is whether the time is fixed, so they
share a table. Splitting them into `task` and `scheduled_block` is what made the previous
version sprawl.

```
id kind title notes minutes importance due category
start_at end_at google_event_id
status pinned created_at done_at
```

Owned external columns:

```
owner_id      who this belongs to; one value today, cheap now and brutal later
source        where it came from: "me" or the read-only Gmail bridge
source_ref    the provider event reference, so a move or cancellation finds it again
```

`google_event_id` and `source_ref` are not the same thing and must not be merged.
`google_event_id` identifies a legacy event Cooper previously wrote. Cooper no longer creates or
deletes such blocks. `source_ref` identifies an event Cooper read. A linked Google copy is hidden
only when its title, time, and description still match the Cooper item; changed copies remain
visible and busy.

**`setting`** — `(owner_id, key)` value. Working hours, the encrypted Google token, durable OAuth
nonce, Gmail watcher health, and the watcher's last-checked marker.

**`change`** — `owner_id`, `label`, `item_id`, `before`. Enough to undo the last thing, pruned to
twenty rows per owner. Not an audit log.

### Databases

SQLite remains the local default, via SQLAlchemy. Hosted mode uses PostgreSQL by setting
`COOPER_DATABASE_URL`; Supabase Postgres is the recommended beta provider and Cloud SQL remains
the single-provider Google Cloud alternative. Use a server-only Supabase pooler connection for
runtime traffic and keep the connection string out of the browser. Alembic owns schema upgrades
for both; `create_all` only makes a fresh local database convenient. Write no database-specific
SQL from here on.

Supabase is storage only in this architecture. Supabase Auth is not used: Firebase Auth identifies
the person and FastAPI verifies the Firebase ID token. Supabase Storage is not used: Cooper stores
tasks, events, settings, and undo state in PostgreSQL, and has no file-upload requirement.

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
planner.place()       pure fitting, inside chosen availability, around complete source reads
   ↓
Cooper item time      saved locally; no provider write
```

Ask can also enter a bounded Gemini function-calling loop. The Ask path exposes only read tools;
it cannot apply a plan or refresh Gmail. `app.py` validates tool arguments and derives the owner
from authentication; provider credentials never enter tool arguments or results. A separate
authenticated `apply_plan` tool can save a plan. `app.py` remains the only database writer.

The important part of that diagram is the join. An event parsed out of an email is a _proposal_
and goes through the same validation as a sentence you typed. There is no second write path.

## The rules the code enforces

**The model proposes; `app.py` decides.** `brain.py` returns a frozen `Action` and has no
database access. `_sanity_check` rejects an add with no title, a reference with nothing to
reference, and an event that ends before it starts. Wrong model output becomes a question, not a
mutation.

**Nothing is booked outside your availability.** `planner.place()` expands weekday windows into
UTC intervals, including overnight and 24-hour windows. Existing local tasks count toward daily
block and minute limits. Busy intervals from `sources.py` subtract from candidates; they never
add to them. A slot must fit the exact requested duration and finish before its deadline.

**Unsure means ask.** `find()` in `app.py` resolves by exact id, exact title, then unique
substring. Two matches raise a 409 listing them. Zero matches returns a question. It never
picks the closest. Bulk verbs return the list for confirmation rather than acting.

**Times are UTC in the database.** The `Utc` column type converts on write and re-tags on read.
SQLite drops offsets, and without this a 3pm appointment displayed at 11pm and every due date
slid a day. It is a type rather than a convention so no future query can forget. Incoming remote
events carry their own offsets and must go through the same type.

**A failed connected calendar read cannot create a false free slot.** The item is captured and
ranked, but waits unscheduled with a reason until availability can be checked. With no calendars
connected, local scheduling proceeds normally. The watcher reports its own health separately.

**The watcher says when it last ran.** Its last-checked time is on the dashboard. It is the only
part of Cooper that can fail while nobody is watching, so it is the only part that has to report
that it is alive.

**Read-only means read-only.** Google Calendar, iCloud, and the watcher provide commitments.
Cooper writes new items only to its own database and calendar, and preserves legacy Google copies.

## Scoring

In `planner.py`, weights summing to 1:

```
score = 0.60·due + 0.15·age + 0.25·quick
```

- `due` — 0 with no deadline, ramps over 14 days, 1.0 once overdue
- `importance` — stored on the item; it does not currently affect the score
- `age` — how long it has been waiting, capped at three weeks
- `quick` — shorter scores higher, because finishing beats starting; no estimate sits at 0.5

Pinned items sort first regardless. Tuning these numbers is the intended way to disagree with
the ranking, and each row shows its own breakdown so you can see which term is responsible.

Teams and Classroom assignments do not arrive yet. Their future ranking needs its own review.

## Placement

Greedy, earliest fit, in ranked order. A block keeps the exact requested duration as one
continuous session. Breaks, maximum blocks, and daily task minutes are configurable; placement
starts no sooner than 15 minutes from now. A task with no estimate is skipped rather than guessed
at. A connected calendar must be available before any new slot is committed.

That last sentence is why errands work without new code: `buy milk` has no estimate, so it is
ranked and shown but never given a block.

## Security

Local mode is one user on one machine, protected only by a shared key. That is only safe on
localhost, so:

- bind `127.0.0.1`
- every route except `/health` and the OAuth callback needs `X-Cooper-Key`
- CORS pinned to one origin
- Google refresh tokens and iCloud app-specific passwords are encrypted with Fernet before storage
- the refusal is _returned_ from middleware, not raised — exception handlers do not run for
  middleware, so raising would surface as a 500

The shared key is one user's front door, not authentication. Do not extend it into a pretend
version of one.

Hosted mode uses Firebase Authentication with open email/password registration or Google sign-in.
The browser sends `Authorization: Bearer <Firebase ID token>`, `auth.py` verifies it lazily with
Firebase Admin, and `app.py` scopes every query and change by the verified UID. A separate
owner-bound Google OAuth grant supplies Calendar and Gmail
access. The OAuth callback is protected by signed, durable, one-use state because Firebase cannot
attach a bearer token to Google's redirect.

Hosted requests have a short in-process abuse limit per verified UID: 120 requests per minute,
with five Google sync or iCloud connection attempts per minute. A limit returns 429 with
`Retry-After`. This protects the current single-worker API, not multiple replicas; a scaled
deployment needs a shared edge limit. Gemini remains bring-your-own-key, with usage charged and
limited by the Google project behind each person's key. Cooper keeps no spending ledger.

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
