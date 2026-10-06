# GitHub Projects Workflow Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Markdown-based work tracking with one Project-first GitHub Kanban workflow while retaining only durable product, architecture, decision, design, and operational documents.

**Architecture:** GitHub Issues hold executable outcomes and acceptance criteria; one user-owned GitHub Project holds workflow state and planning metadata; milestones hold committed release objectives; linked pull requests hold implementation evidence. Repository Markdown keeps durable system knowledge only. Create and verify GitHub objects before deleting any source document.

**Tech Stack:** GitHub Projects v2, GitHub Issues, GitHub CLI, GitHub REST/GraphQL APIs, YAML Issue Forms, Markdown, pytest, Prettier

**Spec:** `docs/superpowers/specs/2026-10-07-github-projects-workflow-design.md`

## Global Constraints

- Use one private user-owned Project named `Cooper`, owned by `alxxrzfyr` and linked to `alxxrzfyr/cooper`.
- Migrate active and planned work only. Do not backfill completed work.
- Use Project fields for Status, Priority, Size, Area, Target date, Milestone, linked pull requests, and parent/sub-issue progress.
- Do not duplicate Project fields as labels or Markdown status tables.
- Keep product requirements, architecture, engineering constraints, visual rules, decisions, recovery procedures, and live-provider evidence in Git.
- Preserve merged pull requests and Git history as the record of completed implementation.
- Do not add iterations, story points, velocity, or dates without an external commitment.
- Do not change application behavior, dependencies, schemas, deployments, or secrets.
- Keep funded AI disabled. Do not activate billing, GCP, Teams, Classroom, or reusable routines.
- Create GitHub objects before deleting Markdown.
- Every external mutation must query exact existing state first and converge when rerun.
- Never include credentials, tokens, prompts, email bodies, message IDs, or private user content in Project or Issue data.

---

## File map

**Create temporarily during migration**

- `/tmp/cooper-github-project-migration.py` — idempotent Project, label, milestone, Issue, sub-issue, and field reconciliation. Delete after its second successful run.

**Create in the repository**

- `.github/ISSUE_TEMPLATE/bug.yml` — structured bug intake.
- `.github/ISSUE_TEMPLATE/change.yml` — structured feature, improvement, and maintenance intake.
- `.github/ISSUE_TEMPLATE/operational-gate.yml` — structured release and provider evidence intake.
- `.github/ISSUE_TEMPLATE/config.yml` — disables blank Issues and links the Project and security policy.

**Modify in the repository**

- `README.md` — current capabilities, concise documentation index, and Project link.
- `PRD.md` — current versus planned product state without plan links or roadmap tables.
- `ARCHITECTURE.md` — durable provider fallback/accounting/recovery/weekly-review contracts without historical spec links.
- `AGENTS.md` — start work from a Project Issue; remove historical-plan prerequisites.
- `docs/WORKFLOW.md` — Project-first Kanban lifecycle and field definitions.
- `docs/decisions/2026-09-30-included-ai-providers.md` — current implementation status, fallback rules, accounting invariants, and activation gates.
- `docs/decisions/2026-09-30-web-first-product-boundary.md` — remove links to deleted drafts and retain the accepted boundary.
- `.github/pull_request_template.md` — require `Closes #N` for tracked work.
- `tests/test_deployment.py` — delete the source-text test that pins the obsolete `COOP-*` Markdown template.

**Delete from the repository**

- `.github/ISSUE_TEMPLATE/work-item.md`
- `TODOS.md`
- `docs/COOPER_REFINEMENT_SPEC.md`
- `docs/designs/*.md`
- `docs/superpowers/plans/*.md`, including this plan
- `docs/superpowers/specs/*.md`, including the approved migration spec
- `.superpowers/sdd/**/*.md`

The final tracked Markdown count is 13.

---

### Task 1: Authorize GitHub Projects and create the Project shell

**Files:**

- Read: `docs/superpowers/specs/2026-10-07-github-projects-workflow-design.md`
- No repository files change.

**Interfaces:**

- Consumes: authenticated `gh` account `alxxrzfyr`, repository `alxxrzfyr/cooper`.
- Produces: one private user Project named `Cooper`, its project number, node ID, and URL.

- [ ] **Step 1: Verify the current account and missing scope**

Run:

```bash
gh auth status
gh project list --owner alxxrzfyr --format json
```

Expected before authorization: `gh auth status` names `alxxrzfyr`; Project listing fails because `read:project` is missing.

