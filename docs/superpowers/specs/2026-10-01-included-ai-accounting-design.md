# Included AI accounting and BYOK retirement

Date: 2026-10-01.

Status: IMPLEMENTED IN WORKING TREE; FUNDED DISPATCH DISABLED. See the execution
record in `docs/superpowers/plans/2026-10-01-included-ai-implementation.md`.
On 2026-10-01 the owner approved the
four-table accounting schema in response to the explicit schema-approval question.
Cooper-provided Gemini/Groq keys and BYOK removal were already approved. Cash
budgets, model selections, active allowances and paid billing remain separate
decisions. No migration, server key or paid tier is enabled by this document.

Related: [provider decision](../../decisions/2026-09-30-included-ai-providers.md),
[fallback contract](2026-09-30-included-ai-provider-fallback-design.md),
[product boundaries](2026-09-30-cooper-web-first-product-design.md).

## Product and implementation boundary

Cooper pays for Gemini primary and Groq fallback. Users see included assistance and
their remaining allowance; they never enter a provider key. This serves PRD's
natural-language capture and planning requirements. Manual forms, the rule parser,
deterministic answers, scheduling and undo continue working with zero provider keys.
Allowance exhaustion disables model assistance, not access to stored work.

This proposal covers service accounting, request replay and the browser-key cutover.
It does not build checkout, subscription webhooks, native apps, a new background
worker or a general model router. Initial pilot owners receive server-provisioned
Free allowance rows. A Plus label in a browser never grants an allowance; commercial
Plus enrollment remains a separate billing project. The proposed 20/300 quotas and
$8 price are not approved limits or active offers.

## Approaches considered

1. **Recommended: four durable tables, existing app writer.** Reservations survive
   crashes and coordinate processes; request rows also carry mutation receipts.
   Requires explicit schema approval and transaction changes to existing writers.
2. **Process-local counters.** Smaller change, but restarts, concurrent workers and
   ambiguous provider timeouts bypass accounting. Cannot activate funded keys.
3. **An external metering service or queue.** Adds a dependency and another system
   for this small pilot. Not proposed.

## Proposed schema

Add models in `cooper/db.py` and one Alembic migration after schema approval. Use
SQLAlchemy constraints, portable operations and the existing `Utc` timestamp type.
All money values are nonnegative integer USD microdollars (`BigInteger`), never floats.
One dollar is 1,000,000 microdollars. Cost calculations round upward.

| Table | Keys and fields | Required constraints |
| --- | --- | --- |
| `ai_allowance` | Composite PK `owner_id`, `period` (`YYYY-MM`, UTC); `tier` (`free` or `pilot_plus`); `limit_units`, `reserved_units`, `consumed_units`; `created_at`, `updated_at` | Counts nonnegative; reserved + consumed <= limit. No client-controlled tier or limit. |
| `ai_spend_envelope` | Composite PK `owner_id`, `period`, `scope` (`aggregate`, `gemini`, `groq`); `enabled` boolean; `limit_microusd`, `reserved_microusd`, `spent_microusd`; UTC timestamps | Reserved + spent <= limit; scopes enumerated. Service-owned rows use the fixed internal owner `cooper-service`, never a request's owner. |
| `ai_request` | UUID PK `id`; authenticated `owner_id`; UUID `logical_request_id`; `payload_digest`; `period`; `state`; `allowance_state`; `response` nullable JSON; `created_at`, `updated_at` | Unique `(owner_id, logical_request_id)` across periods; FK to owner's allowance period. State `admitted`, `running`, `applying`, `completed`, `failed`, `uncertain`; allowance state `reserved`, `consumed`, `released`. |
| `ai_attempt` | UUID PK `id`; authenticated `owner_id`; `request_id`; `attempt_no` (1..4); `provider`; pinned `model`; `price_revision`; `state`; `reserved_microusd`, nullable `actual_microusd`; nullable measured input/output token counts; UTC timestamps | Unique `(request_id, attempt_no)`; composite FK `(request_id, owner_id)` to unique `(ai_request.id, ai_request.owner_id)`; provider `gemini` or `groq`; state `reserved`, `dispatching`, `settled`, `uncertain`, `released`; costs/counts nonnegative. |

