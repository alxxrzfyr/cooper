# Architecture

This is a map of what is actually built: code responsibilities, request flows, persistence, and
safety boundaries. Product behavior belongs in [PRD.md](PRD.md). Contributor instructions are in
[AGENTS.md](AGENTS.md). Release procedures are in [docs/WORKFLOW.md](docs/WORKFLOW.md).

## System at a glance

One React web/PWA calls one FastAPI backend. `app.py` orchestrates all writes. Interpretation,
planning, answer rendering, and provider transport do not own database mutations.

```text
React workspace → api.ts → app.py → database
                             ├─ brain.py → validated Action
                             ├─ planner.py → ranking, slots, snapshot
                             ├─ answers.py → planning answer text
                             └─ source readers → sources.py → commitments

Gmail timer → app.py → validated proposal → same writer
Optional model calls → providers.py → Gemini / Groq
```

Google Calendar and iCloud are read-only inputs. New blocks stay in Cooper. Teams and Classroom
have no modules or connections today. Funded-AI adapters and accounting exist, but dispatch is
disabled. Render remains the API host. A GCP cutover is not active.

## Code map

Paths in these tables are relative to `cooper/` and `frontend/src/`, respectively.

### Backend

| File                   | Responsibility                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `app.py`               | Routes, owner checks, orchestration, mutations, undo, and AI accounting operations. Only writer. |
| `brain.py`             | Rule and model interpretation, action validation, and prompt sanitization. No database access.   |
| `planner.py`           | Pure ranking, placement, shared projection, task states, recovery previews, and weekly review.   |
| `answers.py`           | Deterministic planning answers from a supplied snapshot. No I/O.                                 |
| `sources.py`           | Source-aware commitments, conservative deduplication, and merged busy intervals.                 |
| `google.py`            | Calendar and Gmail REST reads and OAuth transport. No SDK.                                       |
| `icloud.py`            | Read-only CalDAV calendar access.                                                                |
| `watcher.py`           | One fixed-interval Gmail sync timer. Delegates writes to the app.                                |
| `providers.py`         | Explicit Gemini and Groq transport, typed failures, and usage. No storage.                       |
| `mcp.py`               | Bounded tool schemas and MCP result shapes.                                                      |
| `db.py`                | SQLAlchemy models, sessions, and the UTC column type.                                            |
| `auth.py`, `config.py` | Firebase token verification and validated environment settings.                                  |

### Frontend

| File                                       | Responsibility                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| `App.tsx`                                  | Account and workspace state, drafts, composer orchestration, and mutations |
| `api.ts`, `types.ts`                       | Backend calls and response types                                           |
| `runtime-config.ts`, `firebase.ts`         | Public runtime configuration and hosted sign-in                            |
| `Home.tsx`                                 | Snapshot-backed Now, Next, Today, At Risk, Upcoming, and local moves       |
| `RecoveryPanel.tsx`, `WeeklyReview.tsx`    | Preview and apply recovery plus read-only review                           |
| `Form.tsx`, `Chat.tsx`                     | Structured Manual capture and the conversation                             |
| `Calendar.tsx`, `Row.tsx`                  | Day, week, and month calendar views plus item rows with score details      |
| `Settings.tsx`, `AvailabilitySettings.tsx` | Settings presentation and availability windows                             |
| `Nav.tsx`                                  | Responsive navigation and its own persisted collapse preference            |
| `Mascot.tsx`, `theme.css`                  | State illustrations and visual tokens                                      |
| `landing/`                                 | Public landing, authentication, Terms, and Privacy pages                   |

Settings presentation lives outside `App.tsx`, while drafts and writes remain coordinated there.
Layout, landing behavior, and visual acceptance belong in [docs/DESIGN.md](docs/DESIGN.md), not in
the request or persistence layers.

## Request flows

### Capture and mutations

1. Sentence capture enters `POST /api/say`, then `brain.read()` returns a validated, frozen
   `Action`. Structured capture enters `POST /api/items` and constructs the action directly,
   without a model.
2. `app.py` runs the same validation and `_sanity_check` for both. Email proposals join this path
   too. The watcher has no direct write shortcut.
3. The app resolves the owner and target, checks connected availability when placing work, and
   uses the pure planner for ranking and exact-length slots.
