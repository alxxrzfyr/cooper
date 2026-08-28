# Setup

First-run instructions. Written for the author, six months from now, having forgotten all of it.

Nothing here works until Phase 0 of `PRD.md` is complete. Until then this is the target contract
that Phase 0 must satisfy.

## Prerequisites

- Python 3.12 and `uv`
- Node 20 and npm
- A Google account with the calendar you intend to use
- A Google AI Studio API key

## 1. Gemini API key

Create a key at `https://aistudio.google.com/apikey`.

Two things worth knowing before relying on the free tier:

- **Free-tier prompts and responses may be used to improve Google products.** Linking a billing
  account and prepaying is what excludes that. See `docs/SECURITY.md` for how Cadence minimizes
  what it sends.
- **Free-tier rate limits are not published as a fixed table.** They are per-project, visible only
  in AI Studio, and explicitly not guaranteed. Check your project's limits at
  `https://aistudio.google.com/rate-limit`. Requests-per-day quotas reset at midnight Pacific.
- Some sources report the free tier is unavailable in the EU. Verify for your region before
  assuming the free path works.

Record the two model IDs you intend to use. A Flash-Lite class model for intent compilation and a
Flash class model for reranking is the default split. Model names change often, which is why they
live in `.env` and never in code.

## 2. Google Cloud project and OAuth

1. Create a project at `https://console.cloud.google.com`.
2. Enable the Google Calendar API.
3. Configure the OAuth consent screen. Choose **External**, and add your own Google account as a
   test user.
4. Create an **OAuth client ID** of type **Web application**.
5. Add `http://127.0.0.1:8000/auth/callback` as an authorized redirect URI. Use `127.0.0.1`, not
   `localhost`; Google treats them as different origins.
6. Copy the client ID and client secret into `.env`.

### The seven-day refresh token trap

**A consent screen left in Testing mode expires refresh tokens after seven days.** Cadence will
then stop syncing, and it will look exactly like a bug in the code. It is not.

Two options:

- Accept it and re-authenticate weekly. The token health check surfaces the prompt, so this is
  merely annoying.
- Publish the app. Since the only user is you and the scope is not sensitive enough to require
  verification for personal use, publishing generally removes the expiry.

If sync mysteriously stops after roughly a week, this is the cause. Check here before debugging
anything else.

## 3. Environment

Copy `.env.example` to `.env` and fill it in. `.env` is git-ignored and must stay that way.

Generate the two secrets with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"   # CADENCE_SHARED_SECRET
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # CADENCE_TOKEN_ENCRYPTION_KEY
```

Losing `CADENCE_TOKEN_ENCRYPTION_KEY` means re-authenticating with Google. It does not mean losing
task data.

## 4. Database

```bash
uv sync
uv run alembic upgrade head
```

SQLite file location comes from `CADENCE_DATABASE_URL`. Back it up by copying the file. That is the
entire backup story, and it is sufficient for one user.

## 5. Run

```bash
uv run uvicorn cadence.main:app --reload --host 127.0.0.1 --port 8000
cd frontend && npm install && npm run dev
```

Open the frontend URL and complete the Google authorization once. Confirm your existing calendar
events appear.

Do not change `--host`. See `docs/SECURITY.md`.

## 6. Declare focus windows

Before the scheduler can do anything, declare at least one focus window in the Windows view. The
scheduler is only permitted to write inside declared windows, so with none declared it correctly
does nothing.

Start narrow. Two hours on weekday mornings with a cap of two blocks is a better first
configuration than an optimistic full day, because the goal of the first week is finding out
whether the placed blocks get worked.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Sync stops after about a week | Refresh token expired. Consent screen is in Testing mode. See above. |
| `redirect_uri_mismatch` | Redirect URI uses `localhost` instead of `127.0.0.1`, or the port differs. |
| Every request rejected as 403 | Shared secret in the frontend build does not match `.env`. Rebuild the frontend. |
| Degraded mode banner appears | Model quota exhausted. Resets at midnight Pacific. Capture, ranking, and scheduling still work. |
| Scheduler places nothing | No active focus window, or the daily cap is already met, or nothing fits the 25 minute minimum. |
| Blocks appear but not in Google Calendar | Outbox is not draining. Check `outbox` rows in `failed` state and the job log. |
