# Included AI provider order

Date: 2026-09-30.

Status: Accepted. Provider order, BYOK removal, adapters, and durable accounting are implemented.
Funded dispatch is disabled and has not passed live provider acceptance. This decision does not
approve a specific model or spend amount.

## Context

Cooper supplies both provider keys and has removed BYOK from Settings, onboarding, and request
payloads. There is no optional user-key route, provider selector, or key-setup step. Local and
manual use remain independent of both providers.

## Decision

Use Gemini first. Switch to Groq only for eligible availability failures and within
the same request allowance, call limit and cost budget. If neither is usable, retain
the rule parser, manual capture and deterministic planning answers. If rules cannot
understand the request, ask for clarification; do not fabricate an action.

Do not use fallback to bypass safety refusals, ambiguity, invalid actions, invalid
credentials, exhausted user allowance or Cooper's global spending limit. Never
replay the application writer after a mutation has committed.

Keep both credentials server-side. Both providers receive only permitted sanitized
user words/titles and anonymous availability data. Switching does not authorize
sharing calendar contents, adding write tools, widening OAuth scopes or logging prompts.

Free and Plus may receive bounded included assistance only through server-authoritative
allowances. Users never configure an API key. Cooper pays provider charges, so funded dispatch
requires separately approved cash envelopes, evaluated model IDs, prices, and live acceptance.

`cooper/providers.py` contains the two explicit adapters. `ai_allowance`,
`ai_spend_envelope`, `ai_request`, and `ai_attempt` provide durable admission, cash
reservation, settlement or freeze, and replay receipts. A mutation commit and its receipt share
one transaction. The adapters and ledger are implemented, but
`COOPER_INCLUDED_AI_ENABLED=false` keeps funded dispatch off.

## Alternatives considered

- Gemini only has fewer integration/disclosure requirements but no second availability
  path. The owner explicitly requested a backup.
- User-selectable providers or optional BYOK retain a second credential path that
  the owner explicitly removed from the target product.
- A generic model router adds unnecessary policy for two named providers. Use small,
  explicit request/response adapters instead.

## Consequences

Normalize typed failures, usage, and responses from two APIs. Account for every attempt even
when one successful logical request consumes one allowance unit. Both attempts share that
logical allowance, call ceiling, and cost envelope.

Safety refusals, invalid actions, ambiguity, invalid credentials, exhausted allowance, and
exhausted spend never trigger fallback. A committed mutation is never replayed. Both providers
receive only permitted sanitized user words or titles and anonymous availability data; fallback
does not widen model input, OAuth scope, tools, or logging.

Funded activation remains gated on an approved cash envelope, evaluated and pinned Gemini/Groq
model IDs and prices, and live provider acceptance. Privacy disclosures and model/tool/schema
compatibility must cover both providers before the flag can be enabled.