The request row is the mutation receipt; do not add a fifth table for the same
logical request. Its completed response records the committed mutation result.
It is service idempotency state, not an item history replacing `Change` or undo.
Store no API key, raw prompt, raw provider response, provider calendar title,
attendee, email content or message id in these tables. A response contains only the
existing user-visible result and permitted own-item receipt. It must omit the full
planning snapshot, provider details and credentials. An answer receipt may store
its sanitized, length-bounded text. Fresh snapshots are attached when responding.

The digest covers a canonical serialization of authenticated owner, normalized
text, mode and intent. It distinguishes reuse of one ID for different input; it is
not authentication. Do not log the input or digest. No automatic receipt deletion
is added during the bounded pilot: otherwise an old retry could execute again.
Define retention, export/deletion behavior and protection against unlimited request
rows before a public commercial rollout. Never age out uncertain reservations.

## Admission and concurrency

`app.py` owns every accounting mutation. `brain.py` still has no database access.
Provider transports return typed text/actions, usage and failure categories.

1. Authenticate and validate the input. If an AI request supplies a UUID
   `logical_request_id`, look it up with the verified owner before reclassifying or
   rerunning any action. Different digest returns 409. A completed request
   replays its stored result plus a fresh owner snapshot. Pending/applying/uncertain
   returns 202 with that ID; it cannot start another provider or mutation.
2. For a new request, run manual/rules/deterministic paths first. They dispatch no
   model and reserve no allowance. Their existing manual mutation behavior is
   unchanged; the durable receipts here guarantee replay for funded model requests,
   not all manual HTTP endpoints. Model-needed requests must provide the UUID.
3. For a new ID, begin one transaction. Insert the request, conditionally increment
   the owner's `reserved_units` by one and reserve the first attempt's maximum
   cost in both aggregate and Gemini envelope rows. A duplicate insert or any
   failed conditional update rolls back the entire transaction.
4. Commit the request, allowance and attempt reservation before dispatch. A provider
   call is forbidden if that commit failed or its outcome is unknown.

Use conditional SQLAlchemy `update()` statements, each requiring `rowcount == 1`,
with predicates `reserved + consumed + 1 <= limit` and
`enabled AND reserved_cost + spent_cost + requested_cost <= limit_cost`. Do not depend on
SQLite's unsupported row locks or check-then-write counters. The unique request
constraint decides a concurrent duplicate; after rollback, read the existing row
   and return its state. Independent IDs racing for one remaining unit admit exactly
one request. Update envelope rows in stable order: aggregate, then provider.

Provision allowance/envelope rows before activation using an explicit operator
action through `app.py`; missing rows mean AI unavailable. Do not auto-invent a
budget, assign Plus from a browser flag or copy unused credits into a new month.
Period rollover uses new rows. Older unresolved reservations remain in their
original rows and remain visible to operator reconciliation.

## Attempt dispatch and cash accounting

Pin model identifiers and a reviewed price revision; do not use a moving `latest`
alias for funded accounting. Before dispatch, calculate an upper cost bound covering
bounded input, configured maximum output and every billed token category. If the
selected model's billing cannot be bounded, do not enable that model. Token/usage
normalization and price calculations need provider-specific verification before
activation; this spec selects no model or price.

Persist `dispatching` immediately before the network call. A crash in the gap between
that commit and dispatch is ambiguous and keeps its reserve. This sacrifices some
available credit rather than risking unaccounted calls.

Each additional repair, tool turn or fallback first reserves its own maximum cost
against its provider and the same aggregate period. One logical request holds one
allowance unit; at most four attempts share one monotonic deadline. A restart cannot
reset either limit. Do not hold a database transaction open during a provider call.

