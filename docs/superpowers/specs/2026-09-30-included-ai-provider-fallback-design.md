# Included AI provider fallback design

Date: 2026-09-30. Provider order approved by the owner; detailed execution contract
specified here for implementation review. No runtime changes or live provider calls.

Related documents: [accepted provider decision](../../decisions/2026-09-30-included-ai-providers.md),
[approved product direction](../../designs/cooper-product-rethink.md).

## Scope and architecture

Gemini is primary; Groq is the initial availability fallback. The user sees Cooper,
not a provider picker. Local/manual operation and curated deterministic questions
stay model-free. This design covers parsing and read-only answers, not new scheduling
authority, background generation, model ranking or third-party web/search tools.

The current `Brain` combines transport, validation and prompts. Keep `Action`
validation and sanitization shared. Add explicit Gemini/Groq request and response
conversion using existing standard-library HTTP facilities. No provider SDK or generic
plugin framework is needed for these two named APIs.

## Request contract

Each model-assisted request has an authenticated owner, an idempotency identity,
a shared call counter, a monotonic deadline and durable cost reservations. The
counter covers parsing, JSON repair, tools, answer fallback and both providers.
The proposed ceiling remains four external calls total, not four per provider.

Use a 25-second model-chain deadline and at most eight seconds per attempt as initial
test settings, not published latency guarantees. A fallback needs a remaining call
slot, sufficient time and budget. Provider calendar reads have their own bounded
path; this deadline does not bound the whole API request.

Start each new admitted request on Gemini. After an eligible failure, switch once
to Groq and keep the remaining model turns there. Never switch back. If Groq fails,
end the model path. No hidden SDK retries, backoff loop, background retry or third
provider. Provider-specific project availability limits are distinct from Cooper's
aggregate budget and user allowance.

## Failure handling

| Result                                                         | Groq fallback?                                                  | Required behavior                                                  |
| -------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| Usable Gemini result                                           | No                                                              | Use once; preserve billed usage                                    |
| Gemini timeout/connection failure                              | Yes, within remaining limits                                    | Keep unknown-cost reservation; discard any late primary output     |
| Gemini temporary 429/provider rate limit                       | Yes, if Groq independently permitted                            | Respect primary retry timing; no primary retry within this request |
| Gemini 500/502/503/504                                         | Yes, within remaining limits                                    | Record only sanitized availability category                        |
| Gemini 401/403 or missing configuration                        | No automatic failover                                           | Flag deployment configuration; keep rule/manual operation          |
| Invalid schema/request, unsupported model or oversized context | No                                                              | Fix configuration/request or ask; do not hide adapter defects      |
| Safety refusal/off-topic request                               | No                                                              | Return bounded refusal/clarification                               |
| Action validation failure or ambiguous reference               | No                                                              | Existing validation/409/conversation behavior                      |
| User allowance or Cooper global budget exhausted               | No                                                              | Zero model dispatch; deterministic/manual work remains usable      |
| Gemini-specific spend limit reached                            | Only if separately budgeted Groq and aggregate admission permit | No implicit permission to bypass a total cost stop                 |
| Groq fails or total calls/deadline exhausted                   | No further model                                                | Rules if understood, otherwise an explicit question                |
| Mutation already committed                                     | Never                                                           | Return/replay verified receipt; do not reparse or rerun            |

