# GitHub Projects workflow migration

Date: 2026-10-07
Status: Approved in conversation; implementation not started
Owner: `alxxrzfyr`
Repository: `alxxrzfyr/cooper`

## Purpose

Make GitHub Issues and one GitHub Project the source of truth for active work. Keep Markdown only for durable product, architecture, decision, design-system, and operational knowledge.

The `origin/main` baseline tracks 49 Markdown files. Thirty-nine are under `docs/`. Many old plans still contain unchecked tasks after their code shipped, while GitHub has no Issues or milestones. This leaves current work scattered across stale status prose and increases the context required to understand the app.

## Goals

- Track every active or planned work item as a GitHub Issue.
- Use one Project for status, priority, size, area, release grouping, blockers, and sequencing.
- Preserve only durable facts in the repository.
- Reduce tracked Markdown from 49 files to about 13.
- Keep merged pull requests and Git history as the record of completed implementation.
- Give one developer a real Kanban workflow without sprint ceremony.

## Non-goals

- Do not backfill Issues for completed work.
- Do not introduce Scrum iterations, story points, velocity, or artificial deadlines.
- Do not move product requirements, architecture, security boundaries, or runbooks out of Git.
- Do not copy Project fields into Issue prose or Markdown tables.
- Do not activate funded AI, billing, GCP, Teams, or Classroom as part of this migration.
- Do not change application behavior, dependencies, schemas, deployments, or secrets.

## Sources of truth

| Information                                                     | Canonical home                     |
| --------------------------------------------------------------- | ---------------------------------- |
| Status, priority, size, area, target date, blockers, sequencing | GitHub Project fields              |
| Problem, outcome, acceptance criteria, dependencies             | GitHub Issue                       |
| Large outcome with independent deliverables                     | Parent Issue and sub-issues        |
| Release objective                                               | GitHub Milestone                   |
| Implementation and review evidence                              | Pull request linked to its Issue   |
| Product requirements and non-goals                              | `PRD.md`                           |
| Current implementation and boundaries                           | `ARCHITECTURE.md`                  |
| Engineering constraints                                         | `AGENTS.md`                        |
| Lasting architecture decisions                                  | `docs/decisions/*.md`              |
| Visual rules                                                    | `docs/DESIGN.md`                   |
| Workflow                                                        | `docs/WORKFLOW.md`                 |
| Recovery procedure                                              | `docs/RECOVERY.md`                 |
| Live provider checklist and evidence                            | `docs/LIVE_PROVIDER_ACCEPTANCE.md` |

A Project draft item is an inbox note only. Triage converts it to an Issue or archives it. GitHub Issue `#N` is the work identifier; no manual `COOP-___` identifier remains.

## Project

Create one private user-owned GitHub Project:

- **Title:** Cooper
- **Owner:** `alxxrzfyr`
- **Repository:** `alxxrzfyr/cooper`
- **Description:** Active product, engineering, security, and release work for Cooper.

The Project README links to `PRD.md`, `ARCHITECTURE.md`, `AGENTS.md`, `docs/WORKFLOW.md`, `docs/RECOVERY.md`, and `docs/LIVE_PROVIDER_ACCEPTANCE.md`. It states that GitHub tracks work while Git tracks durable system knowledge.

### Fields

| Field                | Type          | Values or rule                                                          |
| -------------------- | ------------- | ----------------------------------------------------------------------- |
| Status               | Single select | Inbox, Backlog, Ready, In progress, In review, Blocked, Done            |
| Priority             | Single select | P0, P1, P2, P3                                                          |
| Size                 | Single select | XS, S, M, L                                                             |
| Area                 | Single select | Product, Planning, Providers, AI, Web/UX, Platform/Security, Operations |
| Target date          | Date          | Set only for a real external commitment                                 |
| Milestone            | Built in      | Release objective                                                       |
| Linked pull requests | Built in      | Delivery and review evidence                                            |
| Parent issue         | Built in      | Larger outcome                                                          |
| Sub-issue progress   | Built in      | Parent completion                                                       |

Size means:

- **XS:** less than half a day and one narrow change.
- **S:** about one focused day.
- **M:** two or three focused days or several coordinated files.
- **L:** too large for Ready; split it into sub-issues first.