- [ ] **Step 2: Add Project authorization interactively**

Run:

```bash
gh auth refresh -s read:project,project
```

Complete the browser/device authorization without copying the token into chat, a file, an Issue, or a log.

- [ ] **Step 3: Verify Project access**

Run:

```bash
gh auth status
gh project list --owner alxxrzfyr --format json
```

Expected: the token scopes include `project`; Project listing returns JSON.

- [ ] **Step 4: Query by exact title before creating**

Run:

```bash
gh project list --owner alxxrzfyr --format json --jq '.projects[] | select(.title == "Cooper") | {number,id,title,url}'
```

Expected: either one exact Project or no output. More than one exact Project is a blocker; do not guess which one to use.

- [ ] **Step 5: Create only when absent**

If Step 4 returned no Project, run:

```bash
gh project create --owner alxxrzfyr --title Cooper --format json
```

Record the returned project number as `PROJECT_NUMBER`. Do not create a second Project if the command or session is interrupted; rerun Step 4 first.

- [ ] **Step 6: Set the Project metadata and repository link**

Prepare this exact Project README in `/tmp/cooper-project-readme.md`:

```markdown
# Cooper

Active product, engineering, security, and release work for Cooper.

GitHub Issues define executable outcomes and acceptance criteria. Project fields define workflow state and planning metadata. Git stores durable system knowledge:

- [Product requirements](https://github.com/alxxrzfyr/cooper/blob/main/PRD.md)
- [Architecture](https://github.com/alxxrzfyr/cooper/blob/main/ARCHITECTURE.md)
- [Engineering constraints](https://github.com/alxxrzfyr/cooper/blob/main/AGENTS.md)
- [Development workflow](https://github.com/alxxrzfyr/cooper/blob/main/docs/WORKFLOW.md)
- [Recovery procedure](https://github.com/alxxrzfyr/cooper/blob/main/docs/RECOVERY.md)
- [Live provider acceptance](https://github.com/alxxrzfyr/cooper/blob/main/docs/LIVE_PROVIDER_ACCEPTANCE.md)

Working agreement: one item In progress at a time. An L-sized item must be split before Ready.
```

Run:

```bash
gh project edit "$PROJECT_NUMBER" --owner alxxrzfyr --visibility PRIVATE --description "Active product, engineering, security, and release work for Cooper." --readme "$(cat /tmp/cooper-project-readme.md)"
gh project link "$PROJECT_NUMBER" --owner alxxrzfyr --repo cooper
```

Expected: `gh project view "$PROJECT_NUMBER" --owner alxxrzfyr --format json` reports title `Cooper`, private visibility, the description, and the repository link.

- [ ] **Step 7: Verify the shell in the browser**

Open the Project with `gh project view "$PROJECT_NUMBER" --owner alxxrzfyr --web`. Confirm the title, privacy, description, README links, and repository link render correctly.

---

### Task 2: Configure fields, views, and built-in workflows

**Files:**

- No repository files change.

**Interfaces:**

- Consumes: `PROJECT_NUMBER` from Task 1.
- Produces: the approved Project field schema, six saved views, and five built-in workflows.

- [ ] **Step 1: Inventory default fields**

Run:

```bash
gh project field-list "$PROJECT_NUMBER" --owner alxxrzfyr --format json
```

Expected: built-in fields such as Title, Assignees, Status, Milestone, Repository, Reviewers, Linked pull requests, Parent issue, and Sub-issues progress. Record the field IDs and current Status options.

- [ ] **Step 2: Reconcile the Status field**

In Project settings, edit Status to exactly this ordered set:

```text
Inbox
Backlog
Ready
In progress
In review
Blocked
Done
```

Rename, add, remove, and reorder options through the Status field settings. Preserve the built-in field so close/reopen workflows continue to target GitHub's Status field. Rerun `gh project field-list` and verify one Status field with the exact options and order. Stop and diagnose if GitHub refuses an option change; never create a second Status field.

- [ ] **Step 3: Create missing custom fields only**

For each field, query `gh project field-list` by exact name before creation. Create an absent field with:

