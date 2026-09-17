# Solo development workflow

Cooper uses a lightweight version of the production path:

```text
Issue → Branch → Development → Tests → PR/self-review → CI → Merge → Deploy → Monitor
```

## Tickets

Use GitHub Issues for work that should be remembered. Name tickets `COOP-<issue number>` and
include the type, priority, status, context, requirements, and acceptance criteria. Use the
existing [`TODOS.md`](../TODOS.md) only for planned work that does not need an issue yet; promote
it to a ticket before implementation.

Keep priorities simple:

- **P0:** production is unavailable, data is at risk, or a security issue needs immediate action.
- **P1:** an important user path is broken or launch is blocked.
- **P2:** useful planned work with a safe workaround.
- **P3:** polish or long-term cleanup.

## Branches and commits

`main` is the production branch. Create a branch from `main` for meaningful work using one of:
`feat/`, `fix/`, `chore/`, `refactor/`, or `hotfix/`, followed by a short description. Keep each
branch focused on one ticket or closely related fix.

Use a Conventional Commit subject, for example `fix: prevent duplicate scheduling`. Explain why
in the body when the reason is not obvious from the diff. Do not commit secrets, `.env` files,
database files, provider tokens, or generated build output.

## Pull requests and CI

Every pull request targets `main`. A pull request is the solo self-review checkpoint: complete the
PR template, read the diff as a reviewer, link the ticket, and record tests and screenshots. Keep
the change small enough to review in one sitting.

The GitHub workflow runs backend tests/lint/format checks, lock and dependency checks, frontend
tests/format/build checks, and a production dependency audit on pull requests. Firebase Hosting
and the optional Render deploy trigger run only after a push to `main` or a manual workflow run
from `main`. Configure the Render service to deploy **after CI checks pass**; the repository cannot
set that dashboard option.

## Release and rollback

Merge only after the pull request checks pass. The `main` workflow deploys the verified frontend
bundle to Firebase Hosting and optionally triggers the Render API deploy. After deployment, check
the Firebase site, Render `/health`, authentication, and one representative read/write flow.

If a deployment is broken, stop or roll back the Render service and Firebase Hosting release to
the last known good commit, then record the incident and follow-up ticket. Database changes are
applied by Alembic during the Render container start; use [`RECOVERY.md`](RECOVERY.md) before
restoring a database or changing `COOPER_DATABASE_URL`.

## Incident loop

```text
Detect → Assess → Mitigate → Resolve → Review
```

Write a short note for incidents that affect users or data. Record what happened, the time window,
impact, mitigation, root cause, and follow-up `COOP-*` tickets. Keep the note blameless and never
include credentials, tokens, email bodies, message IDs, or private user content.