### Views

1. **Current work** uses a board grouped by Status. It shows Ready, In progress, In review, and Blocked. The working agreement allows at most one In progress item.
2. **Backlog** uses a table grouped by Priority and sorted by Area, then Size.
3. **Roadmap** uses the roadmap layout grouped by Milestone. Only items with a real Target date appear on the timeline.
4. **Release gates** uses a table filtered to the `release-gate` label.
5. **Security** uses a table filtered to Area = Platform/Security.
6. **Recently done** uses a table of Done items retained before archival.

### Workflows

- Auto-add every new Issue from `alxxrzfyr/cooper`.
- Set newly added Issues to Inbox.
- Set closed Issues to Done.
- Set reopened Issues to Ready.
- Archive Done items after 30 days.
- Keep pull requests off the board as separate cards. A pull request links to and closes its Issue.

GitHub Free permits one auto-add workflow. Use it for `is:issue` in this repository. The remaining state changes use built-in workflows.

## Issues

### Forms

Replace `.github/ISSUE_TEMPLATE/work-item.md` with YAML Issue Forms.

**Bug** captures:

- observed behavior;
- expected behavior;
- reproduction;
- impact;
- acceptance criteria;
- verification notes.

**Change** captures:

- problem;
- required outcome;
- acceptance criteria;
- dependencies and risks;
- verification plan.

**Operational gate** captures:

- procedure or decision;
- required evidence;
- rollback or failure handling;
- acceptance criteria.

Forms may target the Project directly after its number exists. They must not request secrets, tokens, email bodies, message IDs, or private user content.

### Labels

Replace unused default labels with this bounded set:

| Label              | Purpose                                          |
| ------------------ | ------------------------------------------------ |
| `type:bug`         | Broken behavior                                  |
| `type:feature`     | New user-visible behavior                        |
| `type:maintenance` | Refactoring, dependency, or repository upkeep    |
| `type:operations`  | Deployment, provider, or release procedure       |
| `release-gate`     | Evidence required before a release or activation |
| `security`         | Security-sensitive work                          |
| `provider`         | External provider work                           |

Status, Priority, Size, and Area remain Project fields. Labels do not duplicate them.

### Issue lifecycle

1. Create an Issue through a form or convert a Project draft during triage.
2. Clarify the outcome and acceptance criteria in Inbox.
3. Set Priority, Size, Area, and any Milestone before moving the Issue to Ready.
4. Create a branch from current `main` and move the Issue to In progress.
5. Open a pull request that links the Issue and move it to In review.
6. Merge only after CI, review, and required runtime evidence pass.
7. Let the closing keyword close the Issue and the Project workflow mark it Done.
8. Reopen the Issue if the accepted outcome did not hold. Do not create a duplicate correction Issue.

## Initial active backlog

Create only unresolved work.

### Public beta hardening milestone

| Issue                                                    | Priority | Size | Area              | Labels                                             |
| -------------------------------------------------------- | -------- | ---- | ----------------- | -------------------------------------------------- |
| Bind Google OAuth completion to the initiating browser   | P0       | M    | Platform/Security | `security`, `provider`, `release-gate`, `type:bug` |
| Escape public OAuth callback output                      | P0       | S    | Platform/Security | `security`, `provider`, `release-gate`, `type:bug` |
| Pin GitHub Actions to immutable commit SHAs              | P0       | S    | Platform/Security | `security`, `release-gate`, `type:maintenance`     |
| Repeat Google and iCloud acceptance on the current build | P1       | M    | Providers         | `provider`, `release-gate`, `type:operations`      |
| Complete weekly-review browser acceptance                | P1       | S    | Planning          | `release-gate`, `type:operations`                  |
| Verify hosted PostgreSQL backup and restore              | P1       | M    | Operations        | `release-gate`, `type:operations`                  |
| Inspect production Supabase grants and RLS posture       | P1       | S    | Platform/Security | `security`, `release-gate`, `type:operations`      |
| Measure Render cold and warm startup latency             | P2       | S    | Operations        | `type:operations`                                  |
| Remove legacy planning compatibility fields              | P2       | M    | Planning          | `type:maintenance`                                 |

### Future backlog

