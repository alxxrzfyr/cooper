# Work through the Cooper Project

Use GitHub Issues and the [Cooper Project](https://github.com/users/alxxrzfyr/projects/1) for all active work. GitHub Issue `#N` is the work identifier. Do not keep a Markdown backlog or copy Project fields into Issue prose.

Follow one lifecycle:

```text
Issue → Project triage → Ready → Branch → Development → PR → CI and runtime evidence → Merge → Deploy → Monitor → Done
```

## Capture work in an Issue

Choose the Bug, Change, or Operational gate Issue Form. State the problem or procedure, the required outcome, acceptance criteria, dependencies, risks, and verification evidence. Use a private security advisory instead of an Issue when exploit details or evidence are sensitive.

Use Project draft items only as temporary inbox notes. Convert each note to an Issue during triage or archive it.

## Triage the Issue in the Project

Set these Project fields before moving an Issue to Ready:

- **Status:** `Inbox`, `Backlog`, `Ready`, `In progress`, `In review`, `Blocked`, or `Done`.
- **Priority:** `P0`, `P1`, `P2`, or `P3`.
- **Size:** `XS`, `S`, `M`, or `L`.
- **Area:** `Product`, `Planning`, `Providers`, `AI`, `Web/UX`, `Platform/Security`, or `Operations`.

Use Priority consistently:

- `P0` means that production is unavailable, data is at risk, or a security issue needs immediate action.
- `P1` means that an important user path is broken or a committed release outcome is blocked.
- `P2` means useful planned work with a safe workaround.
- `P3` means polish or long-term cleanup.

Use Size to keep work reviewable:

- `XS` is less than half a day and one narrow change.
- `S` is about one focused day.
- `M` is two or three focused days or several coordinated files.
- `L` is too large for Ready. Split it into sub-issues first.

Keep at most one item In progress. Move an item to Blocked when progress depends on an unresolved decision or external action, and record the blocker on the Issue. Use a milestone only for committed release outcomes. Set a Target date only for a real external commitment.

## Create the branch and commits

`main` is the production branch. Create a branch from `main` for meaningful work. Start the branch name with `feat/`, `fix/`, `chore/`, `refactor/`, or `hotfix/`, followed by a short description. Keep each branch focused on one Issue or one closely related fix.

Use a Conventional Commit subject, such as `fix: prevent duplicate scheduling`. Explain why in the body when the reason is not obvious from the diff. Do not commit secrets, `.env` files, database files, provider tokens, or generated build output.

## Open the pull request and collect evidence

Target every pull request at `main`. Link the Issue with `Closes #N`, complete the pull request template, and read the diff as a reviewer. Confirm that the linked Issue acceptance criteria are satisfied. Record the tests, runtime checks, and screenshots that prove the outcome. Keep the change small enough to review in one sitting.

The GitHub workflow runs backend tests, lint and format checks, lock and dependency checks, frontend tests, format and build checks, and a production dependency audit on pull requests. Treat CI and runtime evidence as separate gates. For a UI change, record a browser check. For a provider change, record the automated transport checks and the manual live-provider acceptance in [`LIVE_PROVIDER_ACCEPTANCE.md`](LIVE_PROVIDER_ACCEPTANCE.md). Mocked provider tests do not count as live-provider evidence.

Firebase Hosting and the optional Render deploy trigger run only after a push to `main` or a manual workflow run from `main`. Configure the Render service to deploy after CI checks pass. The repository cannot set that dashboard option.

## Merge, deploy, and monitor

Merge only after the pull request checks pass and the required runtime evidence is recorded. The `main` workflow deploys the verified frontend bundle to Firebase Hosting and can trigger the Render API deploy.

After deployment, check the Firebase site, Render `/health`, authentication, and one representative read/write flow. Monitor the affected path and record the result before treating the work as Done.

## Roll back a failed deployment

If a deployment is broken, stop or roll back the Render service and the Firebase Hosting release to the last known good commit. Record the incident and create follow-up Issues in the Project.

Alembic applies database changes during the Render container start. Follow [`RECOVERY.md`](RECOVERY.md) before you restore a database or change `COOPER_DATABASE_URL`.

## Handle an incident

Follow this loop:

```text
Detect → Assess → Mitigate → Resolve → Review
```

Write a short note for an incident that affects users or data. Record what happened, the time window, the impact, the mitigation, the root cause, and the follow-up Issues. Keep the note blameless. Never include credentials, tokens, prompts, email bodies, message IDs, or private user content.
