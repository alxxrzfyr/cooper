# Live Provider Acceptance

Use this checklist before deploying provider integrations. It verifies the same Google Calendar,
Gmail, iCloud, scheduling, and truthful-UI paths covered by the automated tests, using a
disposable test account and a uniquely named test block.

## Safe Setup

1. Copy `.env.example` to `.env` if needed. Keep `.env` local: it is gitignored.
2. Set `COOPER_AUTH_MODE=local` and use a fresh `COOPER_SHARED_KEY` of at least 24 characters.
3. Set `COOPER_GOOGLE_CLIENT_ID`, `COOPER_GOOGLE_CLIENT_SECRET`, and a valid
   `COOPER_ENCRYPTION_KEY`. Generate a Fernet key with:

   ```bash
   uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

4. In the Google OAuth client, register exactly:

   ```text
   http://127.0.0.1:8000/api/google/callback
   ```

   Cooper uses its existing Google Calendar event access and Gmail read-only access. New work
   stays in Cooper's calendar; this check does not authorize Google write-back.
5. Run the non-secret preflight. It reports only ready, missing, or invalid status:

   ```bash
   uv run python scripts/live_provider_preflight.py
   ```

6. Start Cooper locally in two terminals:

   ```bash
   uv run uvicorn cooper.app:app --reload --host 127.0.0.1
   ```

   ```bash
   cd frontend && npm run dev
   ```

   To verify the backend is running as well, include `--health-url http://127.0.0.1:8000/health`
   in the preflight command.

## Google And Gmail

1. Create a disposable Google Calendar event called `Cooper live-test busy`, during a working
   period tomorrow. Do not use a personal commitment.
2. In Cooper Settings, select **Connect Google** and complete consent with the disposable account.
3. Return to Settings and confirm Google Calendar and Gmail show as connected.
4. Open Calendar. Confirm the test event appears and planning treats its period as unavailable.
5. Send that inbox a known-sender confirmation supported by Cooper's existing rules, or use an
   eligible existing confirmation. In Settings, select **Sync Gmail**.
6. Confirm the imported commitment has a time and, if present, a safe location or meeting link.
   Cooper must not display the email body.

## Cooper Scheduling With Connected Calendars

1. Add a unique task such as `Cooper live-test schedule` with a duration and a near deadline.
2. Confirm it is automatically placed in Cooper's calendar at its full duration, avoids
   `Cooper live-test busy`, and stays inside the availability configured in Settings.
3. In Google Calendar, confirm no new Cooper block was created. Existing Google events are
   imported commitments, not a destination for new work.
4. Refresh Cooper and confirm the scheduled block remains visible once. Use Undo and confirm
   Cooper reverses the local addition without changing the source Google event.

## iCloud Read-Only Check

1. In iCloud Calendar, create a disposable event called `Cooper iCloud live-test busy` during a
   working period.
2. In Cooper Settings, enter the test Apple ID and an Apple app-specific password under iCloud.
   The password is sent only to the local Cooper server and is not returned to the browser.
3. Confirm Calendar displays the iCloud event and an automatically scheduled task avoids its time.
4. Confirm no iCloud event is created, changed, or deleted by Cooper. iCloud is intentionally
   read-only under the current product rules.
5. Select **Disconnect iCloud** after testing. This removes the encrypted local credential, not
   any calendar event.

## Failure And Cleanup

1. With Google still connected, use a revoked test grant or temporarily make the test provider
   unreachable, then add a task with a duration. Cooper should capture and rank it, leave it
   unscheduled, and explain that connected calendar conflicts could not be checked.
2. Restore the connection, then retry scheduling. Confirm the task can now be placed locally
   around the source event. With all calendars disconnected, local scheduling should still work.
3. Remove the disposable Google and iCloud test events manually. Use Cooper only to undo
   Cooper-owned local items. Preserve any legacy Google copies unless you remove them manually.
4. Remove the local `.env` and local test database only if you no longer need the test state.

Record the date, connected test-account aliases, and pass/fail result in the deployment change
record. Never include access tokens, app-specific passwords, or the values from `.env`.
