<div align="center">

<img src="frontend/public/assets/mascot/cooper_avatar.webp" alt="Cooper mascot" width="128" />

# Cooper

**One place for everything that takes your time, and you can talk to it.**

A personal planner for tasks, events, and errands.
It shows you what matters next and fits that work around time already promised.

[What is Cooper?](#what-is-cooper) · [Quick Start](#quick-start) · [Features](#features) · [Documentation](#documentation)

[![Status: public beta](https://img.shields.io/badge/status-public%20beta-405536?style=flat)](#quick-start)
[![Web and PWA](https://img.shields.io/badge/Web_%2F_PWA-installable-0A84FF?style=flat&logo=pwa&logoColor=white)](#features)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=111827)](https://react.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat&logo=opensourceinitiative&logoColor=white)](LICENSE)

</div>

<br>

## What is Cooper?

> **Ranked work, real times, one undo.**

Cooper is a planner for one person. Most planners stop at storage: writing something down does not
tell you what deserves the next hour, and a calendar does not tell you whether the work you agreed
to actually fits.

Three questions come up every day, and scattered lists answer none of them:

| The question                     | What Cooper does                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| **What deserves the next hour?** | A ranked list where every row can show why it sits where it does                           |
| **When can I actually do it?**   | An exact-length block inside the hours you chose, around what is already booked            |
| **What is going on today?**      | One screen with the current block, what is next, what is at risk, and what has no time yet |

Everything you add carries one of four colors:

![Academics](https://img.shields.io/badge/Academics-4f46c8?style=flat-square)
![Work](https://img.shields.io/badge/Work-0b6bd3?style=flat-square)
![Organizations](https://img.shields.io/badge/Organizations-a85508?style=flat-square)
![Personal](https://img.shields.io/badge/Personal-0f7285?style=flat-square)

The loop is short:

1. **Capture.** A sentence or the form. Neither one calls a model.
2. **Rank.** Deadline, importance, age, and effort set the order.
3. **Place.** One continuous session at its real length, inside your hours.
4. **Adjust.** Fix an estimate, move an item, or undo the last change.

> [!NOTE]
> Cooper stays small on purpose. It will not manage a team, write back to Google or iCloud, or guess
> when a request could mean two things. It asks, then acts on exactly what you confirmed.

> [!TIP]
> Run it locally, or use the hosted beta with your own sign-in. Either way it is one installable web
> app with light and dark themes.

<br>

## Quick Start

You need four things: **Python 3.12**, **Node.js 22**, **uv**, and **npm**.

1. Copy [`.env.example`](.env.example) to `.env` in the repository root. Set a fresh random
   `COOPER_SHARED_KEY` of at least 24 characters. Keep `COOPER_AUTH_MODE=local` and
   `COOPER_INCLUDED_AI_ENABLED=false`. Leave provider credentials empty. Never commit `.env`.

2. From the repository root, install and start the backend:

   ```bash
   uv sync --frozen
   uv run uvicorn cooper.app:app --reload --host 127.0.0.1 --port 8000
   ```

3. In a second terminal, starting from the repository root, start the frontend:

   ```bash
   cd frontend
   npm ci
   npm run dev
   ```

4. Open **http://127.0.0.1:5173/app**. Set your availability in Settings, then add a task in Manual
   mode with an estimate. Check its scheduled block and try Undo. A task without an estimate stays
   ranked but unscheduled.

The development proxy attaches the root `.env` shared key to API requests, so you do not need a
frontend environment file or a browser key. Keep the local API on `127.0.0.1`, never `0.0.0.0`,
because that shared key separates your local copy from the network. It is not account
authentication. The pilot uses the server timezone for every owner, and the template defaults to
`Asia/Singapore`.

<br>

## Features

- **Capture your way.** Structured fields or a plain sentence, plus built-in answers for common
  planning questions. Optional model help handles broader phrasing when it is enabled.
- **Make a realistic plan.** Breaks, deadlines, and daily limits all apply, and a priority
  recommendation is never dressed up as a confirmed time slot.
- **See one consistent day.** Home, Calendar, and planning answers read the same planning state, so
  counts and risks never disagree.
- **Use the calendars you already have.** Google Calendar and iCloud supply busy time, and Gmail
  imports supported confirmations. If a calendar cannot be checked, capture still succeeds and
  scheduling waits with a reason you can see.
- **Recover without guesswork.** Preview recovery of missed blocks before applying it, and read a
  weekly review of recent completions, unfinished work, and the next seven days.

Cooper supplies the keys for included AI, so users do not configure their own. Model help stays off
until Cooper-funded AI is enabled. The landing page marks Plus and included AI as coming soon, and
the beta needs no paid subscription.

<br>

## Tech Stack

| Area            | Technology and role                                                        |
| --------------- | -------------------------------------------------------------------------- |
| Backend         | Python 3.12, FastAPI, and Pydantic for requests and validation             |
| Frontend        | React 19, TypeScript, and Vite for the responsive web/PWA                  |
| Database        | SQLAlchemy and Alembic. SQLite locally, PostgreSQL for hosted accounts     |
| Hosted identity | Firebase Authentication with Google or verified email/password sign-in     |
| Connections     | Google Calendar/Gmail REST APIs and iCloud CalDAV                          |
| Model transport | Gemini primary and Groq availability fallback, with server-side accounting |
| Hosting         | Firebase Hosting for the frontend and Render for the API                   |

The model proposes actions and application code validates and executes them. `cooper/app.py` is the
only database writer, and ranking and scheduling stay deterministic.
[Architecture](ARCHITECTURE.md) has the code maps and request flows.

<br>

## Development

From the repository root:

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
```

From `frontend/`:

```bash
npm test -- --no-file-parallelism
npm run format:check
npm run build
```

Read [AGENTS.md](AGENTS.md) before changing code. The [workflow](docs/WORKFLOW.md) covers Issues,
branches, review, and release checks. Hosted configuration starts with
[`render.env.example`](render.env.example), and
[Architecture](ARCHITECTURE.md#authentication-and-hosting) explains the account and database
boundaries.

<br>

## Documentation

Pick the document that answers your question:

| Question                          | Read                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What should Cooper do?            | [Product requirements](PRD.md) for scope, seven requirements, and behavior contracts                                                                         |
| Where and how is it implemented?  | [Architecture](ARCHITECTURE.md) for code maps, data flows, planning, and persistence                                                                         |
| What must a contributor preserve? | [AGENTS.md](AGENTS.md) for engineering rules and stop conditions                                                                                             |
| How should the interface behave?  | [Design](docs/DESIGN.md) for layout, interactions, copy, and accessibility                                                                                   |
| How does work reach a release?    | [Workflow](docs/WORKFLOW.md) for Issues, pull requests, evidence, and deployment                                                                             |
| How are connections verified?     | [Live-provider acceptance](docs/LIVE_PROVIDER_ACCEPTANCE.md) for the checklist and dated records                                                             |
| How is data recovered?            | [Recovery](docs/RECOVERY.md) for backup, restore, and incident procedures                                                                                    |
| Why these product boundaries?     | [Web-first decision](docs/decisions/2026-09-30-web-first-product-boundary.md) and [included-AI decision](docs/decisions/2026-09-30-included-ai-providers.md) |

Active work, priority, and release gates live in the
[Cooper Project](https://github.com/users/alxxrzfyr/projects/1), not a separate Markdown backlog.

<br>

## License

Cooper is released under the [MIT License](LICENSE). Use it, fork it, and build on it. Created and
maintained by **Alex L. Berin**.
