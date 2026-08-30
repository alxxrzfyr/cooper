# Google Calendar + Gmail Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the PRD-scoped Google ecosystem: Calendar remains the only remote writer, while a read-only Gmail watcher imports and reconciles known event confirmations as busy commitments.

**Architecture:** Keep REST-only Google access with shared OAuth/token plumbing in `cooper/google.py`. Add a focused Gmail parser/client and a timer boundary in `cooper/watcher.py`; the watcher returns proposals, while `cooper/app.py` alone validates and persists external rows. Extend `sources.py` to merge open Gmail rows with Calendar and local blocks, and expose one sync/health surface to the existing UI.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Pydantic Settings, stdlib `urllib`/`email`/`html`, React + TypeScript, Vitest, pytest, Ruff, Prettier.

**Spec:** `docs/superpowers/specs/2026-08-30-google-ecosystem-design.md`

## Global Constraints

- Google Calendar remains the only remote writer; Gmail is read-only.
- Request only `calendar.events` and restricted `gmail.readonly`; never request Gmail send/modify scopes.
- `app.py` is the only database writer. Email parsing produces proposals and passes `brain.validate` before persistence.
- No Gmail body, raw message id, location, attendee address, token, or prompt is logged or persisted.
- Manual mode and all local capture/ranking/scheduling work with no Google or Gemini credentials.
- Add no table, dependency, queue, retry tiers, broker, worker pool, or second background process.
- All timestamps stored through the existing UTC SQLAlchemy type; incoming wall-clock values carry the configured timezone before validation.
- Preserve the existing favicon/package edits; feature commits must stage only feature files.

---

### Task 1: Extend the item schema for owned external commitments

**Files:**

- Modify: `cooper/db.py` (`Item`, serialization, existing `_add_new_columns` compatibility helper)
- Modify: `cooper/config.py` (single local owner id)
- Modify: `cooper/app.py` item constructors to set `owner_id` and `source`
- Test: `tests/test_cooper.py`, `tests/test_api.py`

**Interfaces:**

- `Item.owner_id: str`, `Item.source: str`, `Item.source_ref: str | None`.
- `Item.to_dict()` includes the three fields.
- Existing databases receive defaults in the one existing compatibility helper; fresh databases use SQLAlchemy metadata.

- [ ] **Step 1: Write failing model/API tests** for default local ownership/source, serialized fields, and external fields round-tripping.
- [ ] **Step 2: Run the focused tests** and confirm they fail for missing columns/fields.
- [ ] **Step 3: Add the three additive columns** with safe `local`/`me` defaults and extend the existing helper in place without creating another SQL migration path.
- [ ] **Step 4: Set explicit owner/source values** on every local item constructor and include fields in API serialization/types as needed.
- [ ] **Step 5: Run focused backend tests and Ruff.**
- [ ] **Step 6: Commit** `feat(db): model owned external commitments`.

### Task 2: Harden shared Google OAuth and add Gmail REST access

**Files:**

- Modify: `cooper/google.py`
- Modify: `cooper/app.py` OAuth setup/disconnect and client construction
- Modify: `cooper/config.py`, `.env.example`, `README.md`
- Test: `tests/test_cooper.py`, `tests/test_api.py`

**Interfaces:**

- `GOOGLE_SCOPES` contains exactly Calendar events and Gmail readonly scopes.
- `Calendar.access_token()` exposes the shared refreshed access token to the Gmail client without exposing credentials.
- `Gmail.list_messages(*, after: datetime, max_results: int) -> list[GmailMessage]` and `Gmail.get_message(message_id: str) -> GmailMessage` use fixed Gmail REST endpoints and never write.
- `GmailMessage` carries only ephemeral headers/body/internal timestamp for the parser; raw IDs never leave the client boundary.
- `Calendar.revoke()` is best-effort; disconnect always clears the local encrypted token.

- [ ] **Step 1: Add failing tests** for the exact OAuth scope string, shared token refresh, Gmail list/get request paths, sender-query shape, HTTP failure conversion, and disconnect revocation isolation.
- [ ] **Step 2: Run the focused tests** and confirm they fail.
- [ ] **Step 3: Implement shared token plumbing** without changing Calendar’s deterministic event IDs or read/write boundaries.
- [ ] **Step 4: Implement Gmail REST list/get** with fixed sender query and bounded lookback, base64url decoding, and no logging.
- [ ] **Step 5: Add best-effort revoke** and ensure callback seals/loads one token value exactly once.
- [ ] **Step 6: Document Gmail API enablement, restricted scope/testing caveat, and watcher command.**
- [ ] **Step 7: Run focused backend tests and Ruff.**
- [ ] **Step 8: Commit** `feat(google): add shared Gmail readonly access`.

### Task 3: Build safe Gmail confirmation parsing

**Files:**

- Create: `cooper/watcher.py` (parser and proposal dataclasses; timer added in Task 5)
- Test: `tests/test_watcher.py`

**Interfaces:**

- `EmailProposal(provider: str, title: str, source_ref: str, start: datetime | None, end: datetime | None, cancelled: bool)`.
- `parse_confirmation(message: GmailMessage, *, timezone: str, now: datetime) -> EmailProposal | None`.
- Fixed allowlist for Luma, Meetup, and Eventbrite sender domains; unknown senders return `None`.

