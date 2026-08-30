# Firebase Public Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google-only Firebase accounts, durable per-user ownership, PostgreSQL persistence, and a Firebase Hosting/Cloud Run deployment path while retaining Cooper’s offline local mode and single-writer guarantees.

**Architecture:** Firebase Authentication identifies a person; it does not grant Calendar or Gmail access. The Vite SPA sends a Firebase ID token to FastAPI, Cloud Run verifies it, and every SQLAlchemy query is scoped to that UID. A separate per-owner Google OAuth grant supplies read-only Gmail/Calendar access, while PostgreSQL stores durable state and a managed timer invokes one aggregate Gmail sync pass.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Alembic, PostgreSQL via `psycopg`, Firebase Admin SDK, Firebase Web SDK, Vite/React/TypeScript, Cloud Run, Firebase Hosting, Cloud Scheduler, pytest, Vitest, Ruff, Prettier.

**Spec:** `docs/superpowers/specs/2026-08-31-firebase-public-deployment-design.md`

## Global Constraints

- `COOPER_AUTH_MODE=local` keeps the existing `X-Cooper-Key` and SQLite offline path; `COOPER_AUTH_MODE=firebase` accepts only a verified Firebase ID token.
- Every `item`, `setting`, and `change` row has an owner; request data, browser storage, and URL parameters never choose the owner.
- `app.py` remains the only database writer. `brain.py`, `auth.py`, `google.py`, `sources.py`, and `watcher.py` return values or proposals only.
- Google Calendar is the only remote write; Gmail is read-only, and only the existing Calendar Events and Gmail Readonly scopes are requested.
- The server never stores or falls back to `COOPER_GEMINI_API_KEY`; an AI request may carry a browser-provided key, while Manual mode never uses the network.
- Remote errors never block local capture/ranking/scheduling and never log tokens, message ids, bodies, attendee data, prompts, or secrets.
- Production persistence uses `COOPER_DATABASE_URL` with SQLAlchemy/Alembic; no database-specific SQL or second domain table is added.
- Local development binds `127.0.0.1`; the Cloud Run listener exception is confined to the deployment container command and documented as such.
- Do not alter the existing mascot/icon/wordmark configuration or stage the seven dirty frontend files that predate this work.
- New runtime dependencies are pinned to `firebase-admin==7.5.0`, `alembic==1.19.1`, and `psycopg[binary]==3.3.4`; the frontend adds `firebase==12.18.0`.
- Each task ends with its focused tests and a conventional commit whose body explains why the change exists.

## File Map

| File | Responsibility in this work |
| --- | --- |
| `cooper/auth.py` | Lazy Firebase Admin initialization, token verification, allowlist checks, and the `AuthIdentity` value. |
| `cooper/config.py` | Auth mode, Firebase project id, allowed emails, OAuth-state/scheduler secrets, and browser-only Gemini configuration. |
| `cooper/db.py` | Owner-aware SQLAlchemy models and query helpers; no SQLite-only schema patching. |
| `alembic.ini`, `migrations/env.py`, `migrations/versions/0001_public_ownership.py` | Versioned schema upgrade for existing local data and fresh PostgreSQL databases. |
| `cooper/app.py` | Request identity boundary, owner-scoped business operations, per-owner Google clients, OAuth callback, and aggregate sync route. |
| `cooper/google.py` | Per-owner Calendar/Gmail clients and encrypted refresh-token plumbing without global token state. |
| `cooper/sources.py`, `cooper/watcher.py` | Owner-scoped busy windows, one local watcher loop, and hosted aggregate sync adapter. |
| `cooper/brain.py` | Request-scoped model construction only; no server-key fallback. |
| `frontend/src/firebase.ts` | Firebase Web SDK initialization and Google redirect/sign-out helpers. |
| `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/types.ts` | ID-token request headers, auth-state gate, sign-in/out controls, and typed API data. |
| `Dockerfile`, `firebase.json`, `frontend/.env.example`, `.env.example` | Reproducible Cloud Run/Hosting configuration without checked-in secrets. |
| `README.md`, `ARCHITECTURE.md`, `PRD.md` | Setup, security boundaries, deployment status, and the Spark/Blaze cost caveat. |
| `tests/test_auth.py`, `tests/test_db.py`, `tests/test_deployment.py`, updated API/Google tests and frontend tests | Regression coverage for identity, isolation, OAuth, browser auth, migrations, and deploy wiring. |

---

### Task 1: Add explicit auth modes and Firebase token verification

