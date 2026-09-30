# Included AI Implementation Plan

> **For agentic workers:** Use subagent-driven-development for independent transport/UI tasks and execute shared writer integration sequentially. Preserve existing working-tree edits; no commit or deployment is authorized.

**Goal:** Implement approved durable funded-AI accounting and retire BYOK while preserving core operation without models.

**Architecture:** Four SQLAlchemy tables hold allowances, service spend envelopes, requests and attempts. `app.py` owns ledger mutations and uses the existing writers in one request-scoped transaction for atomic receipts. Pure provider adapters normalize Gemini and Groq; browser state carries logical request IDs, never provider credentials.

**Tech Stack:** Existing Python/SQLAlchemy/Alembic/urllib and React/TypeScript. No new dependency or background process.

**Spec:** `docs/superpowers/specs/2026-10-01-included-ai-accounting-design.md` and existing provider fallback specification.

## Global Constraints

- Schema approval is recorded; funded budgets, model IDs and active quotas are not supplied.
- Funded dispatch defaults disabled; configuration and operator-provisioned rows are both required.
- All new timestamps use `Utc`; all money uses integer microdollars.
- Manual/rule/deterministic paths reserve no credits and call no models.
- `brain.py` never accesses storage; `app.py` remains the sole writer.
- Owner-scoped request IDs, conditional counter updates, no automatic crash takeover.
- One logical request: one allowance unit, four maximum calls, one monotonic deadline.
- Retain uncertain costs and no fallback after mutation begins.
- Preserve local binding, OAuth scopes, token storage and existing worktree.

## Task 1: Tables and admission

Files: `cooper/db.py`, `migrations/versions/0002_included_ai_accounting.py`, `cooper/app.py`, `cooper/config.py`, `tests/test_api.py`.

Models: `AiAllowance`, `AiSpendEnvelope`, `AiRequest`, `AiAttempt`; exact fields/constraints come from the approved schema table.

- [x] Add table-shape, constraint and UTC regressions, observe failure.
- [x] Add approved models and migration; verify fresh and existing SQLite upgrades.
- [x] Add config defaulting disabled, server SecretStr credentials and pinned model/price fields; reject incomplete activation.
- [x] Implement `provision_ai_pilot(owner_id, limit_units, aggregate_microusd, gemini_microusd, groq_microusd)` in app.py for explicit operator provisioning, with no HTTP entitlement endpoint.
- [x] Implement owner-period conditional admission, unique IDs/digests and pending/completed replay. Test independent requests racing for one unit, duplicate IDs and owner isolation against real transactions.

Core admission assertion:
```python
with store.session() as session:
    row = session.get(AiAllowance, (owner_id, period))
    assert row.reserved_units + row.consumed_units <= row.limit_units
```
Run `uv run pytest tests/test_api.py -q` after the failing regressions and implementation.

## Task 2: Bounded provider transport

Files: create `cooper/providers.py`; modify `cooper/brain.py`; tests `tests/test_cooper.py`.

Produce `ProviderReply(envelope, input_tokens, output_tokens)` and `ProviderFailure(kind)`; `generate(provider, key, model, body, timeout)` returns normalized Gemini-shaped envelope plus measured usage. `Brain` accepts an optional `dispatch(body)` callback for every action, answer and tool turn, avoiding hidden/unmetered network calls.

- [x] Write transport tests for sanitized shapes, safety refusal, timeout/429, credentials, missing usage and Groq tool-format translation.
- [x] Implement urllib transports without SDK/dependency or DB access.
- [x] Route every Brain model call through the callback when present; retain current validation and pure rules.
- [x] Verify current parser/tool/answer tests and new transport tests.

Run `uv run pytest tests/test_cooper.py -q`.

## Task 3: Dispatch accounting and atomic receipts

Files: `cooper/app.py`, `cooper/db.py`, tests `tests/test_api.py`.

Consume provider reply/failure and Brain dispatch callback. The callback acquires each attempt reserve before its call and settles measured usage afterward. One request-owned deadline and attempt count spans parse, repair and read tools. Introduce a request-scoped existing-session binding only for funded writer execution so every existing writer joins the same transaction without duplicating mutation logic.

- [x] Write regressions for zero calls without admission, uncertain primary plus separately reserved fallback, four-call exhaustion and missing usage.
- [x] Implement reserve/dispatch/settle/freeze transitions using conditional updates in app.py. Never retry an uncertain attempt.
- [x] Write injected-failure tests before writer commit and after writer commit; assert Item/Change/request/allowance roll back or commit together.
- [x] Persist `applying`, then execute the existing writer and final receipt in one session. Read refreshed snapshots after commit, not as an additional mutation.
- [x] Test answered requests leave Item/Setting/Change unchanged and retries replay one committed mutation.

