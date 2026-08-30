# Firebase Accounts and Public Cloud Deployment Design

## Goal

Make Cooper safe for a small group of authenticated friends and family while preserving the
local-first planner, the single database writer, the read-only Gmail bridge, and manual mode's
offline/rule-based behavior. Firebase supplies Google-only account sign-in and static hosting;
the existing Python service remains the application backend.

## Decision

Use Firebase Authentication with the Google provider, Firebase Hosting for the Vite single-page
application, FastAPI on Cloud Run, and PostgreSQL accessed through SQLAlchemy. Cloud SQL for
PostgreSQL is the default database because it is in the same Google Cloud project and has a
first-party Cloud Run connection path. Any standards-compliant PostgreSQL service can be used by
setting `COOPER_DATABASE_URL`; Supabase PostgreSQL is a compatible cost alternative, but it is not
the identity provider.

This is a Firebase-plus-Cloud-Run deployment, not a Spark-only deployment. Firebase Spark covers
Google Authentication and static Hosting, but Cloud Run, Cloud Functions, and a production
Cloud SQL instance require a billing account and move the project to Blaze. A budget alert and a
small resource cap are part of deployment, but no provider's free quota is treated as a permanent
price guarantee.

## Scope

Included:

- Google-only Firebase Authentication for Cooper accounts.
- An optional email allowlist for a friends-and-family deployment.
- Firebase ID-token verification at the FastAPI boundary.
- Per-user ownership for every `item`, `setting`, and `change` row.
- Per-user working hours, undo history, Google connection, Gmail health, and encrypted refresh
  token state.
- A separate Google service grant for Calendar event access and Gmail read-only access; signing
  into Cooper never grants Gmail or Calendar access automatically.
- Firebase Hosting rewrites for `/api/**` to the Cloud Run service.
- PostgreSQL schema migrations and a deploy-time migration command.
- A managed five-minute sync trigger for Gmail that replaces the local watcher loop in hosted
  deployments while retaining `python -m cooper.watcher` for local use.
- Browser-only Gemini configuration; the server-side `COOPER_GEMINI_API_KEY` fallback is removed.
- Local development mode that continues to use the existing shared key and SQLite database.

Explicitly excluded:

- Email/password, phone, or non-Google identity providers.
- Firestore as a second data store or a rewrite of the SQLAlchemy domain model.
- Firebase client-side reads or writes for Cooper data; all mutations remain in `app.py`.
- Google Drive, Tasks, Meet, Contacts, Classroom, or any other unimplemented Google API.
- Public administration, billing, teams, roles, invitations UI, or general multi-tenant product
  management.
- A second application writer, queue, retry tier, broker, or worker pool.
- Sending mail, RSVP, or modifying Google events Cooper did not create.

## Runtime architecture

```text
browser
  ├─ Firebase Auth Google sign-in → Firebase ID token
  ├─ Firebase Hosting serves the Vite SPA
  └─ /api/** → Firebase Hosting rewrite → FastAPI on Cloud Run
                                      ├─ verifies Firebase ID token
                                      ├─ scopes all reads/writes to token.uid
                                      ├─ calls Gemini only with a request browser key
                                      ├─ calls Google Calendar/Gmail with that user's grant
                                      └─ PostgreSQL through SQLAlchemy

Cloud Scheduler → authenticated sync endpoint → one Gmail sync pass for connected owners
```

Firebase Hosting is the public web origin. The API is reached through the same origin so the
frontend does not need a production shared key or a broad CORS rule. The Cloud Run service may
still have a direct URL for health checks, but user traffic uses the Hosting rewrite.

The hosted sync endpoint is a managed timer invocation, not a second consumer. It performs one
bounded pass over each connected owner, records health independently per owner, and continues
after a remote failure. The local watcher remains a fixed timer/loop for offline development.

## Authentication and ownership

### Client flow