Create parent Issues for funded AI activation, Plus billing, and the GCP cutover. Create sub-issues only for already known independent gates. Create separate Issues for reusable routines, Teams imports, and Google Classroom imports. Keep all future work in Backlog without a milestone or Target date until the owner commits to delivery.

The funded-AI parent has three sub-issues: the cash envelope; model evaluation with approved model IDs and prices; and live Gemini/Groq acceptance. Dispatch remains disabled until every activation gate closes.

## Markdown retention

### Keep

- `README.md`
- `PRD.md`
- `ARCHITECTURE.md`
- `AGENTS.md`
- `CLAUDE.md`
- `docs/DESIGN.md`
- `docs/WORKFLOW.md`
- `docs/RECOVERY.md`
- `docs/LIVE_PROVIDER_ACCEPTANCE.md`
- `docs/decisions/2026-09-30-web-first-product-boundary.md`
- `docs/decisions/2026-09-30-included-ai-providers.md`
- `.github/pull_request_template.md`
- `.kiro/steering/git-workflow.md`

### Delete after migration

- `TODOS.md`
- `docs/COOPER_REFINEMENT_SPEC.md`
- `docs/designs/*.md`
- `docs/superpowers/plans/*.md`
- `docs/superpowers/specs/*.md`, including this temporary migration specification
- `.superpowers/sdd/**/*.md`

Before deletion:

- move still-valid provider fallback and accounting invariants into `ARCHITECTURE.md` and the included-AI provider ADR;
- move unresolved work into Issues;
- update current status in `PRD.md`, `ARCHITECTURE.md`, and `README.md`;
- remove links to deleted documents;
- retain no historical summary file, because Git history and merged pull requests already preserve it.

## Repository workflow changes

Update `docs/WORKFLOW.md` to define:

```text
Issue → Project triage → Ready → Branch → Development → PR → CI and runtime evidence → Merge → Deploy → Monitor → Done
```

Update the pull request template to require `Closes #N` for normal work. Keep `N/A` only for truly mechanical maintenance that does not need tracking.

Update `AGENTS.md` so planning work starts from the Project and the linked Issue. Do not require agents to read historical plans. Update the README documentation index to list only retained files and link the Project.

## Migration sequence

1. Refresh GitHub CLI authorization with `read:project` and `project` scopes.
2. Create the Project, fields, views, and built-in workflows.
3. Create labels, the Public beta hardening milestone, and YAML Issue Forms.
4. Create the initial unresolved Issues and assign their Project fields.
5. Consolidate durable facts into retained documents.
6. Update workflow references and links.
7. Delete migrated and historical Markdown.
8. Verify every open Issue appears once in the Project and every retained document link resolves.
9. Open a pull request for repository changes. Link the migration Issue if one is created during setup.
10. After merge, use the Project as the only active-work inventory.

Create GitHub objects before deleting Markdown. A failed migration therefore leaves the current files intact. Re-running creation must first query by exact title or name so the operation does not duplicate Projects, fields, labels, milestones, or Issues.

## Permissions and security

The current GitHub token has `repo`, `read:org`, and `gist` scopes. Project inspection already fails because `read:project` is missing. Migration requires:

```bash
gh auth refresh -s read:project,project
```

This command may require interactive GitHub authorization. Do not place token values in files, Issues, logs, or chat.

Security Issues must describe the fix and acceptance boundary without publishing working exploit payloads or credentials. The repository is private, but least disclosure still applies.

## Acceptance criteria

- One user-owned Project named Cooper exists and links this repository.
- The fields, views, and workflows in this specification exist.
- Every open repository Issue appears exactly once in the Project.
- The initial backlog contains only unresolved work.
- The Public beta hardening milestone contains the named release gates.
- New Issues created through each form enter Inbox automatically.
- Closing and reopening the migration Issue exercises the expected Status changes; restore it to In progress afterward.
- The repository retains exactly 13 Markdown files and no active-work checklist.
- `TODOS.md`, historical plans, historical specs, and design review snapshots are absent from the current tree.
- Retained documents contain the durable rules formerly held only in deleted files.
- All retained local Markdown links resolve.
- The pull request template, `docs/WORKFLOW.md`, README, and `AGENTS.md` describe one consistent workflow.
- No application code, schema, dependency, deployment, or secret changes occur.
