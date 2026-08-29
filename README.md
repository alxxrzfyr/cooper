# Cadence

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

Four screens: **Chat** (where you talk to it), **Plan** (what to do, ranked), **Calendar** (a day
timeline of what's booked), **Setup**.

Installs as a PWA and opens offline. Phone gets a bottom tab bar, desktop gets a side rail.

## Its own calendar, or yours

Cadence has a calendar of its own and needs nothing to work. Connect Google and two things change:
your real events start blocking the scheduler, and booked work shows up in Google Calendar. The
Calendar screen shows both — filled entries are ones Cadence placed, outlined ones came from you.

Local is always the source of truth. Google is a mirror.

## What it is not

Not a team tool. No accounts, no sharing, no projects, no boards, no reports, no streaks.
No audit log, because nobody audits their own calendar. If a feature only makes sense with a
second user, it does not belong here.

## Running it

You need Python 3.12, [uv](https://docs.astral.sh/uv/), and Node 20+.

```bash
uv sync
python -c "import secrets; print(secrets.token_urlsafe(24))"   # your key
printf 'CADENCE_SHARED_KEY=<key>\nCADENCE_TIMEZONE=Asia/Singapore\n' > .env
uv run uvicorn cadence.app:app --reload --host 127.0.0.1

# second terminal
cd frontend && npm install
printf 'VITE_CADENCE_KEY=<same key>\n' > .env.local
npm run dev
```

Open `http://127.0.0.1:5173`.

That's the whole setup. No migrations to run, no database to create, no API keys required.

### Optional: better parsing

Set `CADENCE_GEMINI_API_KEY` from [AI Studio](https://aistudio.google.com/apikey) and messier
sentences work. Without it a rule-based parser handles the common shapes, and ranking and
scheduling never used a model anyway.

Worth knowing: on the free tier Google may use your prompts to improve their products. Cadence
sends only your own words and task titles, never event descriptions, locations, or attendees.

### Optional: Google Calendar

```
CADENCE_GOOGLE_CLIENT_ID=...
CADENCE_GOOGLE_CLIENT_SECRET=...
CADENCE_ENCRYPTION_KEY=...   # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
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
cadence/
  app.py       every route, and the only thing that writes to the database
  brain.py     sentence → validated action (Gemini, then regex)
  planner.py   what to do first, and where it fits
  db.py        three tables
  google.py    Calendar, over REST
  config.py    settings
frontend/src/
  App.tsx      one screen
  Row.tsx      a task or event
  HoursSheet.tsx  when you can be booked
  Mascot.tsx   the otter
  theme.css    Apple structure, Google colour, light and dark
```

Three tables: `item` (a task or event — the difference is whether the time is fixed),
`setting`, and `change` (just enough to undo the last thing).

**The one rule worth knowing:** the model only ever *proposes* an action. `brain.py` validates
it, `app.py` executes it. A wrong answer from Gemini gets refused, not applied. And when a
reference is ambiguous, Cadence asks rather than picking — acting on the wrong task is worse
than a question.

## Verified

```
uv run pytest      92 passed
uv run ruff check  clean
npm test           29 passed
npm run build      ok
```

Checked in a browser, light and dark: five sentences parsed, ranked, and placed at 09:00,
10:10, 11:50 and 12:20 with proper gaps; a 3pm appointment landing at 3pm.

## Docs

| File | What's in it |
| --- | --- |
| `PRD.md` | What it must do, and what it must never grow into |
| `ARCHITECTURE.md` | The six files, the three tables, the rules |
| `AGENTS.md` | For anyone, human or otherwise, changing this code |
| `CLAUDE.md` | Points at `AGENTS.md` |
| `docs/DESIGN.md` | The look, and why it looks like that |

## Security, briefly

No login, because there is one user on one machine. That is only safe on `127.0.0.1`, so the
API requires a shared key, the origin is pinned, and the Google token is encrypted at rest.
Putting this on the internet needs real authentication first, and that is out of scope.