```bash
gh project field-create "$PROJECT_NUMBER" --owner alxxrzfyr --name Priority --data-type SINGLE_SELECT --single-select-options "P0,P1,P2,P3"
gh project field-create "$PROJECT_NUMBER" --owner alxxrzfyr --name Size --data-type SINGLE_SELECT --single-select-options "XS,S,M,L"
gh project field-create "$PROJECT_NUMBER" --owner alxxrzfyr --name Area --data-type SINGLE_SELECT --single-select-options "Product,Planning,Providers,AI,Web/UX,Platform/Security,Operations"
gh project field-create "$PROJECT_NUMBER" --owner alxxrzfyr --name "Target date" --data-type DATE
```

Expected: one field for each exact name and option set.

- [ ] **Step 4: Create the saved views**

Use the Project UI because built-in workflow and user-owned view support can change independently of `gh`. Create these exact views:

| View          | Layout  | Filter                                           | Grouping and sort                       |
| ------------- | ------- | ------------------------------------------------ | --------------------------------------- |
| Current work  | Board   | `status:Ready,"In progress","In review",Blocked` | Columns by Status                       |
| Backlog       | Table   | `status:Inbox,Backlog,Ready`                     | Group by Priority; sort Area, then Size |
| Roadmap       | Roadmap | `has:"target date"`                              | Group by Milestone                      |
| Release gates | Table   | `label:release-gate`                             | Group by Status                         |
| Security      | Table   | `area:"Platform/Security"`                       | Group by Priority                       |
| Recently done | Table   | `status:Done`                                    | Sort by most recently updated           |

Show Priority, Size, Area, Milestone, Assignees, Linked pull requests, and Sub-issues progress where the layout supports them. Save every view after configuring it.

- [ ] **Step 5: Configure built-in workflows**

In Project **Workflows**, configure:

1. Auto-add from `alxxrzfyr/cooper` with filter `is:issue`.
2. Item added to Project → Status `Inbox`.
3. Issue closed → Status `Done`.
4. Issue reopened → Status `Ready`.
5. Auto-archive items with Status `Done` after 30 days.

Do not auto-add pull requests. The Free plan has one auto-add workflow; reserve it for repository Issues.

- [ ] **Step 6: Verify the configuration twice**

Inspect fields through `gh project field-list` and views/workflows in the browser. Repeat the field creation commands only through the exact-name guard. Expected: no duplicate fields, views, or workflows and no changed option order.

---

### Task 3: Replace repository intake and workflow contracts

**Files:**

- Create: `.github/ISSUE_TEMPLATE/bug.yml`
- Create: `.github/ISSUE_TEMPLATE/change.yml`
- Create: `.github/ISSUE_TEMPLATE/operational-gate.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Modify: `.github/pull_request_template.md`
- Modify: `docs/WORKFLOW.md`
- Modify: `tests/test_deployment.py:64-72`
- Delete: `.github/ISSUE_TEMPLATE/work-item.md`

**Interfaces:**

- Consumes: Project number and URL from Tasks 1–2.
- Produces: structured intake, one Project-first lifecycle, and a PR-to-Issue closing contract.

- [ ] **Step 1: Delete the obsolete source-text test first**

Delete `test_solo_workflow_documents_main_and_ticket_conventions()` from `tests/test_deployment.py`. Do not replace it with assertions over filenames or wording. Those assertions pin copies rather than behavior; the GitHub smoke check in Task 7 verifies the real workflow.

- [ ] **Step 2: Replace the Markdown template with three YAML forms**

Create `bug.yml` with this schema, replacing `PROJECT_NUMBER` with the real number returned by Task 1:

```yaml
name: Bug
description: Report behavior that does not match Cooper's current contract.
title: ""
labels:
  - type:bug
projects:
  - alxxrzfyr/PROJECT_NUMBER
body:
  - type: markdown
    attributes:
      value: Never include credentials, tokens, prompts, email bodies, message IDs, or private user content.
  - type: textarea
    id: observed
    attributes:
      label: Observed behavior
    validations:
      required: true
  - type: textarea
    id: expected
    attributes:
      label: Expected behavior
    validations:
      required: true
  - type: textarea
    id: reproduction
    attributes:
      label: Reproduction
      description: List the smallest deterministic steps and the environment.
    validations:
      required: true
  - type: textarea
    id: impact
    attributes:
      label: Impact
      description: State who notices this and what they cannot trust or complete.
    validations:
      required: true
  - type: textarea
    id: acceptance
    attributes:
      label: Acceptance criteria
      value: |
        - [ ]
    validations:
      required: true
  - type: textarea
    id: verification
    attributes:
      label: Verification notes
      description: Name the runtime path and checks that must prove the fix.
    validations:
      required: true
