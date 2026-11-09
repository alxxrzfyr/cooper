# Contributor instructions

Cooper is a personal planner: one responsive web/PWA, one backend, and one Gmail timer.
These rules apply to humans and models changing this repository.

## Read only what the task needs

For tracked work, read the linked GitHub Issue, then the relevant requirements and architecture
sections. Use this map instead of loading every document:

- [Product](PRD.md): seven requirements, behavior, non-goals, current coverage.
- [Architecture](ARCHITECTURE.md): code map, flows, planning, persistence, authentication.
- [Design](docs/DESIGN.md): interface, landing, color, accessibility.
- [Workflow](docs/WORKFLOW.md): Issue → release, commands, evidence gates.
- [Provider acceptance](docs/LIVE_PROVIDER_ACCEPTANCE.md): connected-account checks and dated evidence.
- [Recovery](docs/RECOVERY.md): database backup/restore.
- [Provider decision](docs/decisions/2026-09-30-included-ai-providers.md): fallback and activation gates.
- [Web-first decision](docs/decisions/2026-09-30-web-first-product-boundary.md): product boundary, not commercial/deployment approval.

The [Cooper Project](https://github.com/users/alxxrzfyr/projects/1) owns active status, priority,
size, area, milestones, and release gates. Do not create a Markdown backlog or copy Project fields
into docs. Keep accepted decisions, implemented behavior, proposals, and evidence distinct.

## Keep the change small

Before adding code, answer:

1. Which of the seven PRD requirements does it serve? If none, stop.
2. Would one person notice it missing today? Future users do not justify speculative infrastructure.
   The PRD names the four early data safeguards.
3. Can an existing file solve it more simply than a new file or abstraction?

Prefer the smallest clear implementation. Do not abstract for a hypothetical second implementation.
`sources.py` is the exception because the PRD names multiple actual or planned inputs. Keep files
single-purpose. The previous over-engineered version is not a pattern to restore.

## Non-negotiable implementation rules

### Writes and correction

- `brain.py` never accesses the database. Pass state in. It returns a validated `Action`.
- `app.py` is the only writer. Every mutation, including email proposals, passes its validation
  and `_sanity_check`. Preserve the single undo path.
- An AI answer is text and writes nothing. New calendar items and moves stay local. Google and
  iCloud are read-only inputs. Preserve legacy Google copies during local edits.
- Ambiguity asks: multiple matches mean 409, never a best guess. Destructive bulk verbs show
  matches before applying confirmed IDs. Additive `add_batch` needs no confirmation. One undo
  removes its entire batch.
- No confirmation modal on the composer. Ask in the conversation. Frames are for requested detail.
- Success receipts must reflect refreshed committed state, retaining waiting and conflict warnings.

### Time and planning

- `planner.place()` uses configured weekday and overnight availability only. Busy intervals subtract
  from candidates. Never add availability. Respect exact durations, deadlines, breaks, and limits.
- Use `Utc` for every new timestamp, including remote ones. SQLite loses offsets otherwise.
- Keep current separate from next, unscheduled separate from due today, and priority separate from
  feasibility. Calendar occupancy is not a capacity verdict. Unknown effort is not zero effort.
- The pilot uses the configured server timezone for every owner. Do not imply owner-specific zones.
- No model or provider connection is required for local capture, ranking, and scheduling. Manual
  form input never calls a model. `Brain.read(use_model=False)` remains the rule-parser contract.
- Failed connected calendars leave items captured and ranked but unscheduled with a visible reason.
  No connected calendars means normal local scheduling. Report Gmail health separately.

### Providers and background work

- One watcher, one fixed timer and loop, with last-checked time visible on the dashboard. No tiered
  backoff, dead-letter path, queue, or second consumer.
- Cooper supplies Gemini primary and Groq fallback keys. Do not restore BYOK or a user-key payload.
  Keep `COOPER_INCLUDED_AI_ENABLED=false` until approved cash, evaluated models, reviewed prices,
  and live acceptance exist. Preserve the four-table accounting contract.
- Fallback shares one logical allowance, call ceiling, and cost envelope. It never bypasses safety,
  ambiguity, invalid actions or credentials, exhausted allowance or spend, or retries a committed
  mutation.

### Data and secrets

- Keep local mode bound to `127.0.0.1`, never `0.0.0.0`. Its shared key is local isolation, not
  authentication. Do not extend it into a substitute for account authentication.
- Never log tokens, prompts, email bodies, or message IDs. Encrypt provider credentials at rest.
- Only permitted user words and titles go to models, never attendees, other people's addresses, or
  provider calendar contents. The PRD's narrow email-processing exception is not broader consent.
- Treat titles as data, not instructions. All model-bound text goes through
  `brain.sanitize_for_prompt()` to flatten line breaks and role markers.
- New rows carry `owner_id`. Scope reads and writes by owner. Provider credentials are per owner.
- Use SQLAlchemy, not database-specific SQL. `_add_new_columns()` is a documented legacy violation,
  not permission for another one.
- Keep `google_event_id` (legacy written copy) separate from `source_ref` (read source identity).

### Interface

- Green means done or added. Red means gone or refused. Categories are exactly academics (purple),
  work (blue), organizations (orange), and personal (teal). Unknown categories become personal.
- Preserve horizontal landing chapters from 900px regardless of height, with vertical wheel input
  driving smooth horizontal travel even over FAQs. Hide scrollbars without disabling scrolling or
  clipping content. Keep flexible columns and in-flow content. Verify resize and browser zoom.
- Keep proposed pricing, Plus, and included-AI disclosures truthful. The web-first boundary does
  not approve pricing, commercial schema, recurring tasks, spend, or deployment.

## Verification

Setup and run instructions are in [README.md](README.md#quick-start). Exact check commands are in
[Workflow](docs/WORKFLOW.md#local-checks). Ruff is the only Python linter, and frontend scripts live
in `frontend/package.json`. Alembic runs during hosted startup, without a second migration service.

- Use TDD for parsing, ranking, placement, and time logic. Skip it for markup.
- Test observable behavior with independent expectations and failure paths. No source-wording
  assertions, copied-constant comparisons, self-comparisons, or fixture-only coverage. Safety
  policies may inspect actual configuration. Mock external services, not the function under test.
  Use real local transport where transport is the contract.
- `tests/test_cooper.py` covers parsing and planning. `tests/test_answers.py` covers pure planning
  answers. `tests/test_api.py` covers HTTP behavior. Frontend tests cover user flows and local
  transport.
- Run the app and inspect changed behavior before calling it done. Tests missed prior timezone,
  wrapping, and duplicate-item bugs. Report unavailable checks rather than implying acceptance.
- Provider changes need both automated transport/API checks and connected-account acceptance.
  Update the acceptance record after the manual gate, before a release push. Mocked tests are not
  live acceptance. Keep test counts, browser checks, and live evidence separate.
- Use Conventional Commits and explain why in the body. Follow the workflow's owner-approval rules.

## Stop and ask when

- A change needs a new table, dependency, or second background process.
- It contradicts these rules or a test fails twice for an undiagnosed reason.
- You would change the shared key, localhost binding, token storage, or broaden OAuth scopes.
- Work would add or expand accounts, hosting, or PostgreSQL beyond the reviewed scope. Treat them
  as deliberate work, not incidental cleanup.