- [ ] **Step 1: Write parser tests** for plain text/HTML bodies, each provider, explicit date/time ranges, reference extraction, cancellation, duplicate normalization, malformed/ambiguous input, and sender rejection.
- [ ] **Step 2: Run parser tests** and confirm they fail.
- [ ] **Step 3: Implement in-memory body decoding/HTML stripping** and provider sender verification.
- [ ] **Step 4: Implement strict date/time/reference extraction** with configured timezone; reject incomplete or ambiguous events rather than guessing.
- [ ] **Step 5: Ensure returned proposals contain no body or raw Gmail message id** and run parser tests/Ruff.
- [ ] **Step 6: Commit** `feat(gmail): parse known event confirmations safely`.

### Task 4: Persist and reconcile Gmail proposals through app.py

**Files:**

- Modify: `cooper/app.py`
- Modify: `cooper/sources.py`
- Modify: `cooper/db.py` only if query helper is needed
- Test: `tests/test_api.py`, `tests/test_cooper.py`, `tests/test_watcher.py`

**Interfaces:**

- `sync_gmail_once() -> SyncSummary` lives in `app.py` and is the only writer for Gmail rows.
- New proposals become open `event` Items with `owner_id`, `source="gmail"`, and `source_ref`.
- Existing `source_ref` rows update title/start/end/category; cancelled proposals mark them `dropped`.
- `sources.busy_windows()` merges open Gmail intervals without double-counting local rows.
- External event serialization includes `source` while preserving existing Google event behavior.

- [ ] **Step 1: Add failing API/unit tests** for new import, idempotent repeat, moved event, cancellation, ambiguous skip, source failure isolation, no Change/undo entry, and Gmail busy-window inclusion.
- [ ] **Step 2: Run focused tests** and confirm they fail.
- [ ] **Step 3: Implement one transactional upsert/reconcile path** with public `brain.validate` on every proposal and no calls to Calendar writers.
- [ ] **Step 4: Split local vs Gmail interval collection** so every open commitment appears exactly once in the planner input.
- [ ] **Step 5: Add Gmail health setting updates** (`last_checked`, `last_error`, counts) while discarding message bodies.
- [ ] **Step 6: Run backend tests/Ruff and inspect serialized API payloads.**
- [ ] **Step 7: Commit** `feat(gmail): reconcile imported commitments`.

### Task 5: Add sync endpoint and the single watcher loop

**Files:**

- Modify: `cooper/app.py` (protected sync route and health in `today_view`)
- Modify: `cooper/watcher.py` (timer/loop using app callback)
- Modify: `cooper/config.py`, `.env.example`, `README.md`
- Test: `tests/test_api.py`, `tests/test_watcher.py`

**Interfaces:**

- `POST /api/google/sync -> {summary, view}` runs one isolated sync.
- `Watcher(run_once: Callable[[], SyncSummary], interval_seconds: int).run_forever(stop_event=None)` is the only background loop.
- `python -m cooper.watcher` starts the loop; no watcher writes the database directly.
- `today_view()["gmail"]` reports configured/connected/last_checked/last_error/imported/skipped.

- [ ] **Step 1: Add failing API/loop tests** for auth protection, offline no-op, health timestamps, callback invocation, fixed interval, and no retry tiers.
- [ ] **Step 2: Run focused tests** and confirm they fail.
- [ ] **Step 3: Implement the route and health projection** using the Task 4 sync function.
- [ ] **Step 4: Implement the small timer loop** with one fixed sleep and graceful stop; keep imports safe when Google is unconfigured.
- [ ] **Step 5: Add command/docs/config defaults** and run backend tests/Ruff.
- [ ] **Step 6: Commit** `feat(gmail): add resilient sync watcher`.

### Task 6: Surface Google/Gmail status and read-only events in the frontend

**Files:**

- Modify: `frontend/src/types.ts`, `frontend/src/api.ts`
- Modify: `frontend/src/App.tsx`, `frontend/src/Home.tsx`, `frontend/src/Calendar.tsx`, `frontend/src/theme.css`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**

- `View.gmail` mirrors the backend health shape; external events carry `source: "google" | "gmail"`.
- `api.syncGoogle()` calls the protected sync endpoint.
- Settings renders Calendar/Gmail status and `Sync now`; Gmail events are outlined and have no completion/drop controls.

- [ ] **Step 1: Add failing component tests** for disconnected/offline status, sync button behavior, last-checked/error text, Gmail event labels, and no action affordances.
- [ ] **Step 2: Run frontend tests** and confirm they fail.
- [ ] **Step 3: Implement types/API and Settings status** using existing notice styles and theme tokens.
- [ ] **Step 4: Render Gmail entries in Home/Calendar** without duplicating Cooper-owned blocks or adding a green side treatment.
- [ ] **Step 5: Run `npm test -- --run`, Prettier check, and build.**
- [ ] **Step 6: Commit** `feat(ui): surface Google sync health`.

### Task 7: Full verification, browser check, and integration commit

**Files:**

- Modify: `README.md`, `ARCHITECTURE.md`, `PRD.md` only if implementation status text is stale
- Test: all backend/frontend suites

- [ ] **Step 1: Run `uv run pytest`.**
- [ ] **Step 2: Run `uv run ruff check . && uv run ruff format --check .`.**
- [ ] **Step 3: Run frontend format check, tests, and build.**
- [ ] **Step 4: Run `git diff --check` and inspect the complete diff for scope/security violations.**
- [ ] **Step 5: Start the app on localhost and inspect disconnected, connected-mock, empty, and imported-event states in a browser.**
- [ ] **Step 6: Commit any final docs/status adjustments** with a meaningful conventional message, then show the full commit history requested by the user.
