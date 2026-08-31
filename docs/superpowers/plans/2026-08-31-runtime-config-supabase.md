# Runtime Configuration and Supabase Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove frontend `.env` requirements for normal Cooper use while documenting and hardening Firebase Hosting + Cloud Run + Supabase Postgres as the approved hosted path.

**Architecture:** The browser will resolve configuration at runtime. On Firebase Hosting it will obtain the public Firebase Web config from Firebase's reserved `/__/firebase/init.json` endpoint; local mode will default to same-origin `/api`, and the Vite development proxy will attach the backend's local shared key without embedding it in the frontend bundle. The backend remains the only Cooper data writer and continues to accept any SQLAlchemy-compatible PostgreSQL URL, including Supabase; Supabase Auth, Supabase client reads/writes, and Supabase Storage are out of scope.

**Tech Stack:** React 19, TypeScript, Vite, Firebase Web SDK, FastAPI, SQLAlchemy, Alembic, PostgreSQL via `psycopg`, Firebase Hosting, Cloud Run, Supabase Postgres.

**Spec:** `docs/superpowers/specs/2026-08-31-firebase-public-deployment-design.md`, with the approved Supabase Postgres provider choice recorded in the task conversation.

## Global Constraints

- Manual mode remains offline and must never call the network.
- Firebase ID tokens remain the hosted authentication boundary; local mode keeps the shared key.
- `app.py` remains the only database writer, and all rows remain owner-scoped.
- No Firebase Firestore, Supabase Auth, Supabase client-side data access, or new domain tables.
- No private value may enter a Vite bundle, runtime public config, log, or error message.
- Local servers bind to `127.0.0.1`; only the Cloud Run container listener uses its assigned `PORT` on `0.0.0.0`.
- Existing user-owned unstaged frontend changes must remain untouched unless a file is required for this feature.

---

### Task 1: Define and test runtime configuration resolution

**Files:**
- Create: `frontend/src/runtime-config.test.ts`
- Create: `frontend/src/runtime-config.ts`

**Interfaces:**
- Consumes: `window.__COOPER_CONFIG__` when a host supplies it, Firebase Hosting's public `/__/firebase/init.json`, and optional legacy `VITE_*` values for tests/alternate development hosts.
- Produces: `RuntimeConfig`, `getRuntimeConfig()`, and `loadRuntimeConfig()` for `firebase.ts`, `api.ts`, and `main.tsx`.

- [ ] **Step 1: Write the failing tests for defaults, public overrides, and Hosting fallback.**

```ts
test("defaults to same-origin local mode without environment values", () => {
  vi.stubEnv("VITE_COOPER_AUTH_MODE", "");
  vi.stubEnv("VITE_COOPER_API", "");
  vi.stubEnv("VITE_COOPER_KEY", "");
  expect(resolveRuntimeConfig()).toEqual({
    authMode: "local",
    apiBase: "",
    localKey: "",
    firebase: null,
  });
});

test("accepts a host-provided Firebase public config", () => {
  window.__COOPER_CONFIG__ = {
    apiBase: "",
    authMode: "firebase",
    firebase: {
      apiKey: "public-key",
      authDomain: "cooper.firebaseapp.com",
      projectId: "cooper",
      appId: "app-id",
    },
  };
  expect(resolveRuntimeConfig().authMode).toBe("firebase");
  expect(resolveRuntimeConfig().firebase?.projectId).toBe("cooper");
});

test("loads Firebase Hosting config and falls back when the reserved endpoint is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    apiKey: "public-key",
    authDomain: "cooper.firebaseapp.com",
    projectId: "cooper",
    appId: "app-id",
  }), { status: 200 })));
  const loaded = await loadRuntimeConfig();
  expect(loaded.authMode).toBe("firebase");
  expect(loaded.firebase?.appId).toBe("app-id");
});
```

- [ ] **Step 2: Run the focused test to verify it fails for the missing module/API.**

Run: `cd frontend && npm test -- --run src/runtime-config.test.ts`

Expected: FAIL because `runtime-config.ts` and its exported resolution functions do not exist.

- [ ] **Step 3: Implement the minimal typed runtime resolver.**

Implement `RuntimeConfig` with `authMode: "local" | "firebase"`, `apiBase`, `localKey`, and nullable Firebase public fields. Validate unknown global/fetched JSON with a record/type guard, never cast unvalidated data, and make `loadRuntimeConfig()` attempt `/__/firebase/init.json` only when no complete explicit config exists and the page is not local. Ignore a failed/invalid public endpoint and return local defaults.

