# Cooper

A calendar you talk to. Type what's on your plate, it works out the task and the time, tells
you what to do first, and puts it in your Google Calendar.

Built for one person. Runs on your machine or as a private personal deployment.

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

Chat has a **Manual** and an **AI** switch, and Manual is the default.

Manual is the rule-based parser. It runs offline, costs nothing, and handles the sentences you
actually type. AI hands the sentence to Gemini and can also answer questions about your own tasks:
"what should I focus on this week", "is there room for the gym tomorrow". Answers are text only —
they can never change your calendar, and Cooper declines anything that is not about your own work.

AI mode also turns one sentence describing several related things — "research, then slides, then
practice, all due Friday" — into several tasks at once, each booked so it does not start before
the one before it ends. It is still one undo, the same as adding one task: a batch is additive,
not a project plan, and there is no dependency this app remembers between the tasks it created.

Manual exists because most sentences do not need a model. It is the default, runs offline, and
spends no Gemini quota. For a personal deployment, paste your own Gemini key into Settings when
you want AI mode. The key stays in that browser and is sent only with AI messages. The optional
`COOPER_GEMINI_API_KEY` environment value remains available as a private server-side fallback.
Without either key the AI switch disables itself and everything else still works.

The Gemini provider and account control the actual quota. Cooper keeps usage small with the Manual
default, a rules fast path for obvious commands, one bounded repair attempt, short output caps,
and a small answer context. Those limits reduce avoidable calls, but the app cannot guarantee
1,000 requests per day.

## What it is not

Not a team tool. No accounts, no sharing, no projects, no boards, no reports, no streaks.
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

Accounts and multi-user tenancy are a separate, later, deliberate piece of work. SQLite stays the
default because each personal deployment needs only its own persistent store.

## Running it

You need Python 3.12, [uv](https://docs.astral.sh/uv/), and Node 20+.

```bash
uv sync
python -c "import secrets; print(secrets.token_urlsafe(24))"   # your key
printf 'COOPER_SHARED_KEY=<key>\nCOOPER_TIMEZONE=Asia/Singapore\n' > .env
uv run uvicorn cooper.app:app --reload --host 127.0.0.1

# second terminal
cd frontend && npm install
printf 'VITE_COOPER_KEY=<same key>\n' > .env.local
npm run dev
```

Open `http://127.0.0.1:5173`.

That's the whole local setup. No migrations to run, no database to create, and no Gemini key is
required unless you want AI mode.

### Personal deployment

The frontend is a static Vite build, while the API remains a FastAPI service with persistent
storage. This means a static host such as Vercel or Cloudflare can serve the frontend, but the
FastAPI backend still needs a Python host and a persistent data directory. Cooper does not add a
provider-specific adapter.

1. Run the backend on a Python host with its persistent `COOPER_DATABASE_URL` and set
   `COOPER_ORIGIN` to the deployed frontend origin.
2. Build the frontend with `VITE_COOPER_API` set to the backend URL and `VITE_COOPER_KEY` set to
   the backend's shared key, then upload `frontend/dist` to the static host.
3. Open the deployed app, go to Settings, and paste the user's own Gemini API key. It is stored
   in that browser only and is included only on AI-mode requests. Manual mode needs no Gemini key.

This is still a one-person deployment: the app has no accounts or login, and the shared key is a
request guard rather than authentication. Keep the deployment private with the host's access
controls or a private URL. `VITE_COOPER_KEY` is part of a static browser build, so it must not be
treated as a secret. Leave `COOPER_GEMINI_API_KEY` blank when each browser should provide its own
key in Settings.

### Optional: better parsing

Set `COOPER_GEMINI_API_KEY` from [AI Studio](https://aistudio.google.com/apikey) for a private
server-side fallback, or paste the key into Settings for the browser that should use it. Without
either one a rule-based parser handles the common shapes, and ranking and scheduling never use a
model.

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
uv run pytest      236 passed
uv run ruff check  clean
npm test           85 passed
npm run build      ok
```

Checked in a browser, light and dark, at 390px and 1180px: nine sentences parsed into all four
categories, ranked, and placed inside working hours; a 3pm appointment landing at 3pm; day, week
and month each showing the same items in the same colours.

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

No login, because one deployment is for one person. On a hosted deployment, keep the frontend and
API private with the host's access controls; the API's shared key and pinned origin are not a
replacement for authentication. A Gemini key entered in Settings stays in that browser, while
the Google token remains encrypted at rest.
