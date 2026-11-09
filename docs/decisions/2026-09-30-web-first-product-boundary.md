# Web-first product boundary

**Date:** 2026-09-30 · **Status:** Accepted owner direction

## Context and decision

Native mobile development is unaffordable for this scope. Demonstrate Cooper's planning value
before maintaining multiple products.

Build **one responsive web/PWA**, one account, and the existing shared backend. The eventual
subscription belongs to that product, not separate apps. Capture, planning, recovery, and review
are bounded workflows inside Cooper, not autonomous services or agent dashboards.

The owner clarified on 2026-10-01 that Cooper supplies Gemini and Groq keys and removes BYOK
entirely. The [provider decision](2026-09-30-included-ai-providers.md) governs fallback and funded
activation.

## Consequences and limits

- Use responsive browser layout, accessibility, and the existing PWA shell. No native clients or
  separate productivity app suite.
- Installability does not promise offline data editing or reliable closed-app reminders.
- Existing product rules remain until a deliberate change is reviewed.
- This decision does **not** approve pricing, commercial tables, recurring tasks, infrastructure
  spend, funded-AI activation, or deployment.

[PRD.md](../../PRD.md) records current coverage. [Architecture](../../ARCHITECTURE.md) records the
implemented system. Neither turns this boundary into commercial or release approval.