- [ ] **Step 4: Run the focused test and the TypeScript check.**

Run: `cd frontend && npm test -- --run src/runtime-config.test.ts && npm run build`

Expected: all focused tests pass and TypeScript accepts the new boundary types.

- [ ] **Step 5: Commit the isolated resolver change.**

```bash
git add frontend/src/runtime-config.ts frontend/src/runtime-config.test.ts
git commit -m "feat(config): add runtime browser configuration"
```

### Task 2: Wire runtime configuration into auth, API calls, and application bootstrap

**Files:**
- Modify: `frontend/src/firebase.ts`
- Modify: `frontend/src/api.ts`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/src/firebase.test.ts`
- Modify: `frontend/src/App.test.tsx`
- Modify: `frontend/src/auth-flow.test.tsx`

**Interfaces:**
- Consumes: `getRuntimeConfig()` after `loadRuntimeConfig()` has completed in production; legacy `VITE_*` fallback remains available for isolated tests.
- Produces: Firebase initialization from resolved public config, same-origin API calls by default, and an app mount that waits for runtime config.

- [ ] **Step 1: Add failing coverage for runtime Firebase bootstrap and same-origin API defaults.**

Add a test that imports `main.tsx` with a mocked `loadRuntimeConfig()` and asserts the app is imported/mounted after the promise resolves. Add an API test that clears `VITE_COOPER_API` and verifies `fetch` receives `/api/today`, while local test configuration still sends `X-Cooper-Key` when a legacy test key is explicitly supplied.

- [ ] **Step 2: Run the focused frontend tests and verify the new assertions fail.**

Run: `cd frontend && npm test -- --run src/runtime-config.test.ts src/firebase.test.ts src/auth-flow.test.tsx src/App.test.tsx`

Expected: the new bootstrap/default assertions fail before wiring is changed.

- [ ] **Step 3: Wire Firebase and API modules to the runtime resolver.**

Replace direct `import.meta.env` reads in `firebase.ts` and `api.ts` with `getRuntimeConfig()`. Keep the existing Firebase fail-closed surface. In `main.tsx`, apply appearance immediately, await `loadRuntimeConfig()`, dynamically import `App`, then mount it; retain production-only service-worker registration after the app is mounted.

- [ ] **Step 4: Run the focused tests and the full frontend suite.**

Run: `cd frontend && npm test -- --run src/runtime-config.test.ts src/firebase.test.ts src/auth-flow.test.tsx src/App.test.tsx && npm test -- --run`

Expected: all frontend tests pass, including local shared-key and Firebase bearer-token boundaries.

- [ ] **Step 5: Commit the runtime wiring.**

```bash
git add frontend/src/firebase.ts frontend/src/api.ts frontend/src/main.tsx frontend/src/firebase.test.ts frontend/src/App.test.tsx frontend/src/auth-flow.test.tsx
git commit -m "feat(config): bootstrap frontend from runtime settings"
```

### Task 3: Remove the frontend env-file requirement from local development

**Files:**
- Modify: `frontend/vite.config.ts`
- Modify: `frontend/.env.example`
- Modify: `tests/test_deployment.py`

**Interfaces:**
- Consumes: `COOPER_SHARED_KEY` from the backend's local environment only inside the Vite development server.
- Produces: `/api` and `/health` proxy requests with the local key attached, while production builds contain no local key and default to same-origin API paths.

- [ ] **Step 1: Add deployment assertions for the no-client-env contract.**

Extend `tests/test_deployment.py` to require that the frontend example explicitly says no `.env.local` is required, that the Vite proxy reads only `COOPER_SHARED_KEY`, and that no `VITE_COOPER_KEY` or `VITE_FIREBASE_*` value is required for the default Firebase Hosting path.

- [ ] **Step 2: Run the deployment tests and verify the new assertions fail.**

Run: `uv run pytest tests/test_deployment.py -q`

Expected: FAIL because the current Vite proxy and frontend example still describe build-time client variables.

- [ ] **Step 3: Configure the Vite dev proxy to attach the backend key server-side.**

Use Vite's `loadEnv` against the repository root to read `COOPER_SHARED_KEY` for development-only proxy headers. Keep `server.host` at `127.0.0.1`, keep the existing `/api` and `/health` targets, and do not expose the key through `import.meta.env` or the built bundle.

- [ ] **Step 4: Rewrite the frontend example as a zero-file default.**

Replace the old required `VITE_*` instructions with a short note: run the backend with its local config, run `npm run dev`, and Firebase Hosting supplies its public config through `/__/firebase/init.json`. Document the optional legacy environment fallback only for non-Firebase static hosts.

- [ ] **Step 5: Run deployment tests, build, and inspect the generated bundle for private names.**

Run: `uv run pytest tests/test_deployment.py -q && cd frontend && npm run build && ! grep -R "COOPER_SHARED_KEY" dist`

Expected: deployment tests pass, the build succeeds, and the private backend key is absent from `frontend/dist`.

- [ ] **Step 6: Commit the local setup change.**

```bash
git add frontend/vite.config.ts frontend/.env.example tests/test_deployment.py
git commit -m "chore(dev): remove frontend env setup"
```

### Task 4: Document and verify Supabase Postgres as the hosted database

**Files:**
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `.env.example`
- Modify: `tests/test_deployment.py`

**Interfaces:**
- Consumes: `COOPER_DATABASE_URL=postgresql+psycopg://...` supplied only to Cloud Run/secret storage.
- Produces: an explicit Firebase + Cloud Run + Supabase Postgres deployment path with no Supabase client or second writer.