| Outcome | Required transition |
| --- | --- |
| Measured usage response, including a billed refusal | Atomically change attempt to `settled`; remove its reserve and add measured cost to both envelopes. |
| Proven failure before dispatch | Change attempt to `released`; release its cash reserve. Release the allowance only if no useful result or unresolved attempt exists. |
| Timeout, ambiguous transport failure or crash after dispatch marker | Change/retain attempt as `uncertain`; retain maximum cash reservation. Never redispatch that attempt. |
| Useful answer or committed mutation | Consume the single allowance unit exactly once; store completed response. Uncertain attempts retain their cash reserve. |
| Definitive failure with no useful result and all costs resolved | Release the allowance; preserve already measured provider spending. |
| Missing usage or measured cost above the reviewed upper bound | Disable the aggregate/provider envelopes; retain the reservation and require reconciliation. Save observed `actual_microusd` when available while keeping state `uncertain`; do not force an invalid counter settlement or clamp real spend to hide the discrepancy. |

A live worker may use the one eligible Groq fallback after a primary availability
failure, including a timeout, only by retaining any uncertain Gemini reservation
and acquiring a separate Groq reservation. This is a new bounded attempt, not a
redispatch of the uncertain attempt. If either envelope lacks headroom, stop.
A crashed request has no automatic takeover: duplicate requests return its pending
state until reviewed reconciliation. Late primary results cannot enter the writer
after another attempt has been selected. Safety refusals, invalid credentials,
ambiguity, invalid actions and exhausted allowances are not fallback triggers.

Reconciliation is an explicit operator action, not a second background process.
Require provider usage evidence or proven non-dispatch before changing an uncertain
cost. If evidence cannot identify an attempt, retain the conservative reserve.
Record settlement state and totals without storing prompts or account secrets.

## Atomic mutation receipts

Current `run()`, `add()`, `add_batch()`, `reschedule()` and other writers open their
own sessions. Wrapping their return values in a second receipt transaction is
insufficient: a crash could commit the item but lose the receipt.

For a model-proposed mutation, validate and resolve ambiguity before execution.
Persist request state `applying`, then use one session for the existing mutation,
its `Change` row, allowance consumption and `ai_request.state = completed` with
the committed result. Extract session-taking helpers only for actual supported
writer branches; existing manual HTTP callers keep thin transaction wrappers.
Never add a second writer or move mutation logic into `brain.py`.

Generate the durable receipt from rows flushed in that same session, using the
existing committed-state receipt semantics. Attach the fresh full snapshot after
commit. Failure of snapshot refresh does not erase the committed result; retry
replays it and retries only the read. A crash before commit rolls back both mutation
and receipt. A crash after commit leaves both available. There is no model fallback
once `applying` begins. An `applying` request without a completed receipt needs
reviewed recovery; it must not automatically rerun a writer.

Answers never write `Item`, planning `Setting` or `Change`. They may settle the
accounting rows above. Read-only model tools remain read-only. Bulk destructive
requests still list matches first; batch creation keeps the existing one-undo rule.

## Browser and API cutover

Cut over the backend, frontend and disclosures together after accounting passes.

* `cooper/config.py`: add server-only `SecretStr` Gemini/Groq credentials and an
  included-AI enable flag defaulting false. Remove the current unconditional server
  Gemini-key rejection only as part of guarded activation. Missing model, price,
  budget or ledger configuration keeps model dispatch disabled. Do not touch local
  binding, OAuth scopes, authentication secrets or provider token storage.
* `cooper/app.py::Say`: replace `gemini_api_key` with optional UUID
  `logical_request_id`, required for a model-needed request. Explicitly reject the
  removed key property with a value-free validation error; do not echo its value.
* `frontend/src/api.ts`: `say(text, mode, intent, logicalRequestId)` sends no key.
  Generate one `crypto.randomUUID()` per deliberate submit; retain it for retries
  of that submit, including an ambiguous response. A changed draft is a new ID.
  Handle a 202 response as `kind: pending` with `logical_request_id`; keep the
  existing submit pending and expose Retry status using the same ID. Do not treat
  it as an answer, a successful mutation or permission to create a new ID.
