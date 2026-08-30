# Cooper

A calendar you talk to. Type what's on your plate, it works out the task and the time, tells
you what to do first, and puts it in your Google Calendar.

Built for one person. Runs on your machine.

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

Five screens: **Home** (your day at a glance, and where it opens), **Chat** (where you talk to
it), **Plan** (what to do, ranked), **Calendar** (a day, week or month of what's booked),
**Settings**.

Light by default, because a calendar is a document. Dark and "follow my machine" are both one tap
away under Settings.

Installs as a PWA and opens offline. Phone gets a bottom tab bar, desktop gets a side rail.

## Tasks and events are different, and that's the whole idea

An **event** already has a time. The dentist chose it, not you. It goes straight on the calendar.

A **task** has no time yet — just a size and a deadline. `write the report, 90m, due friday`
tells you what and when-by, but not *when*. So tasks wait in a ranked list until you say
"plan my day", and then Cooper finds real gaps in your working hours and drops them in.

That's why there's a list *and* a calendar. The list is what you owe. The calendar is when you
pay it.

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

Manual exists because the free tier has a daily limit and most sentences do not need a model. With
no key at all the AI switch disables itself and everything else still works.

## What it is not

Not a team tool. No accounts, no sharing, no projects, no boards, no reports, no streaks.
No audit log, because nobody audits their own calendar. If a feature only makes sense with a
second user, it does not belong here.

## What's coming

Two more requirements are specified in `PRD.md` and not yet built. They are listed here so the
gap between the docs and the code is obvious rather than discovered.

**Manual mode as a form.** Right now Manual means typing a sentence and having simple rules read
it — the typing without the smartness. It should be fields: title, deadline, length, category,
importance. AI mode stays the one you talk to, and gains bulk verbs ("drop everything I finished
last week"), which show you the list before acting.

**Commitments you made elsewhere.** Meetings and classes and events you RSVP'd to should block
your time before Cooper schedules anything into it. Four sources, one idea:

| Source | What arrives |
| --- | --- |
| Google Calendar | your events — *works today* |
| Outlook / Teams | your meetings |
| Teams classes | assignments, which join the ranked list |
| Gmail | Luma, Meetup and Eventbrite confirmations |

Luma, Meetup and Eventbrite aren't integrated directly — they email you, so Gmail is the bridge
and one connection covers all three.

Everything except assignments arrives as the same thing: time already spoken for. Assignments are
tasks with due dates, so the existing score handles them with no special case.

Read-only, all of it. Cooper never RSVPs for you and never creates a meeting.

Accounts, Postgres and hosting are a separate, later, deliberate piece of work. SQLite stays until
then, because it needs no account, no bill, and no network.

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

That's the whole setup. No migrations to run, no database to create, no API keys required.

### Optional: better parsing

Set `COOPER_GEMINI_API_KEY` from [AI Studio](https://aistudio.google.com/apikey) and messier
sentences work. Without it a rule-based parser handles the common shapes, and ranking and
scheduling never used a model anyway.

Worth knowing: on the free tier Google may use your prompts to improve their products. Cooper
sends only your own words and task titles, never event descriptions, locations, or attendees.

### Optional: Google Calendar

```
COOPER_GOOGLE_CLIENT_ID=...
COOPER_GOOGLE_CLIENT_SECRET=...
COOPER_ENCRYPTION_KEY=...   # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Create a Google Cloud project, enable the Calendar API, add an OAuth client of type **Web
application**, and set the redirect to `http://127.0.0.1:8000/api/google/callback` — use
`127.0.0.1`, not `localhost`, because Google treats them as different.

**The one trap:** a consent screen left in Testing mode expires refresh tokens after seven
days. Sync will stop and it will look exactly like a bug in the code. It isn't. Publish the app
or reconnect weekly.

Without these the calendar is simply off and everything else works.

## How it's built

```
cooper/
  app.py       every route, and the only thing that writes to the database
  brain.py     sentence → validated action (Gemini, then regex)
  planner.py   what to do first, and where it fits
  db.py        three tables
  google.py    Calendar, over REST
  config.py    settings
frontend/src/
  App.tsx      one screen
  Home.tsx     the dashboard: next, today, attention, waiting
  Chat.tsx     the conversation
  Calendar.tsx day, week, month
  Nav.tsx      tab bar, side rail
  Row.tsx      a task or event
  Mascot.tsx   Cooper
  theme.css    Apple structure, Google colour, light and dark
tools/
  mascot_cutout.py  raw art in, cut-out square webp out
```

Three tables: `item` (a task or event — the difference is whether the time is fixed),
`setting`, and `change` (just enough to undo the last thing).

**The one rule worth knowing:** the model only ever *proposes* an action. `brain.py` validates
it, `app.py` executes it. A wrong answer from Gemini gets refused, not applied. And when a
reference is ambiguous, Cooper asks rather than picking — acting on the wrong task is worse
than a question.

## Verified

```
uv run pytest      130 passed
uv run ruff check  clean
npm test           68 passed
npm run build      ok
```

Checked in a browser, light and dark, at 390px and 1180px: nine sentences parsed into all four
categories, ranked, and placed inside working hours; a 3pm appointment landing at 3pm; day, week
and month each showing the same items in the same colours.

Worth knowing if you take screenshots of this: the theme is a choice under Settings, not a
reading of your machine, so a browser flag will not switch it. Chrome's `--force-dark-mode` in
particular shows you Blink's auto-inversion rather than the real dark theme.

## Docs

| File | What's in it |
| --- | --- |
| `PRD.md` | The seven requirements, and what it must never grow into |
| `ARCHITECTURE.md` | The files, the three tables, the rules |
| `AGENTS.md` | For anyone, human or otherwise, changing this code |
| `CLAUDE.md` | Points at `AGENTS.md` |
| `docs/DESIGN.md` | The look, and why it looks like that |

## Security, briefly

No login, because there is one user on one machine. That is only safe on `127.0.0.1`, so the
API requires a shared key, the origin is pinned, and the Google token is encrypted at rest.
Putting this on the internet needs real authentication first, and that is out of scope.