**Files:**

- Create: `cooper/auth.py`, `tests/test_auth.py`
- Modify: `cooper/config.py`, `cooper/app.py` only for the import-safe auth seam, `pyproject.toml`, `uv.lock`, `.env.example`

**Interfaces:**

- `AuthIdentity(uid: str, email: str)` is an immutable dataclass.
- `verify_firebase_token(token: str, *, project_id: str) -> AuthIdentity` calls `firebase_admin.auth.verify_id_token` lazily and rejects missing uid, unverified email, wrong audience, expired tokens, and malformed claims with `AuthFailure(status_code=401, detail="Invalid authentication token")`.
- `check_allowed_email(identity: AuthIdentity, allowed: frozenset[str]) -> None` raises `AuthFailure(status_code=403, detail="Account is not allowed")` when the non-empty allowlist does not contain the normalized email.
- `Settings` exposes `auth_mode: Literal["local", "firebase"]`, `firebase_project_id`, and `allowed_emails: tuple[str, ...]`; Firebase mode rejects an empty allowlist at startup with a clear configuration error.

- [ ] **Step 1: Write failing verification tests.**

```python
def test_firebase_identity_requires_verified_email(monkeypatch):
    monkeypatch.setattr(
        "firebase_admin.auth.verify_id_token",
        lambda token: {"uid": "u1", "email": "a@example.com", "email_verified": False},
    )
    with pytest.raises(AuthFailure) as error:
        verify_firebase_token("token", project_id="project")
    assert error.value.status_code == 401


def test_allowlist_is_case_insensitive():
    identity = AuthIdentity(uid="u1", email="Friend@Example.com")
    check_allowed_email(identity, frozenset({"friend@example.com"}))
```

- [ ] **Step 2: Run the focused tests and confirm the missing auth seam fails.**

Run: `uv run pytest tests/test_auth.py -q`

Expected: collection or assertion failures because `cooper.auth` and the new settings fields do not exist.

- [ ] **Step 3: Implement the lazy verifier and settings validation.** Keep Firebase Admin initialization out of module import so local mode works without credentials; pass `project_id` to verification and normalize email with `casefold()`.

- [ ] **Step 4: Run the focused tests and static checks.**

Run: `uv run pytest tests/test_auth.py -q && uv run ruff check cooper/auth.py cooper/config.py tests/test_auth.py`

Expected: all auth tests pass and Ruff reports no findings.

- [ ] **Step 5: Commit the boundary.**

```bash
git add cooper/auth.py cooper/config.py pyproject.toml uv.lock .env.example tests/test_auth.py
git commit -m "feat(auth): add Firebase identity verification" -m "Separate public account identity from the existing local shared-key mode so hosted requests can be scoped before any database access."
```

### Task 2: Make the SQLAlchemy model and migrations owner-aware

**Files:**

- Modify: `cooper/db.py`, `cooper/app.py` constructors that create `Item`/`Change`, `tests/test_cooper.py`
- Create: `tests/test_db.py`, `alembic.ini`, `migrations/env.py`, `migrations/versions/0001_public_ownership.py`
- Modify: `pyproject.toml`, `uv.lock`

**Interfaces:**

- `Item.owner_id: Mapped[str]` is `String(128)` and required; `Setting` has `owner_id: String(128)` and composite primary key `(owner_id, key)`; `Change.owner_id: String(128)` is required.
- `Store.get_setting(owner_id: str, key: str, default: object = None)`, `Store.set_setting(owner_id: str, key: str, value: object)`, `Store.open_items(session, owner_id: str)`, `Store.record(session, owner_id: str, label: str, item: Item, before: dict | None)`, and `Store.last_change(session, owner_id: str)` all require an owner id.
- `Item.to_dict()` includes `owner_id`, `source`, and `source_ref`; no serializer returns rows for another owner.
- Alembic revision `0001_public_ownership` upgrades a legacy three-table database by adding owner/source columns with `local` defaults, rebuilding `setting` with a composite key, adding `change.owner_id`, and creating owner indexes through Alembic operations. A fresh database can run the same revision without duplicate rows.

- [ ] **Step 1: Add failing model and migration tests.** Verify two owners can use the same setting key, `open_items` and `last_change` are isolated, serialized ownership is present, and `alembic upgrade head` works against a disposable SQLite URL.

```python
def test_setting_keys_are_scoped_by_owner(store):
    store.set_setting("u1", "hours", {"start": 9})
    store.set_setting("u2", "hours", {"start": 11})
    assert store.get_setting("u1", "hours") != store.get_setting("u2", "hours")
```