```

Create `change.yml`:

```yaml
name: Change
description: Propose a feature, improvement, maintenance change, or technical debt fix.
title: ""
labels: []
projects:
  - alxxrzfyr/PROJECT_NUMBER
body:
  - type: markdown
    attributes:
      value: Never include credentials, tokens, prompts, email bodies, message IDs, or private user content.
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: State the current user or engineering problem, not the proposed implementation.
    validations:
      required: true
  - type: textarea
    id: outcome
    attributes:
      label: Required outcome
    validations:
      required: true
  - type: textarea
    id: acceptance
    attributes:
      label: Acceptance criteria
      value: |
        - [ ]
    validations:
      required: true
  - type: textarea
    id: dependencies
    attributes:
      label: Dependencies and risks
    validations:
      required: true
  - type: textarea
    id: verification
    attributes:
      label: Verification plan
      description: Name the runtime path and checks that must prove the outcome.
    validations:
      required: true
```

Create `operational-gate.yml`:

```yaml
name: Operational gate
description: Track release, provider, backup, deployment, or acceptance evidence.
title: ""
labels:
  - type:operations
  - release-gate
projects:
  - alxxrzfyr/PROJECT_NUMBER
body:
  - type: markdown
    attributes:
      value: Never include credentials, tokens, prompts, email bodies, message IDs, or private user content.
  - type: textarea
    id: procedure
    attributes:
      label: Procedure or decision
    validations:
      required: true
  - type: textarea
    id: evidence
    attributes:
      label: Required evidence
      description: Separate automated, browser, deployment, and live-provider evidence.
    validations:
      required: true
  - type: textarea
    id: failure
    attributes:
      label: Failure and rollback handling
    validations:
      required: true
  - type: textarea
    id: acceptance
    attributes:
      label: Acceptance criteria
      value: |
        - [ ]
    validations:
      required: true
```

Do not add a default type label to `change.yml`; triage chooses `type:feature` or `type:maintenance`.

- [ ] **Step 3: Disable blank Issues**

Create `config.yml`:

```yaml
blank_issues_enabled: false
contact_links:
  - name: Cooper Project
    url: https://github.com/users/alxxrzfyr/projects/PROJECT_NUMBER
    about: View active work, priorities, and release gates.
  - name: Report a private security vulnerability
    url: https://github.com/alxxrzfyr/cooper/security/advisories/new
    about: Use a private advisory for exploit details or sensitive evidence.
```

Replace `PROJECT_NUMBER` with the real number returned by Task 1.

- [ ] **Step 4: Rewrite the workflow as a how-to**

Rewrite `docs/WORKFLOW.md` around this exact lifecycle:

```text
Issue → Project triage → Ready → Branch → Development → PR → CI and runtime evidence → Merge → Deploy → Monitor → Done
```

Document the approved Status, Priority, Size, and Area values. State the one-item In progress limit, the rule that L items split before Ready, milestone use for committed release outcomes, Issue `#N` as the identifier, and no Markdown backlog.

Retain the existing branch, Conventional Commit, CI, deployment, rollback, and incident rules. Replace `COOP-*` and `TODOS.md` references with Issue and Project references.

- [ ] **Step 5: Update the PR template**

Replace the first section with:

```markdown
## Related issue

Closes #N. Use `N/A` only for mechanical maintenance that does not need tracking.
```

Keep outcome, rationale, implementation notes, testing, screenshots, and risks. Add one checklist item:

```markdown
- [ ] The linked Issue acceptance criteria are satisfied.
```

- [ ] **Step 6: Remove the old template**

Delete `.github/ISSUE_TEMPLATE/work-item.md` after all three YAML forms and `config.yml` exist.

- [ ] **Step 7: Validate locally**

Run:

```bash
uv run pytest tests/test_deployment.py -q
cd frontend && npx prettier --check ../.github/ISSUE_TEMPLATE/*.yml ../.github/pull_request_template.md ../docs/WORKFLOW.md
cd .. && git diff --check
```

Expected: deployment tests pass; Prettier parses every YAML/Markdown file; no whitespace errors.

- [ ] **Step 8: Commit the repository workflow**

```bash
git add .github/ISSUE_TEMPLATE .github/pull_request_template.md docs/WORKFLOW.md tests/test_deployment.py
git commit -m "chore(workflow): adopt GitHub Project intake" -m "Make Issues and Project fields the work-tracking source of truth and remove the obsolete manual COOP ticket template."
```

