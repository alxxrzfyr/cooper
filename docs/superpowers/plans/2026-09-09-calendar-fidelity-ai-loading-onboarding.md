# Calendar Fidelity, AI Loading, and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve complete event information in Calendar, restore three Ask loading statuses, and verify the guided onboarding experience.

**Architecture:** Normalize Google/iCloud event data into `CalendarEvent`, including a generic metadata list for provider fields that do not have a dedicated UI row. Render local fixed events through the same detail frame. `App` owns both immediate post-Ask `View` replacement and the three sequential loading rows.

**Tech Stack:** Python, FastAPI, React, TypeScript, Vitest, pytest, CSS.

**Spec:** `docs/superpowers/specs/2026-09-09-calendar-fidelity-ai-loading-onboarding-design.md`

## Global Constraints

- `app.py` remains the only database writer.
- Google is the only remote writer; iCloud stays read-only.
- Event metadata is display-only and never enters a model prompt.
- Do not truncate provider detail values.
- Onboarding is dismissible, optional, persistent per signed-in user, and never blocks the application.

---

### Task 1: Preserve and expose provider event detail

**Files:** `cooper/google.py`, `cooper/icloud.py`, `cooper/app.py`, `frontend/src/types.ts`, `tests/test_cooper.py`, `tests/test_icloud.py`, `tests/test_api.py`

- [ ] Write failing parser/API tests for long descriptions, every attendee, organizer email, links, reminders, attachments, calendar/source information, and provider metadata.
- [ ] Run the focused tests and confirm each fails because current normalization truncates or omits fields.
- [ ] Add typed event detail fields and provider metadata normalization without changing scheduling inputs or write permissions.
- [ ] Run focused tests, then `uv run pytest` and Ruff checks.

### Task 2: Render complete, viewport-safe event details

**Files:** `frontend/src/calendar-data.ts`, `frontend/src/Calendar.tsx`, `frontend/src/Frame.tsx`, `frontend/src/theme.css`, `frontend/src/test/App.test.tsx`, `frontend/src/test/Frame.test.tsx`

- [ ] Write failing tests for `MON` through `SUN`, a local fixed event opening the event frame, and every detailed provider field rendering in a scrollable body.
- [ ] Run the focused tests and confirm they fail against the current Calendar.
- [ ] Implement the normalized event frame and preserve local event actions; make long values wrap and body scrolling independent of the fixed sheet header/footer.
- [ ] Run focused tests and the full frontend suite.

### Task 3: Restore AI loading and prove immediate Calendar synchronization

**Files:** `frontend/src/App.tsx`, `frontend/src/Chat.tsx`, `frontend/src/test/App.test.tsx`, `tests/test_api.py`

- [ ] Write failing tests for three visible initial Ask status rows and the new AI event appearing in Calendar from the returned `View`.
- [ ] Run the focused tests and confirm they fail because one trace row is seeded.
- [ ] Seed all three truthful local request phases and keep the returned `View` as the immediate UI state source.
- [ ] Run focused tests and complete backend/frontend suites.

### Task 4: Verify guided onboarding

**Files:** `frontend/src/Onboarding.tsx`, `frontend/src/App.tsx`, `frontend/src/test/Onboarding.test.tsx`, `frontend/src/test/App.test.tsx`

- [ ] Add only missing regression coverage for skip, finish, optional steps, persisted dismissal, and Settings relaunch.
- [ ] Run onboarding tests and inspect the flow in the running app.
- [ ] Run `npm run format:check`, `npm run build`, `git diff --check`, and the complete project verification set.