- [ ] **Step 2: Run the focused tests and confirm the current global-key model fails.**

Run: `uv run pytest tests/test_db.py -q`

- [ ] **Step 3: Update models and helpers.** Remove `_add_new_columns()` and every `PRAGMA`/SQLite `ALTER TABLE` path. Keep the UTC type and `create_all` only for an empty local database; callers supply owner ids explicitly.

- [ ] **Step 4: Implement the Alembic revision and environment.** Read `COOPER_DATABASE_URL`, configure the existing SQLAlchemy metadata, preserve legacy rows as owner `local`, and make the revision safe to run once on both SQLite and PostgreSQL.

- [ ] **Step 5: Run migration and model tests plus formatting.**

Run: `uv run pytest tests/test_db.py tests/test_cooper.py -q && uv run ruff check cooper/db.py migrations tests/test_db.py && uv run ruff format --check cooper/db.py migrations tests/test_db.py`

- [ ] **Step 6: Commit the schema contract.**

```bash
git add cooper/db.py migrations alembic.ini pyproject.toml uv.lock tests/test_db.py tests/test_cooper.py
git commit -m "feat(db): add durable owner-scoped persistence" -m "Move ownership into every row and replace the SQLite-only column patch with a repeatable migration so PostgreSQL can become the hosted source of truth."
```

### Task 3: Enforce request ownership through every backend route

**Files:**

- Modify: `cooper/app.py`, `cooper/sources.py`, `tests/test_api.py`, `tests/test_cooper.py`
- Modify: `cooper/auth.py` only if the request adapter needs a small typed helper

**Interfaces:**

- `request_owner(request: Request) -> AuthIdentity` returns `request.state.identity` and never reads an owner id from input data.
- Local middleware sets `AuthIdentity(settings.owner_id, "local")` after checking `X-Cooper-Key`; Firebase middleware verifies the bearer token and applies the allowlist before the request reaches a route.
- All route helpers (`today_view`, `run`, `add`, `find`, `change_existing`, `undo_last`, `set_hours`, Google/Gmail status, and source collection) receive `owner_id: str` explicitly.
- `today_view(owner_id)` and `sources.busy_windows(store, owner_id, calendar, ...)` return only that owner’s local and external rows.

- [ ] **Step 1: Add failing HTTP isolation tests.** Create two local-mode test clients with different configured owners against one database, then assert `/api/today`, `/api/items`, `/api/changes`, and undo cannot see or mutate the other owner’s rows. Add a Firebase-mode test that sends a shared key and receives 401, and an unlisted verified email that receives 403 before a store query.

- [ ] **Step 2: Run the focused API tests and record the current cross-owner/global-setting failures.**

Run: `uv run pytest tests/test_api.py -q`

- [ ] **Step 3: Thread the verified identity through middleware, dependency helpers, and every business function.** Keep local mode’s existing tests working by using `settings.owner_id`; reject malformed bearer headers with the same generic 401 response.

- [ ] **Step 4: Scope prompt context, ranking, busy windows, settings, change pruning, undo snapshots, and response serialization.** A request must never be able to choose `owner_id` in a body, query, path, or browser storage value.

- [ ] **Step 5: Run backend API/unit tests and inspect a real authenticated response.**

Run: `uv run pytest tests/test_api.py tests/test_cooper.py -q && uv run ruff check cooper/app.py cooper/sources.py tests/test_api.py tests/test_cooper.py`

- [ ] **Step 6: Commit the isolation boundary.**

```bash
git add cooper/app.py cooper/sources.py cooper/auth.py tests/test_api.py tests/test_cooper.py
git commit -m "feat(api): enforce owner-scoped requests" -m "Resolve ownership once at the authentication boundary and carry it through reads, writes, prompts, sources, and undo so accounts cannot cross data paths."
```

### Task 4: Split Firebase identity from per-owner Google service grants

**Files:**

- Modify: `cooper/google.py`, `cooper/app.py`, `cooper/config.py`, `tests/test_api.py`, `tests/test_cooper.py`
- Create: `tests/test_google_ownership.py`

**Interfaces:**

