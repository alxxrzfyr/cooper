# Included AI provider order

**Date:** 2026-09-30 · **Status:** Accepted

This decision selects provider order and credential ownership, not a model or spend amount.
Adapters, BYOK removal, and durable accounting are implemented. Funded dispatch remains disabled
and has not passed live acceptance.
[Architecture](../../ARCHITECTURE.md#included-ai-accounting) owns implementation details.

## Decision

Cooper supplies both server-side keys: **Gemini primary, Groq availability fallback**. There is no
user API key, provider selector, or key-setup flow. If neither provider is usable, retain manual
capture, the rule parser, and deterministic planning answers. Ask when rules cannot understand a
request.

Both attempts share one logical allowance, call ceiling, and cost envelope. Account for every
attempt even when a successful logical request consumes one allowance unit. Fallback must never:

- Bypass safety refusal, ambiguity, invalid action or credentials, exhausted allowance, or spend
  limits.
- Replay the writer after a mutation commits.
- Widen input beyond permitted sanitized user words and titles plus anonymous availability data.
- Share provider calendar contents, add write tools, widen OAuth scopes, or log prompts.

Free and Plus included assistance, if activated, uses server-authoritative allowances. Cooper pays
the provider costs. A proposed plan is not an active paid entitlement.

## Activation gates

Keep `COOPER_INCLUDED_AI_ENABLED=false` until all of these have separate approval and evidence:

1. Cash envelopes and user allowances.
2. Evaluated, pinned Gemini and Groq model IDs and reviewed prices.
3. Live-provider acceptance, separate from mocked transport tests.
4. Privacy disclosures and model, tool, and schema compatibility covering both providers.

The four accounting tables provide admission, pre-dispatch reservation, settlement or freeze, and
replay receipts. A mutation and its receipt commit together. Their presence does not satisfy the
activation gates by itself.

## Alternatives and trade-offs

- **Gemini only:** simpler, but lacks the backup explicitly requested by the owner.
- **Selectable providers or BYOK:** retains the second credential path the owner removed.
- **Generic router:** unnecessary policy for two named providers. Use explicit adapters with
  normalized typed failures, responses, and usage instead.
