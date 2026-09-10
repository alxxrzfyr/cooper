# Calendar Fidelity, AI Loading, and Onboarding Design

## Goal

Make Cooper's Calendar an accurate, readable view of local, Google, and iCloud events; restore the intended three-step Ask loading state; and retain a non-blocking, persistent onboarding tour.

## Decisions

- Month headers use uppercase three-letter weekday labels: `MON` through `SUN`.
- Provider events are normalized into one display contract. Known fields receive structured rendering; provider fields not otherwise represented are retained as labeled metadata rather than being discarded or silently clipped.
- Long descriptions, guest lists, links, attachments, reminder records, and metadata remain whole. The event sheet constrains itself to the viewport and its body is the vertical scrolling region.
- A Cooper-created fixed event is rendered through the same event-detail surface as imported events. Its existing item actions remain available.
- The `/api/say` response remains the immediate source of truth for the UI. Regression coverage proves the returned scheduled item reaches Calendar without waiting for polling.
- Ask restores three visible, sequential status rows. The loading UI reflects local request phases only; it never pretends that a remote provider call occurred.
- The existing three-step onboarding flow remains the product tour because it already uses progressive disclosure, optional setup steps, persistence, skip/finish controls, and a Settings relaunch. Tests protect those guarantees.

## Provider boundary

Google and iCloud normalization stays server-side. Metadata is returned only to the signed-in event owner for display; it is never supplied to Gemini prompts. Cooper continues to write only blocks it owns in Google Calendar and never writes to iCloud.

## Verification

- Python parser/API tests cover complete Google/iCloud metadata and AI-created event visibility.
- Vitest covers uppercase Month labels, event details for local and imported records, all three loading rows, and onboarding controls/persistence.
- Full backend/frontend test suites, formatter/linter checks, production build, and a browser smoke test are run before completion.