- `GOOGLE_SCOPES` remains exactly `calendar.events` plus `gmail.readonly`.
- `Calendar(..., refresh_token: str | None = None)` and `Gmail(calendar: Calendar)` are constructed per owner; no module-global token, calendar, or Gmail object remains.
- `Store` keys for Google state are owner-scoped: `google_token`, `google_connected`, and `google_oauth_nonce` (nonce value contains expiry and is single-use).
- `OAuthState(owner_id: str, nonce: str, expires_at: datetime)` is signed with `COOPER_OAUTH_STATE_SECRET`; `POST /api/google/connect` creates a durable nonce, and `/api/google/callback` verifies, consumes, and then exchanges it.
- `POST /api/google/disconnect` clears only the authenticated owner’s encrypted token; remote revoke is best effort. `POST /api/google/sync` runs only that owner’s pass.

- [ ] **Step 1: Add failing tests for per-owner token loading and OAuth replay.** Assert two owners receive different Calendar clients/tokens, a callback cannot be replayed, a mismatched owner is rejected, and disconnecting one account does not change the other’s setting.

- [ ] **Step 2: Run the focused tests and confirm global `app.state`/setting behavior fails isolation.**

Run: `uv run pytest tests/test_google_ownership.py tests/test_api.py -q`

- [ ] **Step 3: Implement owner factories and durable state.** Keep Fernet encryption, do not log token material, and delete the nonce before exchanging the authorization code so a second callback is harmless.

- [ ] **Step 4: Refactor Gmail sync and Calendar event paths to use the owner factory.** Preserve `google_event_id` for Cooper-written blocks and `source_ref` for read-only provider events.

- [ ] **Step 5: Run Google privacy/read-only tests and Ruff.**

Run: `uv run pytest tests/test_google_ownership.py tests/test_watcher.py tests/test_api.py -q && uv run ruff check cooper/google.py cooper/app.py tests/test_google_ownership.py`

- [ ] **Step 6: Commit the separated grants.**

```bash
git add cooper/google.py cooper/app.py cooper/config.py tests/test_google_ownership.py tests/test_api.py tests/test_cooper.py
git commit -m "feat(google): store service grants per owner" -m "Keep Firebase sign-in independent from Calendar and Gmail consent, and make OAuth state durable across Cloud Run instances."
```

### Task 5: Make Gmail sync and the watcher owner-aware, including hosted aggregation

**Files:**

- Modify: `cooper/watcher.py`, `cooper/sources.py`, `cooper/app.py`, `cooper/config.py`, `tests/test_watcher.py`, `tests/test_api.py`

**Interfaces:**

- `sync_gmail_once(owner_id: str) -> SyncSummary` remains the only writer for parsed Gmail commitments and records only counts/timestamps/error text in owner-scoped settings.
- `Watcher(run_once: Callable[[], SyncSummary], interval_seconds: int).run_forever(stop_event: threading.Event | None = None)` performs one fixed interval loop with no retry tiers or second consumer.
- `POST /api/internal/google/sync` requires `X-Cooper-Sync-Secret`, iterates connected owner ids, continues after an owner failure, and returns aggregate counts only (`owners`, `imported`, `updated`, `cancelled`, `skipped`, `failed`). It accepts no Firebase user token and never returns titles, bodies, ids, or tokens.
- `today_view(owner_id)["gmail"]` reports `configured`, `connected`, `last_checked`, `last_error`, `imported`, and `skipped` for that owner.

- [ ] **Step 1: Add failing sync/loop tests.** Cover idempotent owner-scoped reconciliation, cancellation/move, source failure isolation, fixed interval invocation, sync-secret rejection, aggregate continuation, and health projection.

- [ ] **Step 2: Run the focused tests and confirm the current single-global sync path fails.**

Run: `uv run pytest tests/test_watcher.py tests/test_api.py -q`

- [ ] **Step 3: Thread `owner_id` through Gmail parsing/reconciliation and busy-window collection.** Keep message bodies and raw ids inside the parser/client boundary; all persisted proposals pass the existing validation gate before `app.py` writes them.

- [ ] **Step 4: Add the aggregate route and local watcher adapter.** The aggregate endpoint uses the same sync function as a user-triggered sync, loads owner ids from PostgreSQL, and records one failure per owner without aborting the pass.

- [ ] **Step 5: Run watcher/API/Gmail privacy tests and formatting.**

Run: `uv run pytest tests/test_watcher.py tests/test_api.py tests/test_cooper.py -q && uv run ruff check cooper/watcher.py cooper/sources.py cooper/app.py tests/test_watcher.py`

- [ ] **Step 6: Commit the sync contract.**