Normalize status codes and documented structured errors, not raw message matching.
Never return a provider error body to the browser. Current broad exception-to-`None`
transport behavior loses these distinctions and needs typed outcomes. Limit catches
to provider transport/decoding errors; do not mask unrelated application failures.
[Groq error reference](https://console.groq.com/docs/errors).

## Models, schema and tools

Use explicit model IDs rather than floating `latest` aliases. Gemini Flash-Lite
versions remain candidates. First evaluate Groq's `openai/gpt-oss-20b`, currently
listed as a production model. No model-quality or Cooper latency benchmark has run.
[Groq production models](https://console.groq.com/docs/models).

For parsing, use JSON-schema output supported by the selected Groq model. Strict
format requires every field to be required and objects to disallow extra properties.
Represent optional fields as nullable, normalize nulls and validate the same `Action`.
Do not blindly reuse the existing Gemini schema. Schema-valid output still needs
semantic checks for intent, dates, exact duration and scope.

For read-only tool turns, use Groq's tool-call format without strict response format.
Groq documents that structured outputs cannot be combined with tool use. Build the
two request modes separately and validate tool names/arguments independently.
[Groq structured outputs](https://console.groq.com/docs/structured-outputs).

Normalize text, calls, assistant/tool history and billed usage before application
code consumes them. Do not forward raw Gemini candidates, private reasoning,
thought signatures or provider metadata. During mid-conversation failover, rebuild
a minimal sanitized history from application-owned facts. No already-run mutation
is part of that history or eligible for replay.

Expose only Cooper's existing bounded local read tools. Reject unknown tools. Never
expose `apply_plan`, Gmail refresh, built-in web search, code execution or remote MCP
because a vendor supports them. Tool arguments cannot choose an owner or credentials.

Evaluate both providers on single tasks, additive batches, exact local moves,
off-topic/refusal handling, role-marker and stored-title injection, ambiguity,
unknown duration and read-only answers with unavailable calendars. A semantic failure
blocks that capability on the provider; a backup cannot silently weaken safety.

## Shared spending and privacy

One useful completed request consumes at most one user allowance unit. Each model
attempt consumes its own call slot and cost reservation, including primary timeout
plus fallback success. Duplicate request identities must not dispatch or charge again.
Keep uncertain costs reserved until reconciled. Include billed reasoning/thinking
tokens in measured usage and bound all supported billed output categories.

Use separate provider allocations plus one aggregate Cooper budget. Google Cloud
spend caps do not cover Groq billing. Provider free quotas are not a durable product
ledger. Groq publishes organization-level limits; account-specific limits need live
configuration verification before choosing the pilot size.
[Groq rate limits](https://console.groq.com/docs/rate-limits).

Keys stay in server-managed secrets, never localStorage, public configuration,
browser request bodies or logs. Deliberately migrate current hosted key-entry behavior
only after accounting is active. An AI-disabled local configuration must still work.

Before Groq activation, verify data controls and enable inference ZDR. Groq documents
limited reliability/abuse retention without ZDR and retained usage metadata despite
content controls. This does not establish product-wide or Gemini zero retention.
Disable persistence features outside this design and name both providers in the
actual Privacy page before automatic transfers are enabled.
[Groq data controls](https://console.groq.com/docs/your-data).

No model email-body fallback in this tranche. Gmail's deterministic parsing stays
unchanged. Only own words/titles and anonymous busy intervals are eligible here;
attendees, addresses, provider titles and calendar descriptions remain excluded.
Any later model email processing requires a separate explicit policy.

## Implementation sequence and file boundaries

1. Transport/normalization in `cooper/brain.py`, pure regressions in
   `tests/test_cooper.py`. Typed outcomes, response provenance and schema compatibility;
   no funded-key enablement yet.
2. Separate commercial schema specification for owner/request reservations,
   uniqueness, transactions and migrations. Do not substitute unlocked settings JSON
   counters or treat this provider decision as approval for unspecified tables.
3. Orchestration in `cooper/app.py` and `cooper/config.py`, with HTTP/accounting
   tests in `tests/test_api.py`. Owner admission, idempotency, shared call/deadline
   budget and one eligible switch. Preserve authentication, binding and token storage.
4. Hosted secrets and frontend experience in `frontend/src/App.tsx`,
   `frontend/src/api.ts`, `frontend/src/types.ts` and existing relevant tests. Remove
   all BYOK entry and browser-key request/storage paths only when accounting is
   active; preserve manual and outage paths. The owner clarified on 2026-10-01 that
   Cooper supplies both keys and the final product has no optional BYOK mode.
5. Privacy copy, PRD, architecture, AGENTS, README and runbooks. Verify the actual
   Privacy component path before editing. Record live synthetic AI acceptance
   separately from Google/iCloud connected-account acceptance, without prompts or keys.

The [accounting design](2026-10-01-included-ai-accounting-design.md) specifies the
tables and transaction boundaries, approved by the owner on 2026-10-01.
This is a subsystem specification, not an executable billing/migration plan.
Exact accounting schema and spend envelope must be resolved before funded-key
activation. The approved planning-trust repairs depend on neither.

## Acceptance cases

| Case                                                             | Observable result                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Manual form/curated planning question                            | Zero calls to both providers                                  |
| Gemini success                                                   | Zero Groq calls; accurate provenance                          |
| Eligible Gemini failure, Groq success                            | One switch, one user unit, both costs accounted               |
| Safety refusal, invalid credentials, ambiguity or invalid action | Zero failover calls; no unverified mutation                   |
| User/global budget exhausted                                     | Zero provider calls; core capture/planning remains usable     |
| Both unavailable                                                 | Rules or clarification; no retry loop or false success        |
| Late primary output                                              | Discarded; never a second writer invocation                   |
| Tool-turn failover                                               | Sanitized normalized history; no provider content/write tools |
| Four calls already used                                          | No fifth call, including JSON repair or fallback              |
| Duplicate/concurrent request identity                            | Single logical receipt/allowance; transactional reservations  |
| Unknown tool/invalid time                                        | Existing application validation rejects it                    |
| No keys locally                                                  | Existing rule/manual operation remains usable                 |
| Logs and responses inspected                                     | No raw provider errors, secrets, prompts or calendar contents |

Require mocked transport, HTTP ownership/accounting, adversarial semantic tests and
bounded live synthetic smoke tests on both configured providers. No live AI acceptance
was performed during this design update.