- [ ] **Step 1: Add failing documentation assertions for the approved provider split.**

Extend `tests/test_deployment.py` to require the current docs to name Supabase Postgres as the beta database option, keep Firebase Auth as identity, keep FastAPI as the sole writer, mention pooler/direct connection roles, and state that Supabase Auth/Storage are not used.

- [ ] **Step 2: Run the deployment tests and verify the new documentation assertions fail.**

Run: `uv run pytest tests/test_deployment.py -q`

Expected: FAIL because the docs currently describe Cloud SQL as the default and do not contain the approved provider split.

- [ ] **Step 3: Update the current architecture and deployment documentation.**

Document Supabase as the recommended low-cost beta Postgres provider, Cloud SQL as the single-provider alternative, the server-only connection string, Alembic migration ownership, and the use of Supabase's pooler/direct endpoints according to whether the connection is runtime or migration traffic. State that this project should use Supabase's Postgres database, not Storage buckets, and must not add Supabase Auth or client-side database access.

- [ ] **Step 4: Update the backend example without adding a client secret.**

Keep `COOPER_DATABASE_URL` generic and add commented Supabase connection examples/notes without real credentials. Preserve the existing local SQLite default and all Firebase/Google secret names.

- [ ] **Step 5: Run documentation/deployment tests and formatting.**

Run: `uv run pytest tests/test_deployment.py -q && uv run ruff check . && uv run ruff format --check . && cd frontend && npm run format:check`

Expected: all deployment assertions and format checks pass.

- [ ] **Step 6: Commit the provider documentation.**

```bash
git add README.md ARCHITECTURE.md .env.example tests/test_deployment.py
git commit -m "docs(deploy): document Supabase Postgres path"
```

### Task 5: Full verification and handoff

**Files:**
- Verify only; no source changes expected.

- [ ] **Step 1: Run the complete backend suite and checks.**

Run: `uv sync && uv run pytest && uv run ruff check . && uv run ruff format --check .`

Expected: all backend tests pass, Ruff is clean, and formatting reports no changes.

- [ ] **Step 2: Run the complete frontend suite and production build.**

Run: `cd frontend && npm install && npm test -- --run && npm run format:check && npm run build`

Expected: all frontend tests pass, Prettier is clean, and Vite produces `dist` successfully.

- [ ] **Step 3: Exercise local runtime configuration without `frontend/.env.local`.**

Temporarily move any ignored `frontend/.env.local` aside, start Vite and the backend with the root local configuration, request `/health` and an authenticated `/api/today` through the frontend proxy, and restore the file only if it was user-owned. Verify the browser page renders without the backend error banner.

- [ ] **Step 4: Inspect the diff and commit history.**

Run: `git diff --check`, `git status --short`, and `git log --oneline -n 12`. Confirm only feature/docs commits and the user's pre-existing UI edits are present.

- [ ] **Step 5: Create one final conventional commit if any verification-only fix was required.**

Use a focused subject and a body that explains why the change was necessary; do not combine unrelated UI edits.

---

## Self-review

- Firebase public configuration is loaded from a public Hosting endpoint; no secret is moved into the browser.
- Local mode remains offline-capable and keeps its shared-key boundary; the key is supplied by the dev proxy rather than the frontend environment.
- Supabase is used strictly as PostgreSQL storage, so the existing owner-scoped schema, Alembic migration, and single-writer rules remain intact.
- The plan does not add a table, background process, auth provider, or client data writer.
- Tests cover runtime defaults, hosted public config, local auth headers, Firebase bearer headers, deployment config, bundle leakage, and documentation.