```bash
git add cooper/watcher.py cooper/sources.py cooper/app.py cooper/config.py tests/test_watcher.py tests/test_api.py
git commit -m "feat(sync): add owner-scoped Gmail aggregation" -m "Reuse one bounded reconciliation path for local and hosted timers while making health and failures visible per account."
```

### Task 6: Remove server Gemini configuration and preserve request-scoped AI

**Files:**

- Modify: `cooper/config.py`, `cooper/app.py`, `cooper/brain.py`, `tests/test_api.py`, `tests/test_cooper.py`, `.env.example`, `README.md`

**Interfaces:**

- `Settings` no longer exposes `gemini_api_key` or reads `COOPER_GEMINI_API_KEY`; `gemini_model` remains available.
- `POST /api/say` accepts an optional `gemini_api_key` request field, constructs a short-lived `Brain(api_key=...)` for that request only, and never persists/returns/logs the key.
- Manual/form routes construct `Brain(api_key=None)` and do not import or call the network model path.
- Existing `sanitize_for_prompt()` and validated `Action` behavior remain unchanged.

- [ ] **Step 1: Add failing tests.** Assert the server settings reject the old environment variable, a browser key is used only for one AI request, no key appears in a response or setting, and Manual mode succeeds with a network-call sentinel that would fail if invoked.

- [ ] **Step 2: Run focused tests and confirm the current server fallback is observable.**

Run: `uv run pytest tests/test_api.py tests/test_cooper.py -q`

- [ ] **Step 3: Remove the server field/fallback and simplify the app’s model availability logic.** Keep the local regex/rule path as the default and preserve the existing malformed-model-action rejection.

- [ ] **Step 4: Run AI/manual/privacy tests and Ruff.**

Run: `uv run pytest tests/test_api.py tests/test_cooper.py -q && uv run ruff check cooper/config.py cooper/app.py cooper/brain.py tests/test_api.py tests/test_cooper.py`

- [ ] **Step 5: Commit the key boundary.**

```bash
git add cooper/config.py cooper/app.py cooper/brain.py tests/test_api.py tests/test_cooper.py .env.example README.md
git commit -m "fix(ai): remove server-side Gemini fallback" -m "Keep model access explicitly request-scoped in the browser so hosted configuration cannot accidentally retain or expose a shared AI secret."
```

### Task 7: Add Firebase Web auth and authenticated API calls without touching mascot branding

**Files:**

- Create: `frontend/src/firebase.ts`, `frontend/.env.example`
- Modify: `frontend/src/api.ts`, `frontend/src/App.tsx`, `frontend/src/types.ts`, `frontend/package.json`, `frontend/package-lock.json`, `frontend/src/App.test.tsx`
- Read before editing: `/home/home/.agents/skills/typescript-best-practices/SKILL.md`

**Interfaces:**

- `frontend/src/firebase.ts` exports `firebaseConfigured`, `auth`, `signInWithGoogle()`, `signOutUser()`, and `subscribeToAuth(callback: (user: FirebaseUser | null) => void): Unsubscribe`.
- `api.call()` awaits the current Firebase user’s `getIdToken()` in Firebase mode and sends `Authorization: Bearer <token>`; local mode continues to send `X-Cooper-Key`. `VITE_COOPER_API` defaults to an empty string for Hosting rewrites, so paths remain `/api/...`.
- The app waits for auth initialization before fetching `/api/today`; signed-out users see a focused Google sign-in state, signed-in users see the existing app, and sign-out clears only client auth state.
- The existing Gemini localStorage key, mascot assets, Cooper wordmark, theme tokens, and the user’s dirty UI changes remain intact.

- [ ] **Step 1: Add failing component/API tests.** Cover Firebase loading, signed-out sign-in, signed-in `/api/today` with a bearer token, local-mode shared-key compatibility, sign-out, and no change to mascot/name rendering.

- [ ] **Step 2: Run frontend tests and confirm the auth module/API seam is absent.**

Run: `cd frontend && npm test -- --run`

- [ ] **Step 3: Install the pinned Firebase Web SDK and implement initialization.** Use the redirect flow with `GoogleAuthProvider`; never request Calendar/Gmail scopes from Firebase sign-in.

- [ ] **Step 4: Add the auth gate and token-aware API wrapper.** Avoid loading any protected data while auth is unresolved, handle expired-token 401s by returning to the signed-out state, and keep Manual mode available after sign-in without a Gemini key.

- [ ] **Step 5: Run TypeScript formatting, tests, and build.**

Run: `cd frontend && npm install && npm test -- --run && npm run format:check && npm run build`