4. The app commits local state and the undo record, refreshes the planning snapshot, and builds a
   receipt from the committed item. Missing verification is an error, not a fabricated success.
   Waiting, overlap, and source-health warnings remain in the receipt.

`find()` resolves exact ID, exact title, then unique substring. Multiple matches return 409. No
match asks rather than choosing a near match. Local moves also check visible provider titles for
ambiguity, reject unknown direct IDs, and refuse provider-owned targets.

### Read-only answers and tools

Common planning intents are answered by `answers.answer_planning_intent` from the same snapshot
used by the workspace. It distinguishes current from next, priority from placement, and
unscheduled from due-today work. Workload answers merge calendar overlaps and report estimated and
unknown unscheduled effort. Calendar occupancy is not an overall capacity verdict.

Broader Ask requests can enter a bounded model tool loop when model dispatch is enabled. Ask
exposes read tools only, so it cannot apply a plan or refresh Gmail. `app.py` validates tool
arguments and derives the owner from authentication. Credentials never enter tool arguments or
results. The separately authenticated MCP endpoint (`POST /api/mcp`) can expose `apply_plan`. It
still delegates to the same app writer. An AI answer itself writes nothing.

### Correction, recovery, and review

| Endpoint                         | Contract                                                                  |
| -------------------------------- | ------------------------------------------------------------------------- |
| `POST /api/bulk/match`           | List destructive-action matches without writing                           |
| `POST /api/bulk`                 | Act on confirmed IDs and record one undoable batch                        |
| `PATCH /api/items/{item_id}`     | Owner-checked edits, including estimates, with undo                       |
| `POST /api/items/{item_id}/move` | Exact future start and duration through `reschedule`                      |
| `POST /api/recovery/preview`     | Compute missed-block recovery and a state fingerprint                     |
| `POST /api/recovery/apply`       | Reject stale fingerprints and commit all-or-nothing as one `Change`       |
| `POST /api/undo`                 | Reverse the latest change. Recovery undo refuses conflicting later edits. |
| `GET /api/review/week`           | Derive a read-only weekly review without saving review state              |

The bulk API is built. Its shown-list conversation surface is not yet wired into Ask. Home and Ask
local moves share `app.py::reschedule` and return times from refreshed committed state.

## Planning pipeline

### Sources and shared snapshot

`sources.py` combines local blocks, Google events, iCloud events, and reconciled Gmail
confirmations. It retains source identity and editability and deduplicates only exact aliases or
matching cross-source signatures. Busy time is a list of `(start, end)` intervals. The planner does
not need to know which service supplied it. Future assignments would instead enter ranking as
due-dated items.

`planner.build_planning_snapshot()` projects commitments, ranked tasks, derived states, risks,
counts, conflicts, free time, and source health once. Calendar, navigation, Home, and common Ask
intents consume that projection. Home's focus and risk IDs reference canonical items rather than
copying them into competing cards. External commitments retain details but no mutation controls.

Task workflow is derived, not another stored lifecycle. Open items resolve to `not_started`,
`scheduled`, `in_progress`, `blocked`, `overdue`, or `missed_block`. Terminal database statuses
resolve to `completed` or `dropped`.

### Ranking

```text
score = 0.60 × due + 0.20 × importance + 0.10 × age + 0.10 × quick
```

- `due`: zero without a deadline, ramps over 14 days, reaches one when overdue.
- `importance`: the 1–5 value normalized to 0–1.
- `age`: waiting time capped at three weeks.
- `quick`: shorter work scores higher. No estimate uses 0.5.

Pinned items sort first, then score, creation time, and ID. Each row exposes the terms. Tune the
weights to change ranking. Do not add a model reranker.

### Placement and capacity

`place()` uses greedy earliest fit in ranked order. It expands chosen weekday availability into
UTC windows, including overnight and 24-hour windows. Busy intervals subtract from those windows.
They never create availability. Each block is one continuous exact-duration session, starts no
sooner than 15 minutes from now, and finishes by its deadline. Existing local tasks count toward
daily block and minute limits. Breaks and limits are configurable. Unknown estimates are skipped,
never assigned an invented half-hour block.