* `frontend/src/App.tsx`: remove `GEMINI_KEY`, `GeminiKeyStatus`, storage helpers,
  key/draft/status state, key-save callbacks and signed-in key reloads. Remove the
  Settings field, composer key-gating hint and key-target navigation. Do not use
  `localStorage.clear()`. Delete only `cooper.gemini_key.v1` and entries beginning
  `cooper.gemini_key.v1:` without reading or transmitting their values.
* `frontend/src/Onboarding.tsx`: replace `hasGeminiKey` and `gemini-key` targets with
  a Try Ask step pointing at the existing composer. A first successful deterministic
  or model answer completes it; setup never asks for a key.
* `frontend/src/types.ts`: add a server-derived `ai` view object with
  `status: ready | exhausted | unavailable`, `tier: free | pilot_plus`,
  `remaining_units`, `limit_units`, `reset_at`. Missing/disabled configuration
  returns `unavailable`; deterministic Ask remains accessible in every state.
  When no allowance row exists, report tier `free`, zero limit/remaining and the
  next UTC month boundary; do not manufacture an entitlement.
* Settings shows "Included AI", remaining allowance and reset time. On exhaustion:
  "Your included AI allowance resets on {date}. Form and basic planning still work."
  On outage: "AI is temporarily unavailable. Form and basic planning still work."
  Do not present an Upgrade button until a real billing path exists.
* Update `frontend/src/landing/LandingPage.tsx`, the existing privacy component,
  PRD, architecture, README and runbooks in that release. Verify the privacy file
  path before editing. Current runtime descriptions remain accurate until then.

No public config, browser storage, request body, response, screenshot or log may
contain either Cooper provider key. Legacy stored user keys are discarded, never
copied to the server. This changes the August browser-key design prospectively;
historical specs remain evidence of the previous implementation.

## Required acceptance evidence

1. Two concurrent identical IDs: one allowance reservation, one first dispatch,
   one mutation/undo entry; changed payload with that ID returns 409.
2. Two independent IDs competing for one unit or one remaining cash reserve:
   exactly one admits; the other dispatches zero models. Run against PostgreSQL
   as well as local SQLite; mocked counters are insufficient concurrency evidence.
3. Crash after admission, after dispatch marker, after provider result and after
   planning commit: preserve the corresponding reserves/receipt; no automatic
   duplicate call or mutation. Inject failures at each transaction boundary.
4. Primary timeout plus Groq success: keep the uncertain primary cost, settle
   fallback usage, consume one unit, share the four-attempt ceiling and deadline.
5. Refusal, invalid credentials, ambiguity and exhausted allowance: zero fallback.
   No provider dispatch after `applying` begins.
6. Answer requests leave Item, planning Setting and Change unchanged while usage
   rows settle. Manual/form/deterministic paths call no provider with or without keys.
7. Browser requests contain no key property; old storage entries are removed while
   theme/sidebar preferences survive. Settings and onboarding have no key field.
   Retry after a lost response retains the logical ID; changed input gets a new ID.
8. No-key, exhaustion and outage UI remain usable. A client-supplied Plus flag does
   not increase entitlement. Owner A cannot read/replay owner B's receipts.
9. Run Python tests/Ruff and frontend tests/format/build, inspect the running app,
   then perform live synthetic acceptance for both provider accounts without real
   calendar content. Record model IDs, price revision and privacy-control checks,
   never credentials or prompts. Provider-calendar acceptance is a separate gate.

## Approval and execution order

The four tables and the design's atomic writer/receipt integration are approved
for implementation. This approval does not supply a cash budget. Approve aggregate,
Gemini and Groq monthly cash limits, pilot-owner allowances and evaluated model IDs
before any funded dispatch. Missing approval/configuration means disabled AI.

Next, write the executable implementation plan in this order:
durable admission and replay; bounded provider adapters and settlement; atomic
writer/receipt integration; coordinated BYOK removal; live synthetic pilot acceptance.
Each unit requires failing regressions before implementation. Billing and GCP
migration have separate plans and are not prerequisites for removing user-key setup.