- [ ] **Step 6: Commit the client auth path.**

```bash
git add frontend/src/firebase.ts frontend/src/api.ts frontend/src/App.tsx frontend/src/types.ts frontend/package.json frontend/package-lock.json frontend/src/App.test.tsx frontend/.env.example
git commit -m "feat(ui): add Firebase Google sign-in" -m "Authenticate public users at the Hosting boundary while keeping Google service consent separate and preserving the local offline mode."
```

### Task 8: Add deploy artifacts and update the operator documentation

**Files:**

- Create: `Dockerfile`, `firebase.json`, `tests/test_deployment.py`
- Modify: `.env.example`, `README.md`, `ARCHITECTURE.md`, `PRD.md`

**Interfaces:**

- `Dockerfile` installs the pinned Python dependencies, runs `alembic upgrade head` as the release entrypoint, and starts Uvicorn on Cloud Run’s assigned `$PORT`; it contains no secret values. The local command remains `uv run uvicorn cooper.app:app --host 127.0.0.1`.
- `firebase.json` serves `frontend/dist` and rewrites `/api/**` plus the OAuth callback path to service id `cooper-api` in region `asia-southeast1`; no project-specific `.firebaserc` is committed.
- `.env.example` documents the exact local and hosted variables, including empty `VITE_COOPER_API`, Firebase public config, `COOPER_ALLOWED_EMAILS`, database URL, encrypted token key, OAuth-state secret, and scheduler secret.
- README setup explains Firebase Google provider setup, Google OAuth callback/scope setup, Gmail restricted-scope verification/testing, Cloud SQL or compatible PostgreSQL, `alembic upgrade head`, Hosting deploy, Cloud Run/Blaze billing, budget alerts, and the Spark limitation that prevents Cloud Run.

- [ ] **Step 1: Add failing deployment-contract tests.** Parse `firebase.json`, assert `/api/**` rewrites to `cooper-api`, assert no secret is in the frontend env example, and verify the Dockerfile runs migrations before the server.

- [ ] **Step 2: Run the focused tests and confirm the deploy files do not exist.**

Run: `uv run pytest tests/test_deployment.py -q`

- [ ] **Step 3: Add the Docker/Hosting files and documentation.** State clearly that linking billing upgrades Firebase to Blaze; Spark remains suitable for Auth/Hosting-only experiments, not the FastAPI/watcher/PostgreSQL architecture.

- [ ] **Step 4: Run deployment-contract tests, docs checks, and a container syntax check.**

Run: `uv run pytest tests/test_deployment.py -q && uv run ruff check tests/test_deployment.py && git diff --check`

- [ ] **Step 5: Commit the deploy path.**

```bash
git add Dockerfile firebase.json tests/test_deployment.py .env.example README.md ARCHITECTURE.md PRD.md
git commit -m "feat(deploy): add Firebase Hosting and Cloud Run path" -m "Document the smallest public deployment that preserves SQL ownership, durable OAuth state, and the offline local fallback while making Blaze billing explicit."
```

### Task 9: Verify the integrated system and hand off the commit history

**Files:**

- Modify only if verification exposes a focused defect: the files above; do not touch unrelated dirty UI files.

- [ ] **Step 1: Run the complete backend suite and formatting checks.**

Run: `uv sync && uv run pytest && uv run ruff check . && uv run ruff format --check .`

- [ ] **Step 2: Run the complete frontend suite and production build.**

Run: `cd frontend && npm install && npm test -- --run && npm run format:check && npm run build`

- [ ] **Step 3: Exercise migrations and the local HTTP path.** Run `alembic upgrade head` against a disposable SQLite database, start the app on `127.0.0.1`, call `/health`, then call `/api/today` with the local shared key and confirm the response owner is `local`.

- [ ] **Step 4: Inspect the app in a browser.** Check signed-out, signed-in mock, empty dashboard, Manual mode without a model key, Google disconnected, and imported read-only event states. Confirm the mascot/icon/Cooper wordmark and the user’s existing theme/UI edits are unchanged.

- [ ] **Step 5: Review the complete diff and history.** Run `git status --short`, `git diff --check`, `git diff --stat`, and `git log --oneline --decorate --all`; ensure only feature files are staged and the pre-existing frontend modifications remain unstaged.

- [ ] **Step 6: Commit only focused verification fixes, then report all history.** Use a conventional message with a body explaining the root cause, and include the full `git log --oneline --decorate --all` output in the final handoff as requested.

