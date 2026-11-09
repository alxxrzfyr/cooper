# Development and release workflow

GitHub Issues identify work. The [Cooper Project](https://github.com/users/alxxrzfyr/projects/1)
owns triage and release status. Keep durable contracts in Git, not a Markdown backlog or copies of
Project fields in Issue prose. Read [AGENTS.md](../AGENTS.md) for engineering constraints.

```text
Issue → Triage → Ready → Branch → Development → PR → Evidence → Merge → Deploy → Monitor → Done
```

## 1. Capture and triage

Use the Bug, Change, or Operational gate Issue Form. Describe the problem or procedure, outcome,
acceptance criteria, dependencies, risks, and required evidence. Sensitive exploit details belong
in a private security advisory. Convert Project drafts to Issues during triage or archive them.

Before Ready, set:

| Field    | Values and meaning                                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status   | Inbox, Backlog, Ready, In progress, In review, Blocked, Done                                                                                                                |
| Priority | P0 means outage, data loss, or security. P1 means a broken important path or blocked release. P2 means useful work with a workaround. P3 means polish or long-term cleanup. |
| Size     | XS means under half a day. S means one focused day. M means two to three days or coordinated files. L must be split before Ready.                                           |
| Area     | Product, Planning, Providers, AI, Web/UX, Platform/Security, Operations                                                                                                     |

Keep at most one item In progress. Record external or decision blockers on the Issue and mark it
Blocked. Use milestones for committed release outcomes and Target dates only for external
commitments.

## 2. Branch and implement

- Never commit directly to production branch `main`. Start focused work from the latest
  `origin/main` and use a `feat/`, `fix/`, `docs/`, `test/`, `chore/`, `refactor/`, or `hotfix/`
  prefix.
- Use Conventional Commits, such as `fix: prevent duplicate scheduling`, and explain why in the body.
- Never commit secrets, `.env`, databases, tokens, or generated build output.
- Push with `git push -u origin <branch>` and open with `gh pr create --base main` only when
  authorized to publish the work. Never force-push, merge, or deploy without explicit owner
  approval.

## Local checks

Setup is in [README.md](../README.md#quick-start). Run backend checks from the repository root:

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv lock --check
uv pip check
git diff --check
```

Run frontend checks from `frontend/`:

```bash
npm test -- --no-file-parallelism
npm run format:check
npm run build
npm audit --omit=dev --audit-level=high
```

CI runs these checks on pull requests. Do not replace behavioral tests with source-wording or
copied-constant assertions. Docs-only changes need formatting, link and anchor, command and claim,
and diff checks. Record unrun or inapplicable checks explicitly rather than marking every checkbox
passed.

## 3. Review and collect evidence

Target `main`, link `Closes #N`, complete the [PR template](../.github/pull_request_template.md),
and review the diff. `N/A` is only for mechanical maintenance that needs no tracked Issue. Keep the
change reviewable in one sitting and record acceptance evidence separately:

| Gate       | Required evidence                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated  | Relevant behavior and failure tests, CI checks, and build results                                                                                     |
| Runtime/UI | Run the app and inspect affected flows. Capture screenshots for visible changes.                                                                      |
| Providers  | Automated transport and API checks **and** manual connected-account acceptance recorded in [LIVE_PROVIDER_ACCEPTANCE.md](LIVE_PROVIDER_ACCEPTANCE.md) |

Mocked provider tests are not live acceptance. A browser fixture is not proof of a connected
calendar. Do not merge until required checks and evidence are recorded.

## 4. Deploy and monitor

After owner approval, the [`main` workflow](../.github/workflows/deploy.yml) deploys the verified
frontend artifact to Firebase Hosting and optionally triggers Render. Deploy jobs run only on pushes
to `main` or manual workflow runs from `main`, never pull requests. Configure Render's dashboard to
deploy after CI passes. The repository cannot enforce that option.

The Render container applies Alembic migrations before serving. Before schema or data recovery or a
database URL change, follow [RECOVERY.md](RECOVERY.md).

After deploying, check the Firebase site, Render `/health`, authentication, and a representative
read and write flow. `/health` covers database access, not calendar or AI readiness. Monitor the
affected path and record the result before marking Done.

## Rollback and incidents

For a failed deployment, stop or roll back Render and Firebase Hosting to the last known good
commit. Do not assume rolling back code reverses a migration. Use the recovery guide before any
database restoration. Record the incident and follow-up Issues in the Project.

```text
Detect → Assess → Mitigate → Resolve → Review
```

For user or data impact, record the time window, impact, mitigation, root cause, and follow-up
Issues in a short, blameless note. Never include credentials, tokens, prompts, email bodies, message
IDs, or private user content.