`project_open_tasks()` supplies both the seven-day scheduler and the snapshot. An unsaved task is
a Now candidate only when the projection places it at the earliest legal start. Active commitments
take precedence. A missing saved block alone does not mean placement failed.

`planning.capacity` covers unscheduled local tasks due between the sampled time and next local
midnight. Candidates are filtered from the full seven-day projection, so pinned future work can
consume today's slots. Overdue work, missed blocks, and other backlog are separate cohorts.
Unknown estimates yield an explicit count and partial assessment. A source failure returns no
candidates or open-window metric. Gap minutes describe time, not a feasibility verdict.

Duration-fit answers run a pure synthetic `place()` call against commitments, scheduled tasks, and
hours, bounded with `until` at local midnight. This is an unsaved standalone probe, not a
reservation or a backlog priority guarantee. Narrower, future, and mixed horizons ask for a
supported today question. Projections and probes call no model and write no planning state.

Estimate edits use the existing PATCH and undo path. The frontend refreshes the snapshot, retains
failed drafts, and closes details after a successful save. All owners use the configured server
timezone in this pilot. Owner-selectable timezone persistence is outside scope.

### Weekly review

All boundaries are local dates in the configured timezone:

- **Past:** today minus six days through today. Count local completions by `done_at`. Dropped items
  have no completion timestamp and are excluded.
- **Unfinished:** overdue open tasks (`due < at`) and missed blocks (`end_at <= at`).
- **Upcoming:** today through today plus six days. Per day, report merged fixed minutes, scheduled
  open-task minutes, and open-task deadlines.
- **Deadline risks:** upcoming open tasks without a block ending by the deadline or a slot in the
  shared projection. Reasons are `unknown_estimate`, `no_feasible_slot`, or `calendar_unchecked`.

The response reports unscheduled and unknown-estimate counts and data completeness, without remote
titles, attendees, streaks, scores, or time-saved metrics. Home renders it inline without mutation
controls. Scheduling and recovery remain separate actions.

## Persistence

All models live in `cooper/db.py`. Three tables hold planning state. Four hold funded-AI accounting.

| Table               | Contents                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `item`              | Tasks and fixed events with owner, source, title, notes, estimate, importance, deadline, category, placement, status, and times |
| `setting`           | `(owner_id, key)` values for hours, encrypted credentials, OAuth nonce, and watcher health or last check                        |
| `change`            | Owner, label, item, and before-snapshot for undo. Pruned to twenty rows per owner, not a product audit log                      |
| `ai_allowance`      | Durable logical-request admission and allowance                                                                                 |
| `ai_spend_envelope` | Spending limits and cash reservations                                                                                           |
| `ai_request`        | Logical request state and replay receipt                                                                                        |
| `ai_attempt`        | Provider attempts, usage, and settlement or freeze state                                                                        |

`google_event_id` links a legacy Google copy Cooper once wrote. `source_ref` identifies something
Cooper read. Never merge them. A linked Google copy is hidden only while title, time, and
description still match the local item. Changed copies remain visible and busy. Local edits do not
create or delete provider copies.

Use `Utc` for timestamps, including remote ones. It converts on write and re-tags on read because
SQLite drops offsets. The earlier 3pm-to-11pm display bug is why this is a type, not a convention.
Every row carries ownership. Queries and mutations are owner-scoped.

SQLite is the local default. Hosted mode uses `COOPER_DATABASE_URL` with PostgreSQL. Alembic owns
versioned upgrades. `create_all` only conveniences a fresh local database. Use SQLAlchemy, not new
database-specific SQL. `_add_new_columns()` is the documented legacy exception.

## Authentication and hosting

| Concern       | Local                                                    | Hosted beta                                                          |
| ------------- | -------------------------------------------------------- | -------------------------------------------------------------------- |
| Identity      | One configured owner with `X-Cooper-Key`                 | Firebase ID token verified by `auth.py`. The owner is the UID.       |
| Browser setup | Same-origin API paths. Vite attaches the root `.env` key | Firebase Web config from `/__/firebase/init.json`                    |
| Database      | SQLite                                                   | PostgreSQL. Supabase Postgres recommended, Cloud SQL an alternative. |
| Binding       | `127.0.0.1` only                                         | Existing authenticated Render container configuration                |