The frontend initializes the Firebase Web SDK from public `VITE_FIREBASE_*` configuration and
uses `GoogleAuthProvider` with the redirect flow. It waits for Firebase's auth-state observer
before loading `/api/today`. Every API request obtains the current user's ID token and sends:

```text
Authorization: Bearer <firebase-id-token>
```

The client exposes the signed-in email and a sign-out action. A missing Firebase configuration is
allowed only in local mode, where the existing `X-Cooper-Key` path remains available for tests and
offline development.

### Server boundary

`cooper/auth.py` owns lazy Firebase Admin initialization and ID-token verification. The FastAPI
middleware has two explicit modes:

- `COOPER_AUTH_MODE=local`: require the existing `X-Cooper-Key` and use `COOPER_OWNER_ID` (default
  `local`). This is the development/offline path.
- `COOPER_AUTH_MODE=firebase`: require a valid Firebase ID token, verify its issuer, audience,
  signature, expiry, and `email_verified` claim, then attach the token `uid` and normalized email
  to the request context. The shared key is not accepted in this mode.

The optional `COOPER_ALLOWED_EMAILS` list is a comma-separated, case-insensitive allowlist. In
Firebase mode it is required to be non-empty for the friends-and-family deployment; a verified
email not on the list receives 403 before any database query. This is a deployment guard, not a
new account-management system.

The backend never trusts an owner id from a JSON body, query string, URL, or browser storage. All
business functions resolve the owner from the verified request context (or an explicit owner id
only inside the scheduler and tests).

### Row ownership

Every persisted row carries an owner id:

- `item.owner_id` is widened to 128 characters to cover Firebase UID limits.
- `setting` gains `owner_id` and uses `(owner_id, key)` as its primary key.
- `change` gains `owner_id`; undo and pruning are scoped to that owner.

Every item, setting, change, ranking query, busy-window query, prompt context, and API response is
filtered by the authenticated owner. Existing local rows retain `owner_id="local"`; a one-time
explicit migration command may reassign them to the first Firebase UID before the public service
is opened. No automatic cross-account adoption occurs.

## Google Calendar and Gmail

Firebase sign-in and Google service access are two different grants:

1. Firebase signs the person into Cooper and gives the backend a Firebase UID.
2. Settings' **Connect Google** button calls an authenticated Cooper endpoint.
3. Cooper creates a short-lived, one-use OAuth state containing the verified owner id, nonce, and
   expiry, then redirects to Google's consent page.
4. Google returns to the backend callback. The callback validates the encrypted/signed state,
   consumes the nonce, exchanges the code, encrypts the refresh token with Fernet, and stores it
   under that owner.

The service grant requests exactly the existing Calendar events and Gmail read-only scopes. Gmail
remains restricted and read-only. Calendar reads only bounded busy intervals and writes/deletes
only Cooper-owned blocks. An owner can disconnect without affecting anyone else's grant.

`Calendar` and `Gmail` clients are created from the requesting owner’s stored token rather than
from one process-global token. The normal user sync route operates only on that owner. The hosted
sync route enumerates owners with a connected Google setting, runs the same reconciliation path for
each, and stores per-owner `last_checked`, `last_error`, and counts.

OAuth callback state cannot live in `app.state` because a serverless/container deployment may send
the start and callback requests to different instances. State is encrypted/signed with a
server-only key and its nonce is stored as a short-lived owner setting; the callback deletes the
nonce before exchanging the code. A replay, expired state, or owner mismatch is rejected without a
database or Google mutation.

## Gemini behavior

`COOPER_GEMINI_API_KEY` and the server-side `Settings.gemini_api_key` field are removed. The model
name remains configuration. Each browser may store its own Gemini key in local storage and send it
only on an AI request; the backend never persists, logs, or returns the key. AI availability is
therefore request-scoped and owner-independent. Without a browser key, rule parsing and all local
ranking/scheduling still work. Manual mode never calls Gemini and never needs a key.

## Database and migrations

