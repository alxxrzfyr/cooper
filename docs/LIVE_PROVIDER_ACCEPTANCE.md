# Live-provider acceptance

Use this checklist after provider authentication, normalization, scheduling, or read-only changes,
before release. Use disposable accounts and uniquely named test items. Automated transport tests
and browser fixtures are separate gates, not connected-provider acceptance.

## Verification record

| Date       | Evidence                                                                              | Limits and remaining gate                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-14 | Owner manually verified Google Calendar and iCloud Calendar flows                     | Applies to that build, not subsequent changes. Private account and event details omitted.                                                                                   |
| 2026-10-01 | Shared scheduling and capacity projection had automated and isolated-browser evidence | Connected acceptance not repeated. Local preflight: Google client ID and secret missing, shared key and encryption ready. No connected-account test or deployment recorded. |

For the capacity release, configure missing OAuth values privately and repeat the checklist. Do not
reinterpret September's acceptance as verification of October's changes. Included-AI live
acceptance is also pending under the
[provider decision](decisions/2026-09-30-included-ai-providers.md).

## 1. Prepare the local test

1. Follow [Quick Start](../README.md#quick-start). Keep `.env` private, local auth enabled, the API
   bound to `127.0.0.1`, and a fresh shared key of at least 24 characters.
2. Privately set `COOPER_GOOGLE_CLIENT_ID`, `COOPER_GOOGLE_CLIENT_SECRET`, and
   `COOPER_ENCRYPTION_KEY`. Generate a Fernet key with:

   ```bash
   uv run python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

3. Register this exact redirect in the Google OAuth client:

   ```text
   http://127.0.0.1:8000/api/google/callback
   ```

   Keep existing Calendar event and Gmail read-only access. This check authorizes neither broader
   scope nor Google write-back.

4. Run the non-secret preflight. It prints only ready, missing, or invalid status:

   ```bash
   uv run python scripts/live_provider_preflight.py
   ```

5. Start backend and frontend as in Quick Start. Add
   `--health-url http://127.0.0.1:8000/health` to the preflight command to check the running backend
   too.

## 2. Check Google Calendar and Gmail

1. In the disposable Google Calendar, create `Cooper live-test busy` during tomorrow's working
   hours. Do not use a personal commitment.
2. In Cooper Settings, select **Connect Google**, complete consent, and confirm Calendar and Gmail
   connected status. Confirm the event appears in Calendar and its interval blocks placement.
3. Use a supported known-sender confirmation in the test inbox, then select **Sync Gmail**. Confirm
   the imported commitment has the correct time and, if present, a safe location or link. Never
   display or retain the email body.

## 3. Check local scheduling and undo

1. Add `Cooper live-test schedule` with a duration and near deadline. Confirm automatic placement
   keeps its full duration, avoids the busy event, and stays inside configured availability.
2. Confirm Google Calendar has no new Cooper block. It is an input, not the write destination.
3. Refresh Cooper and confirm the block appears once. Undo the local addition and confirm the source
   Google event is unchanged.

## 4. Check iCloud read-only behavior

1. Create `Cooper iCloud live-test busy` in the disposable iCloud calendar during working hours.
2. Connect in Settings with the test Apple ID and app-specific password. The password goes only to
   the local Cooper server. It is not returned to the browser.
3. Confirm the event appears and a scheduled task avoids it. Cooper must create, change, or delete
   no iCloud event.
4. Select **Disconnect iCloud**. Only the encrypted local credential is removed, not calendar events.

## 5. Check failure handling and clean up

1. With Google connected, revoke the test grant or make the provider unreachable. Add an estimated
   task. Capture and ranking succeed, placement waits, and the reason explains unchecked conflicts.
2. Restore access and retry scheduling. Confirm local placement avoids the source event. With all
   calendars disconnected, confirm normal local scheduling still works.
3. Delete disposable provider events manually. Use Cooper only to undo its local items. Preserve
   legacy Google copies unless explicitly removing them manually.
4. Remove the local test `.env` and database only if no longer needed.

## Record the result

Update the dated record after the manual gate. In the deployment change record, include build, date,
non-identifying test-account aliases, per-flow pass or fail, and unresolved blockers. Never include
credentials, `.env` values, tokens, app-specific passwords, private event names, or bodies.
