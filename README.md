# Cooper

A calendar you talk to. Type what's on your plate, it works out the task and the time, tells
you what to do first, and puts it in your Google Calendar.

Runs on your machine for one person, or as a small public deployment for approved friends and
family with Firebase Authentication.

```
you: write the quarterly report, 90m, important, due friday
     → task, 90 minutes, importance 4, due Friday

you: dentist thursday 3pm
     → event, Thursday 15:00, in your calendar

you: plan my day
     → 4 blocks placed inside your working hours

you: done quarterly
     → closed, by partial title

you: undo
     → put back
```

## What it is

Four things, and deliberately nothing else:

1. **Say it plainly.** One sentence becomes a task or an event.
2. **Know what's first.** A score ranks your tasks and each row explains itself.
3. **Get it booked.** The top of that list lands in real time, inside hours you chose.
4. **Change your mind.** Undo the last thing.

Four screens: **Home** (your day at a glance, where it opens, and the full ranked list),
**Chat** (where you talk to it), **Calendar** (a day, week or month of what's booked),
**Settings**.

Light by default, because a calendar is a document. Dark and "follow my machine" are both one tap
away under Settings.

Installs as a PWA and opens offline. Phone gets a bottom tab bar, desktop gets a side rail.

## Tasks and events are different, and that's the whole idea

An **event** already has a time. The dentist chose it, not you. It goes straight on the calendar.

A **task** has no time yet — just a size and a deadline. `write the report, 90m, due friday`
tells you what and when-by, but not _when_. So tasks wait in a ranked list until you say
"plan my day", and then Cooper finds real gaps in your working hours and drops them in.

That's why there's a list _and_ a calendar. The list lives on Home, ranked, and the calendar is
when you pay it. The list is what you owe; the calendar is when you pay it.

An errand is just a task you never sized. `buy milk` gets ranked and shown, and never eats a
calendar block, because Cooper skips anything with no estimate rather than inventing one.

## Its own calendar, or yours

Cooper has a calendar of its own and needs nothing to work. Connect Google and two things change:
your real events start blocking the scheduler, and booked work shows up in Google Calendar. The
Calendar screen shows both — filled entries are ones Cooper placed, outlined ones came from you.

Local is always the source of truth. Google is a mirror.

## Colour means something

Everything lands in one of four categories, worked out from what you typed: **academics**,
**work**, **organizations**, **personal**. That is the colour you see on the calendar, so a week
is readable before you read any of it. Fill still says who put it there — solid is Cooper's,
outlined is yours.

```
you: revise for the midterm, 2h    → academics
you: client meeting tuesday 2pm    → work
you: committee rehearsal wed 6pm   → organizations
you: dentist thursday 3pm          → personal
```

Nothing to configure, and no fifth category to invent. Anything unrecognised is personal, which
is a better default than a wrong guess.

Green and red are not on that list on purpose. They mean the same two things everywhere: green is
done or added, red is deleted. So a reply in the chat is green when something landed, red when
something went away, blue when Cooper answered a question rather than doing something, and amber
when it needs you.

## Two ways to talk to it

Chat has a **Form** and an **Ask** switch, and Form is the default.

Form is structured capture. It runs offline, costs nothing, and never calls a model. Ask hands the
sentence to Gemini and can also answer questions about your own tasks:
"what should I focus on this week", "is there room for the gym tomorrow". Answers are text only —
they can never change your calendar, and Cooper declines anything that is not about your own work.

AI mode also turns one sentence describing several related things — "research, then slides, then
practice, all due Friday" — into several tasks at once, each booked so it does not start before
the one before it ends. It is still one undo, the same as adding one task: a batch is additive,
not a project plan, and there is no dependency this app remembers between the tasks it created.

Form exists because most captures do not need a model. It is the default, runs offline, and spends
no Gemini quota. Paste your own Gemini key into Settings when you want Ask mode. The key stays in
that browser and is sent only with Ask messages. The server-side Gemini key path has been removed,
so a hosted app cannot silently share one person's AI quota with every browser. Without a browser
key the Ask switch disables itself and everything else still works.

The Gemini provider and account control the actual quota. Cooper keeps usage small with the Manual
default, a rules fast path for obvious commands, one bounded repair attempt, short output caps,
and a small answer context. Those limits reduce avoidable calls, but the app cannot guarantee
1,000 requests per day.

## What it is not

Not a team tool. Accounts are only identity and data isolation; there is no sharing, no projects,
no boards, no reports, no streaks.
No audit log, because nobody audits their own calendar. If a feature only makes sense with a
second user, it does not belong here.

## What's coming

The local capture form and the Google ecosystem are built. The remaining requirement-7 sources
are deliberately future work and will plug into the same busy-time pipe:

**Commitments you made elsewhere.** Meetings and classes and events you RSVP'd to should block
your time before Cooper schedules anything into it. Four sources, one idea:

| Source          | What arrives                                              |
| --------------- | --------------------------------------------------------- |
| Google Calendar | your events — _works today_                               |
| Outlook / Teams | your meetings — _future_                                  |
| Teams classes   | assignments, which join the ranked list — _future_        |
| Gmail           | Luma, Meetup and Eventbrite confirmations — _works today_ |

Luma, Meetup and Eventbrite aren't integrated directly — they email you, so Gmail is the bridge
and one connection covers all three.

Everything except assignments arrives as the same thing: time already spoken for. Assignments are
tasks with due dates, so the existing score handles them with no special case. The Gmail watcher
is read-only, reconciles moves and cancellations, and exposes its last check in Settings. Bulk
verbs still need their conversation surface in AI mode.

Read-only, all of it. Cooper never RSVPs for you and never creates a meeting.

Accounts and multi-user tenancy now exist only for a small approved audience. SQLite stays the
local default; hosted public use needs PostgreSQL because Cloud Run instances are disposable.

## Running it

You need Python 3.12, [uv](https://docs.astral.sh/uv/), and Node 20+.

```bash
uv sync
python -c "import secrets; print(secrets.token_urlsafe(24))"   # your key
printf 'COOPER_SHARED_KEY=<key>\nCOOPER_TIMEZONE=Asia/Singapore\n' > .env
uv run uvicorn cooper.app:app --reload --host 127.0.0.1

# second terminal
cd frontend && npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

That's the whole local setup. SQLite is created automatically, and no Gemini key is required unless
you want Ask mode. If you are testing a migration explicitly, run `uv run alembic upgrade head`.

### Public Firebase deployment

The public path is Firebase Hosting for the Vite app, Firebase Authentication for Google sign-in,
Cloud Run for FastAPI, and PostgreSQL for durable state. Firebase Auth identifies the person; it
does not grant Calendar or Gmail access. Each signed-in user connects Google separately from
Settings, and those Calendar/Gmail refresh tokens are encrypted per owner.

1. In Firebase, create a project, enable Authentication, and enable the Google provider.
2. Add only the friends/family emails you allow to `COOPER_ALLOWED_EMAILS`.
3. In Google Cloud, enable Calendar API and Gmail API, then create a Web application OAuth client.
4. Add this OAuth callback exactly: `https://<firebase-site>.web.app/api/google/callback`.
5. Create a Supabase project. Supabase Postgres is the recommended beta database; set the
   server-only `COOPER_DATABASE_URL` to its `postgresql+psycopg://...` Supabase pooler URL.
   Cloud SQL remains the single-provider alternative when keeping identity, compute, and data
   in Google Cloud matters more than the lowest setup cost.
6. Deploy the Dockerfile to Cloud Run service id `cooper-api` in `asia-southeast1`.
7. Set Cloud Run secrets/env: `COOPER_AUTH_MODE=firebase`, `COOPER_FIREBASE_PROJECT_ID`,
   `COOPER_ALLOWED_EMAILS`, `COOPER_DATABASE_URL`, `COOPER_ORIGIN`, Google OAuth values,
   `COOPER_ENCRYPTION_KEY`, `COOPER_OAUTH_STATE_SECRET`, and `COOPER_SYNC_SECRET`.
8. Deploy Firebase Hosting with `firebase.json`; `/api/**` and the OAuth callback rewrite to
   Cloud Run, while the frontend uses same-origin API paths and Firebase's reserved public config.
9. Add Cloud Scheduler to POST `/api/internal/google/sync` with `X-Cooper-Sync-Secret`.

Cloud Run runs `alembic upgrade head` before starting Uvicorn. Local Uvicorn stays bound to
`127.0.0.1`; the Dockerfile's `0.0.0.0` listener is only for Cloud Run's assigned container port.

Firebase's Spark plan is fine for experimenting with Auth and Hosting, but this architecture needs
Cloud Run and PostgreSQL. Linking billing upgrades the project to Blaze. Supabase's free database
is a good beta fit, but its inactive projects can pause and it does not include automatic backups;
export or upgrade before treating it as the only copy of important data. Set budget alerts before
inviting people. Gmail readonly is a restricted scope: personal/testing use is free, but a
published app for broad public users can require Google's paid security assessment.

### Optional: better parsing

Create a Gemini key in [AI Studio](https://aistudio.google.com/apikey), then paste it into
Settings in the browser that should use Ask mode. Without one, structured Form capture handles
common captures, and ranking and scheduling never use a model.

Worth knowing: on the free tier Google may use your prompts to improve their products. Cooper
sends only your own words and task titles, never event descriptions, locations, or attendees.

### Optional: Google Calendar and Gmail

```
COOPER_GOOGLE_CLIENT_ID=...
COOPER_GOOGLE_CLIENT_SECRET=...
COOPER_GMAIL_LOOKBACK_DAYS=14
COOPER_GMAIL_POLL_INTERVAL_SECONDS=300
COOPER_ENCRYPTION_KEY=...   # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Create a Google Cloud project, enable the Calendar API and Gmail API, add an OAuth client of type **Web
application**, and set the redirect to `http://127.0.0.1:8000/api/google/callback` — use
`127.0.0.1`, not `localhost`, because Google treats them as different.

Calendar uses its event scope; Gmail uses the restricted, read-only Gmail scope. That is free for
your own app in Testing mode, but a published app for other people needs Google's security review.
**The one trap:** a consent screen left in Testing mode expires refresh tokens after seven days.
Sync will stop and it will look exactly like a bug in the code. It isn't. Publish the app or
reconnect weekly. Once the Gmail watcher is configured, start one watcher with
`python -m cooper.watcher`; it checks at the fixed interval above. You can also use the protected
`POST /api/google/sync` route for one immediate check.

Without these the calendar is simply off and everything else works.

## How it's built

```
cooper/
  app.py       every route, and the only thing that writes to the database
  brain.py     sentence → validated action (Gemini, then regex)
  planner.py   what to do first, and where it fits
  db.py        three tables
  google.py    Calendar writes and Gmail reads, over REST
  sources.py   local, Google and Gmail commitment intervals
  watcher.py   fixed-interval Gmail sync entry point
  auth.py      Firebase identity verification for hosted mode
  config.py    settings
frontend/src/
  App.tsx      one screen
  Home.tsx     the dashboard: next, today, attention, waiting
  Chat.tsx     the conversation
  Calendar.tsx day, week, month
  Nav.tsx      tab bar, side rail
  Row.tsx      a task or event
  Mascot.tsx   Cooper
  theme.css    shared tokens, light and dark themes
tools/
  mascot_cutout.py  raw art in, cut-out square webp out
```

Three tables: `item` (a task or event — the difference is whether the time is fixed),
`setting`, and `change` (just enough to undo the last thing).

**The one rule worth knowing:** the model only ever _proposes_ an action. `brain.py` validates
it, `app.py` executes it. A wrong answer from Gemini gets refused, not applied. And when a
reference is ambiguous, Cooper asks rather than picking — acting on the wrong task is worse
than a question.

## Verified

```
uv run pytest                 279 passed
uv run ruff check .           clean
uv run ruff format --check .  clean
npm test -- --run             100 passed
npm run format:check          clean
npm run build                 ok
```

Also checked: Alembic upgrade against a disposable SQLite database, `/health`, and authenticated
local `/api/today` on `127.0.0.1`.

Worth knowing if you take screenshots of this: the theme is a choice under Settings, not a
reading of your machine, so a browser flag will not switch it. Chrome's `--force-dark-mode` in
particular shows you Blink's auto-inversion rather than the real dark theme.

## Docs

| File              | What's in it                                             |
| ----------------- | -------------------------------------------------------- |
| `PRD.md`          | The seven requirements, and what it must never grow into |
| `ARCHITECTURE.md` | The files, the three tables, the rules                   |
| `AGENTS.md`       | For anyone, human or otherwise, changing this code       |
| `CLAUDE.md`       | Points at `AGENTS.md`                                    |
| `docs/DESIGN.md`  | The look, and why it looks like that                     |

## Security, briefly

Local mode uses a shared key on `127.0.0.1`. Hosted mode uses Firebase ID tokens plus an email
allowlist, and every row is scoped by the verified Firebase UID. The shared key is not used in
hosted mode. A Gemini key entered in Settings stays in that browser, while Google refresh tokens
remain encrypted at rest per owner.