---

### Task 4: Reconcile labels, milestone, Issues, sub-issues, and Project fields

**Files:**

- Create temporarily: `/tmp/cooper-github-project-migration.py`
- No repository files change.

**Interfaces:**

- Consumes: Project field schema, Issue forms, Project number, and repository access.
- Produces: bounded labels, one hardening milestone, one migration Issue, nine hardening Issues, six future parent/standalone Issues, three funded-AI sub-issues, and populated Project fields.

- [ ] **Step 1: Write the idempotent migration helper**

The helper uses only Python standard library plus the installed `gh` binary. Implement these exact interfaces:

- `gh(*args: str, input_text: str | None = None) -> str` runs `gh`, sends optional standard input, raises with sanitized standard error on failure, and returns standard output.
- `gh_json(*args: str) -> object` calls `gh` and decodes its JSON result.
- `ensure_label(name: str, color: str, description: str) -> None` creates or updates one exact label.
- `ensure_milestone(title: str, description: str) -> int` returns one exact open milestone's numeric ID, creating or reopening it when needed.
- `ensure_issue(spec: IssueSpec) -> Issue` returns one exact Issue, creating it only when absent and reconciling labels and milestone without overwriting a human-edited body.
- `ensure_project_item(issue: Issue, fields: ProjectFields) -> str` returns one exact Project item ID, adding the Issue only when absent.
- `set_single_select(item_id: str, field: str, option: str) -> None` resolves the exact field and option IDs before setting one value.
- `ensure_sub_issue(parent: Issue, child: Issue) -> None` compares the child's current parent before adding the relation.
- `verify_manifest() -> None` proves every manifest Issue and field value exists once and no unexpected duplicate title exists.

Use this reconciliation order:

```text
validate account and one exact Project
→ ensure labels
→ ensure milestone
→ ensure Issues
→ ensure Project membership
→ set fields
→ ensure sub-issue relations
→ verify exact counts and values
```

Use frozen dataclasses:

```python
@dataclass(frozen=True)
class IssueSpec:
    title: str
    body: str
    labels: tuple[str, ...]
    priority: str
    size: str
    area: str
    status: str
    milestone: str | None = None
    parent: str | None = None

@dataclass(frozen=True)
class Issue:
    number: int
    database_id: int
    url: str
    title: str
```

Each `ensure_*` function queries by exact title/name before creation. Existing Issues keep human-edited bodies; the helper reconciles labels, milestone, Project membership, and fields. More than one exact Project, milestone, or Issue title raises an error. `verify_manifest()` rejects missing and duplicate Project items.

- [ ] **Step 2: Encode the bounded labels**

Use these exact values:

| Label              | Color    | Description                                    |
| ------------------ | -------- | ---------------------------------------------- |
| `type:bug`         | `D73A4A` | Broken behavior                                |
| `type:feature`     | `A2EEEF` | New user-visible behavior                      |
| `type:maintenance` | `6E7781` | Refactoring, dependency, or repository upkeep  |
| `type:operations`  | `5319E7` | Deployment, provider, or release procedure     |
| `release-gate`     | `FBCA04` | Evidence required before release or activation |
| `security`         | `B60205` | Security-sensitive work                        |
| `provider`         | `0E8A16` | External provider work                         |

Delete unused default labels only after the helper has created this set. Preserve any unexpected user-created label and report it instead of deleting it.

- [ ] **Step 3: Encode the hardening milestone and migration Issue**

Milestone:

```text
Title: Public beta hardening
Description: Security, provider, recovery, and operational evidence required before calling the current public beta release-ready.
Due date: none
```

Migration Issue:

```text
Title: Migrate active work to GitHub Projects
Labels: type:maintenance
Priority: P1
Size: M
Area: Operations
Status: In progress
Milestone: Public beta hardening
Acceptance:
- One Cooper Project contains every open Issue exactly once.
- Active work exists in Issues and Project fields, not Markdown checklists.
- Durable documents remain and all local links resolve.
- The tracked Markdown count is 13.
```

- [ ] **Step 4: Encode the hardening backlog**

Use the exact metadata from the spec table. Generate each body with sections `Context`, `Required outcome`, `Acceptance criteria`, `Verification`, and `Dependencies and risks`.

Acceptance criteria:

1. **Bind Google OAuth completion to the initiating browser:** a two-browser regression rejects a transferred consent URL; legitimate same-browser completion persists only the initiating owner's grant; replay remains rejected; Google account email need not match Firebase email.
2. **Escape public OAuth callback output:** title and message render as text; an inert markup regression returns escaped content; state validation remains independent; no script or HTML from the query renders.
3. **Pin GitHub Actions to immutable commit SHAs:** every `uses:` entry in `.github/workflows/deploy.yml` references a reviewed full SHA with the release tag in a comment; CI and main deployment behavior remain unchanged.
4. **Repeat Google and iCloud acceptance on the current build:** every step in `docs/LIVE_PROVIDER_ACCEPTANCE.md` passes with disposable accounts; scheduling avoids both providers; no provider write occurs; the dated privacy-safe record is updated.
5. **Complete weekly-review browser acceptance:** the hosted or production-equivalent UI opens and closes the panel; seven-day facts match seeded state; calendar-unchecked uncertainty remains visible; desktop and narrow layouts have no clipping.
6. **Verify hosted PostgreSQL backup and restore:** provider backup settings are recorded without secrets; a restore into a disposable database succeeds; the same build returns health and expected test-owner data; elapsed time and result are recorded.
7. **Inspect production Supabase grants and RLS posture:** capture function definition, owner, execute grants, event-trigger attachment, table RLS, and API-role grants using read-only SQL; remove only confirmed unnecessary grants through a separately reviewed change.
8. **Measure Render cold and warm startup latency:** record at least five cold and five warm health timings, separate observed API startup from browser load, and create a decision Issue only if the measured latency warrants a hosting or warm-instance change.
9. **Remove legacy planning compatibility fields:** every frontend caller uses `planning`; top-level `shortlist`, `scheduled`, and `events` are removed; API and frontend contract tests pass; no duplicate calculation remains.

Statuses: the three P0 security items and weekly-review acceptance are Ready; connected-provider acceptance is Blocked; backup/restore and Supabase inspection are Ready; cold-start measurement and legacy-field removal are Backlog.

- [ ] **Step 5: Encode future work**

Create these Backlog Issues without milestone or Target date:

| Title                                          | Priority | Size | Area       | Labels                                        |
| ---------------------------------------------- | -------- | ---- | ---------- | --------------------------------------------- |
| Activate the funded-AI pilot                   | P1       | L    | AI         | `type:feature`, `release-gate`                |
| Approve the funded-AI cash envelope            | P1       | S    | AI         | `type:operations`, `release-gate`             |
| Evaluate and pin Gemini/Groq models and prices | P1       | M    | AI         | `type:operations`, `release-gate`, `provider` |
| Complete live Gemini/Groq acceptance           | P1       | M    | AI         | `type:operations`, `release-gate`, `provider` |
| Plan reusable routines                         | P2       | L    | Planning   | `type:feature`                                |
| Plan Microsoft Teams imports                   | P2       | L    | Providers  | `type:feature`, `provider`                    |
| Plan Google Classroom imports                  | P2       | L    | Providers  | `type:feature`, `provider`                    |
| Plan Plus billing after value gates pass       | P2       | L    | Product    | `type:feature`                                |
| Plan the GCP cutover                           | P2       | L    | Operations | `type:operations`                             |

Attach the three funded-AI gate Issues as sub-issues of **Activate the funded-AI pilot** with:

```bash
gh api --method POST repos/alxxrzfyr/cooper/issues/PARENT_NUMBER/sub_issues -F sub_issue_id=CHILD_DATABASE_ID
```

The funded-AI parent acceptance criteria require every sub-issue to close before `COOPER_INCLUDED_AI_ENABLED` may change from `false`.

- [ ] **Step 6: Run the helper twice**

Run:

```bash
uv run python /tmp/cooper-github-project-migration.py
uv run python /tmp/cooper-github-project-migration.py
```

Expected: the first run creates or reconciles state; the second reports no creations, no duplicate items, and no field changes.

- [ ] **Step 7: Verify through CLI and browser**

Run:

```bash
gh issue list --state open --limit 100 --json number,title,labels,milestone,url
gh project item-list "$PROJECT_NUMBER" --owner alxxrzfyr --limit 100 --format json
```

Open each saved Project view. Confirm counts, field values, milestone grouping, parent/sub-issue progress, and the one-item In progress limit. Delete `/tmp/cooper-github-project-migration.py` only after verification.

---

### Task 5: Consolidate durable knowledge into retained documents

**Files:**