Representative replay assertion:
```python
first = client.post("/api/say", json=payload, headers=HEADERS)
second = client.post("/api/say", json=payload, headers=HEADERS)
assert first.json()["item"]["id"] == second.json()["item"]["id"]
```
Run focused crash/concurrency tests, then `uv run pytest`.

## Task 4: Complete browser-key retirement

Files: `frontend/src/App.tsx`, `api.ts`, `types.ts`, `Onboarding.tsx`, existing landing/privacy components and related tests; `cooper/app.py::Say`.

API: `say(text, mode, intent?, logicalRequestId?)`, no key argument. View: `ai.status` ready/exhausted/unavailable; tier, remaining/limit units and reset_at from server. Reply adds `pending` with logical_request_id.

- [x] Write HTTP regression rejecting gemini_api_key without echoing its value.
- [x] Write frontend regressions for no key setup, scoped legacy-key cleanup and same-ID retry after ambiguous responses.
- [x] Remove Gemini storage/state/controls and onboarding key targets; retain deterministic Ask when unavailable.
- [x] Generate a UUID per deliberate AI submission, retain it for ambiguous retries and pending responses, change it for new text.
- [x] Show included allowance/exhaustion/outage states, no nonfunctional upgrade CTA.
- [x] Update current disclosures only after coordinated backend removal; test local no-key setup.

Run `npm test -- --no-file-parallelism`, `npm run format:check`, `npm run build` in frontend.

## Task 5: Review, running acceptance and context

- [x] Review shared file/interfaces and security/privacy behavior; address actionable findings.
- [x] Run pytest, Ruff check/format, frontend tests/format/build and `git diff --check`.
- [x] Run isolated local app, inspect no-key Settings/onboarding/Ask, allowance pending/exhausted and manual capture. Record browser evidence separately from connected providers.
- [x] Synchronize AGENTS, PRD, architecture, README, roadmap and operator activation/reconciliation instructions.
- [x] Leave funded activation disabled without approved budgets/model evaluations/live provider checks. Do not claim PostgreSQL concurrency evidence unless run against PostgreSQL.

## Operator activation and reconciliation

Funded dispatch needs every item below; any missing value keeps AI disabled and
startup rejects a partial configuration.

1. Set `COOPER_INCLUDED_AI_ENABLED=true`, `COOPER_GEMINI_API_KEY`, `COOPER_GROQ_API_KEY`,
   pinned `COOPER_GEMINI_MODEL`/`COOPER_GROQ_MODEL` (no `latest` alias),
   `COOPER_AI_PRICE_REVISION` and the four `COOPER_*_MICROUSD_PER_MILLION` prices.
2. From a Python shell, call `cooper.app.provision_ai_pilot(owner_id, limit_units,
   aggregate_microusd, gemini_microusd, groq_microusd)` for each pilot owner. There is
   no HTTP entitlement endpoint.
3. Abandoned request (worker died while pending): `abandon_ai_request(request_id)`. It
   never re-dispatches or re-applies a mutation.
4. Uncertain attempt: `reconcile_ai_attempt(attempt_id, input_tokens=..., output_tokens=...)`
   with provider usage evidence, or `proven_not_dispatched=True`.
5. Frozen envelopes (missing usage or price/budget review): `review_ai_envelopes(period)`.

Recommended pilot envelope (not configured; owner approval still required): aggregate
$25/month (25,000,000 microUSD), Gemini $20, Groq $10, 300 requests per owner per month.
With the 8,192 input / 384 output token bounds and at most four calls per request, a
flash-lite-class price keeps the worst case near $0.004 per request, so 20 pilot owners
at full allowance stay inside the aggregate. Re-derive from the evaluated model prices.

## Execution record

No task is complete until its behavioral checks pass. Runtime activation and commercial billing are separate from implementation completion. No push, deployment or real paid provider call is authorized by this plan.

2026-10-01: Tasks 1–4 implemented with regressions. Backend 486 pytest pass (preflight
tests now isolate exported `COOPER_*` shell variables), Ruff check/format clean, frontend
241 tests pass and production build succeeds. Concurrency tests ran on SQLite only; no
PostgreSQL evidence. Browser acceptance of no-key Settings/onboarding/Ask, allowance
states and manual capture was run and confirmed by the owner on 2026-10-01 (the agent
environment blocked launching dev servers). This is local, no-provider evidence only.
No live Gemini/Groq or connected-calendar check has been run. Funded dispatch remains
disabled.
