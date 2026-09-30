# Web-first product boundary

Date: 2026-09-30. Status: accepted owner direction.

## Context

The owner asked for startup-level product refinement and clarified that native
mobile development is unaffordable. "Multi-app" must not become multiple separately
maintained products before Cooper's planning value is demonstrated.

## Decision

Build one Cooper product as a responsive web/PWA application, with one account,
one subscription and the existing shared planning backend. No native mobile apps
or separate productivity app suite in this scope. Assisted capture, planning,
recovery and review are bounded workflows within Cooper, not new autonomous services.

The target hosted product provides Gemini with Groq availability fallback and removes
BYOK entirely: Cooper supplies both provider keys, as clarified by the owner on
2026-10-01. The existing [provider decision](2026-09-30-included-ai-providers.md)
continues to govern that direction. Server-funded enablement still requires
approved accounting, budgets and provider acceptance.

## Consequences

Use browser-responsive layout, accessibility and the existing PWA shell. Do not
promise offline data editing or reliable closed-app reminders merely because the
site is installable. Keep current product rules until each deliberate change is
reviewed. This decision does not approve pricing, commercial tables, recurring
tasks, infrastructure spend or deployment.

The [web-first design](../superpowers/specs/2026-09-30-cooper-web-first-product-design.md)
and [review record](../designs/cooper-web-first-review.md) contain recommended
contracts. The [capacity implementation plan](../superpowers/plans/2026-09-30-cooper-today-capacity.md)
is draft, not implemented by this ADR.