- Modify: `README.md`
- Modify: `PRD.md`
- Modify: `ARCHITECTURE.md`
- Modify: `AGENTS.md`
- Modify: `docs/decisions/2026-09-30-included-ai-providers.md`
- Modify: `docs/decisions/2026-09-30-web-first-product-boundary.md`

**Interfaces:**

- Consumes: approved Project URL and Issues from Task 4; current behavior in code and existing documents.
- Produces: current durable documentation with no dependency on historical plans/specs.

- [ ] **Step 1: Make README current and short**

Add the Project URL beside the documentation index. Keep only retained document links. Add guided recovery and weekly review to current capabilities. Remove the obsolete browser-key claim at the old security section and keep the accurate server-funded-disabled disclosure. Do not copy backlog status into README.

- [ ] **Step 2: Make PRD current**

Replace links to product rethink, capacity plans, and accounting specs with direct current facts or retained ADR links. Keep requirements, non-goals, and current source coverage. State that recovery and weekly review are implemented; funded AI, subscriptions, Teams, Classroom, reusable routines, and GCP cutover remain inactive. Point active work to the Cooper Project without listing its cards.

- [ ] **Step 3: Make architecture self-contained**

Remove links to deleted drafts, reviews, specs, and plans. Retain these implemented invariants directly:

- Gemini is primary; Groq is fallback only for eligible availability failures.
- Fallback shares one logical allowance, call ceiling, and cost envelope.
- Safety refusals, invalid actions, ambiguity, invalid credentials, exhausted allowance, and exhausted spend never trigger fallback.
- A committed mutation is never replayed.
- `ai_allowance`, `ai_spend_envelope`, `ai_request`, and `ai_attempt` provide durable admission, reservation, settlement/freeze, and replay receipts.
- Funded dispatch remains disabled until cash, model, price, and live-provider gates close.
- Recovery uses preview, fingerprint stale rejection, one Change, all-or-nothing apply, and conflict-safe undo.
- Weekly review is read-only and writes no planning state.

Keep the current backend/frontend/data-flow reference. Remove historical implementation narrative that does not explain current behavior.

- [ ] **Step 4: Make the included-AI ADR current**

Change its status to: provider order, BYOK removal, adapters, and accounting implemented; funded dispatch disabled and not live-accepted. Fold the fallback and accounting invariants listed in Step 3 into `Decision` and `Consequences`. Remove links to deleted specifications. Keep cash envelope, model IDs, prices, and live provider acceptance as explicit activation gates.

- [ ] **Step 5: Keep the web-first ADR bounded**

Remove links to deleted drafts/reviews/plans. Link `PRD.md` and `ARCHITECTURE.md` for current behavior. Preserve one responsive web/PWA, no native app suite, and no implied approval for pricing, recurring tasks, infrastructure spend, or deployment.

- [ ] **Step 6: Point engineering work to the Project**

In `AGENTS.md`, replace historical-plan prerequisites with the Project-first rule: read the linked Issue, then `PRD.md` and `ARCHITECTURE.md`; Project fields own status and priority; durable constraints remain in Git. Preserve all current single-writer, scheduling, privacy, provider, color, verification, and stop-and-ask rules.

- [ ] **Step 7: Check retained documents before deleting sources**

Use the search tool to confirm no retained file links to `docs/designs`, `docs/superpowers`, `TODOS.md`, or `docs/COOPER_REFINEMENT_SPEC.md`. Read every match and move any remaining durable fact before proceeding.

- [ ] **Step 8: Verify documentation checks**

Run:

```bash
uv run pytest tests/test_deployment.py -q
cd frontend && npm run format:check
cd .. && git diff --check
```

Expected: all commands pass.

- [ ] **Step 9: Commit durable documentation**

```bash
git add README.md PRD.md ARCHITECTURE.md AGENTS.md docs/decisions
git commit -m "docs: consolidate durable Cooper knowledge" -m "Keep current product, architecture, provider, and engineering contracts in the small retained document set before removing historical plans."
```

---

### Task 6: Remove historical work tracking and prove the reduced document set

**Files:**

- Delete: `TODOS.md`
- Delete: `docs/COOPER_REFINEMENT_SPEC.md`
- Delete: `docs/designs/*.md`
- Delete: `docs/superpowers/plans/*.md`
- Delete: `docs/superpowers/specs/*.md`
- Delete: `.superpowers/sdd/**/*.md`

**Interfaces:**