The shared key is local isolation, not account authentication. CORS is pinned to one origin.
Middleware returns authentication failures rather than raising them into a 500. `/health` checks
database access, not provider health. OAuth callback and internal sync have their own checks. They
are not ordinary shared-key or bearer routes.

Hosted accounts use Google sign-in or verified email/password. Calendar and Gmail consent is a
separate owner-bound OAuth grant. iCloud uses an encrypted app-specific password. Google callback
protection combines signed owner-bound state, an HttpOnly browser cookie, and a durable one-use
nonce for replay rejection across instances. Callback status is rendered as escaped text.

Hosted abuse limits are in-process per UID: 120 API requests per minute and five Google sync or
iCloud connection attempts per minute. Rejection returns 429 and `Retry-After`. These limits protect
the current single-worker API, not multiple replicas. Shared edge limits would need deliberate
work.

Firebase Hosting serves the frontend. Render serves the API. A server-only Supabase pooler
connection is recommended for runtime traffic. Firebase remains the identity provider, so neither
Supabase Auth nor Supabase Storage is used. There is no file-upload requirement.

[`render.env.example`](render.env.example) lists hosted settings. The existing container applies
Alembic migrations before serving. There is no separate migration service. Deployment and rollback
procedures are in [Workflow](docs/WORKFLOW.md). Database recovery is in [Recovery](docs/RECOVERY.md).
A hosting configuration is not approval to spend or deploy.

## Privacy and secrets

- Encrypt Google refresh tokens and iCloud app-specific passwords with Fernet before storage.
  Never return the iCloud password to the browser or a model.
- Never log credentials, prompts, email bodies, message IDs, or private content. Request logging
  uses bounded metadata rather than raw URLs, bodies, or identities.
- Model input is limited to permitted user words and titles plus anonymous availability data.
  Provider calendar contents, attendees, and other people's addresses are excluded.
- Pass model-bound text through `brain.sanitize_for_prompt()`. Stored titles remain data, not
  instructions. Line breaks and role markers must not become prompt structure.
- Gmail uses a deterministic known-sender parser in memory. Do not retain or log bodies. Restricted
  Gmail access has published-app review and security-assessment obligations. The project's public
  multi-user plan requires the paid annual assessment. Do not widen scope or request send.
- Failed connected reads leave captures ranked but unscheduled with a reason. With no calendars
  connected, local scheduling works normally. Watcher health stays separate and visibly reports
  its last check.

## Included-AI accounting

The [provider decision](docs/decisions/2026-09-30-included-ai-providers.md) owns provider order and
activation gates. Cooper supplies server-side Gemini primary and Groq fallback credentials. BYOK
is removed from onboarding and Settings. The API rejects `gemini_api_key` without echoing it.

Both attempts share one logical allowance, call ceiling, and cost envelope. Fallback is only for
eligible availability failures, never safety refusal, ambiguity, invalid actions or credentials,
exhausted allowance or spend, or a committed mutation.

The four accounting tables conditionally admit a logical request, reserve cash before dispatch,
and settle or freeze based on provider usage. A mutation and its replay receipt commit in one
transaction. The ledger does not itself enable dispatch. `COOPER_INCLUDED_AI_ENABLED=false`
remains the default until approved cash, evaluated pinned models, prices, and live acceptance exist.

Operator functions `provision_ai_pilot`, `abandon_ai_request`, `reconcile_ai_attempt`, and
`review_ai_envelopes` are not exposed over HTTP. Accounting concurrency evidence is SQLite-only.
Do not infer PostgreSQL concurrency acceptance from it.

## Compatibility and deliberate omissions

Temporary top-level schedule fields remain because frontend and backend can deploy independently.
Their removal has not started. The normalized snapshot is the shared planning contract.

Do not add speculative outboxes, job systems, circuit breakers, a general quota governor, mutation
ledger, reranker, layered `core/services/adapters` framework, import contract, or WAL tuning. The
required funded-AI ledger is not a general-purpose infrastructure template. `watcher.py` remains one
timer and loop, without tiered backoff, dead letters, or a second consumer.

Automated tests, browser checks, and connected-provider acceptance are distinct evidence. Consult
[the dated acceptance record](docs/LIVE_PROVIDER_ACCEPTANCE.md) before claiming provider readiness.