PostgreSQL is the production persistence layer. Add the `psycopg` SQLAlchemy driver and Alembic as
runtime/deployment dependencies. `COOPER_DATABASE_URL` is the only database selection; examples
use `postgresql+psycopg://...` with TLS supplied by the provider.

The current SQLite-only `_add_new_columns()` path is deleted. A versioned, SQLAlchemy/Alembic
migration creates owner columns, the composite setting key, owner-scoped change history, and the
required indexes. Deployment runs `alembic upgrade head` before starting the web service. Local
SQLite remains supported by running the same metadata/migration setup in tests and development;
the public service never relies on an ephemeral SQLite file.

The initial production migration is idempotent and preserves existing `local` data. A separate
one-time data command can assign those rows to a specified Firebase UID after the owner confirms
the target. No migration silently merges two users.

## Deployment contract

Frontend build variables:

```text
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
VITE_COOPER_API=
```

These Firebase values are public client configuration. No secret is placed in the Vite bundle.

Cloud Run variables/secrets:

```text
COOPER_AUTH_MODE=firebase
COOPER_ORIGIN=https://<firebase-site>.web.app
COOPER_DATABASE_URL=postgresql+psycopg://...
COOPER_FIREBASE_PROJECT_ID=...
COOPER_ALLOWED_EMAILS=friend@example.com,family@example.com
COOPER_GOOGLE_CLIENT_ID=...
COOPER_GOOGLE_CLIENT_SECRET=...
COOPER_GOOGLE_REDIRECT_URI=https://<firebase-site>.web.app/api/google/callback
COOPER_ENCRYPTION_KEY=...
COOPER_OAUTH_STATE_SECRET=...
COOPER_SYNC_SECRET=...
COOPER_TIMEZONE=Asia/Singapore
```

Google Cloud OAuth lists the Hosting callback URL exactly. Firebase Hosting rewrites that callback
to Cloud Run. Client secrets, database URLs, Fernet keys, OAuth-state keys, and scheduler secrets
are backend/secret-manager values only.

Cloud Scheduler invokes the hosted sync endpoint every five minutes over HTTPS with the scheduler
secret. The endpoint accepts no Firebase user token and returns only aggregate counts; it never
returns titles, bodies, message ids, or tokens. A Cloud Run instance may scale to zero between
requests, so all state required by a sync pass is loaded from PostgreSQL.

## Failure and privacy boundaries

- Invalid Firebase credentials return 401; disallowed verified emails return 403.
- A valid owner can never read another owner’s items, settings, changes, health, prompts, or
  Google account email.
- Remote Calendar/Gmail failures leave local captures and scheduling available.
- A Gmail body and raw message id remain inside the transport/parser boundary and never enter the
  database, model prompt, response, or logs.
- A changed encryption key makes stored Google connections appear disconnected; it does not expose
  or reassign any token.
- Gemini requests include only the authenticated user's own text/titles and the request's browser
  key. Manual mode performs no model call.
- The hosted service binds through Cloud Run's assigned port; local development remains bound to
  `127.0.0.1` and never to `0.0.0.0`.

## Verification

Backend tests cover Firebase token verification, local-mode compatibility, allowlist rejection,
cross-owner item/setting/change isolation, owner-scoped undo/ranking/sources, OAuth state replay
and expiry, per-owner Google token loading, hosted sync aggregation, and browser-key-only Gemini
behavior. Existing Gmail privacy/read-only tests remain mandatory.

Frontend tests cover signed-out/loading/signed-in states, Google sign-in/sign-out controls, ID-token
headers, API rejection handling, per-browser Gemini keys, and manual-mode no-model behavior.

Deployment checks build the frontend, run Alembic against a disposable PostgreSQL database, run the
full backend/frontend suites, exercise `/health` and an authenticated `/api/today`, and inspect the
Firebase Hosting rewrite plus the Google OAuth callback configuration before any public URL is
shared.