- Consumes: migrated Issues and consolidated retained documents.
- Produces: exactly 13 tracked Markdown files and no Markdown backlog.

- [ ] **Step 1: Confirm every unresolved item has an Issue**

Compare unresolved entries from `TODOS.md`, deleted plans/specs, the October security report, `PRD.md`, and `ARCHITECTURE.md` against `gh issue list --state open`. Do not delete source files until every unresolved item maps to one exact Issue URL.

- [ ] **Step 2: Delete the approved historical sets**

Delete only the paths named in this task. Preserve README, PRD, architecture, agent bridges, visual rules, workflow, recovery, provider acceptance, two ADRs, the PR template, and Kiro workflow instructions.

- [ ] **Step 3: Verify the exact retained Markdown set**

Run:

```bash
git add -A
git ls-files '*.md'
git ls-files '*.md' | wc -l
```

Expected after staging deletions: 13 files, exactly the retention list in the spec. An extra file requires an explicit keep/delete decision; do not silently widen the exception list.

- [ ] **Step 4: Verify local Markdown links**

Create a throwaway link checker that scans the 13 tracked Markdown files, ignores `http:`, `https:`, anchors, and mail links, resolves repository-relative paths, and fails on a missing target. Run it from the repository root and print every missing source/target pair.

Expected: zero missing local links. Delete the checker after the run.

- [ ] **Step 5: Verify no active-work prose remains**

Use the search tool across retained Markdown for `TODO`, `next step`, unchecked task boxes, `COOP-`, `docs/superpowers`, `docs/designs`, and `TODOS.md`. Review semantic uses such as product “what comes next”; remove only work-tracking remnants and broken references.

- [ ] **Step 6: Run the full repository gate**

Run:

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
cd frontend
npm test
npm run format:check
npm run build
cd ..
git diff --check
```

Expected: all backend tests, frontend tests, lint, format, build, and diff checks pass.

- [ ] **Step 7: Commit the deletion**

```bash
git add -A
git commit -m "docs: remove migrated planning history" -m "Use GitHub Issues and Projects for active work while retaining thirteen durable product, architecture, decision, design, and operational documents."
```

---

### Task 7: Exercise the real workflow and open the migration pull request

**Files:**

- No additional repository files unless verification finds a defect.

**Interfaces:**

- Consumes: configured Project, migrated Issues, and reduced repository document set.
- Produces: observed Kanban behavior, pushed branch, and a reviewable pull request linked to the migration Issue.

- [ ] **Step 1: Exercise close and reopen automation on the migration Issue**

Close the migration Issue. Observe Status change to Done. Reopen it. Observe Status change to Ready. Restore Status to In progress. Do not create a disposable Issue.

- [ ] **Step 2: Exercise one Issue Form in the browser without submitting private data**

After the branch is pushed, preview each YAML form through GitHub's template chooser if branch previews are available. After merge, create the next real work item through the relevant form and confirm it enters Inbox. Do not create fake history only to test a form.

- [ ] **Step 3: Inspect every saved Project view**

Confirm:

- Current work contains the migration Issue and Ready/Blocked hardening work.
- Backlog is grouped by Priority and shows future work without dates.
- Roadmap shows only genuinely dated items; an empty roadmap is valid.
- Release gates contain the hardening evidence and funded-AI gates.
- Security contains the three audit findings plus Supabase inspection.
- Recently done reflects only real closed work.

- [ ] **Step 4: Push the branch**

```bash
git push -u origin docs/github-projects-migration
```

- [ ] **Step 5: Open the pull request**

Use the migration Issue number in place of `N`:

```bash
gh pr create --base main --head docs/github-projects-migration --title "chore(workflow): move active work to GitHub Projects" --body-file /tmp/cooper-projects-pr.md
```

The PR body must use `.github/pull_request_template.md`, start with `Closes #N`, state the 49-to-13 Markdown reduction, link the Project, list the full verification output, and state that no application, schema, dependency, deployment, or secret changed.

- [ ] **Step 6: Verify CI and stop before merge**

Check the pull request's required checks and inspect the diff as a reviewer. Do not merge or deploy without the owner's explicit approval. The migration Issue remains In review until that approval and merge.

- [ ] **Step 7: Complete post-merge acceptance**

After owner-approved merge, confirm the main workflow deploys unchanged application artifacts, the retained Project links resolve from `main`, and the next real Issue created through a form auto-enters Inbox. Then close the migration Issue through the merged PR and let the Project move it to Done.
