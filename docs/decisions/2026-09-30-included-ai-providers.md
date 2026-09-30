# Included AI provider order

Date: 2026-09-30.

Status: Accepted for the initial product direction. Not implemented or deployed.
The owner approved the product proposal and requested Gemini plus Groq fallback.
This decision does not approve a specific model, spend amount or database schema.

## Context

The current implementation uses a browser-supplied Gemini key. On 2026-10-01 the
owner explicitly clarified that Cooper supplies both provider keys and removes
BYOK from the target product. This applies to Settings, onboarding and request
payloads: there is no optional user-key route, provider selector or key-setup step.
Local/manual use must remain independent of both providers.

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

Free and Plus receive bounded included assistance through server-authoritative
allowances. Users never configure an API key. Quotas do not fund the service:
Cooper pays provider charges, subject to separately approved cash envelopes.
Removing BYOK does not authorize an unspecified spend or database migration.

Retire the existing browser-key implementation in the same release that enables
verified accounting and server-managed providers. Remove the key field, key-storage
helpers and `gemini_api_key` request property; purge only Cooper's legacy Gemini
storage entries. Do not transmit stored user keys to migrate them. Existing runtime
disclosures stay accurate until that cutover; the final product has no BYOK mode.

## Alternatives considered

- Gemini only has fewer integration/disclosure requirements but no second availability
  path. The owner explicitly requested a backup.
- User-selectable providers or optional BYOK retain a second credential path that
  the owner explicitly removed from the target product.
- A generic model router adds unnecessary policy for two named providers. Use small,
  explicit request/response adapters instead.

## Consequences

Normalize typed failures, usage and responses from two APIs. Account for every
attempt, even if only one successful logical request uses a user allowance unit.
Privacy disclosures must cover both providers before automatic fallback is enabled.
Test model/tool/schema compatibility rather than infer it from API resemblance.

The [fallback specification](../superpowers/specs/2026-09-30-included-ai-provider-fallback-design.md)
defines the execution contract and acceptance cases. Durable metering, model
evaluation, provider-account controls and approved spend remain deployment gates.
No server-funded provider is enabled by this ADR.

The [accounting design](../superpowers/specs/2026-10-01-included-ai-accounting-design.md)
defines the four-table schema, transaction boundaries and cutover checks. The
owner approved that schema on 2026-10-01. Implementation may proceed; model,
allowance and cash-budget approval still precede funded activation.
