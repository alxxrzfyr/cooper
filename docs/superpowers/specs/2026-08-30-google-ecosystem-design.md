# Google Calendar + Gmail Integration Design

## Goal

Complete the Google side of Cooper's seventh requirement without changing its local-first
planner: Google Calendar remains the only remote writer, while Gmail confirmations become
read-only external commitments that block scheduling and reconcile when they move or cancel.

## Scope

Included:

- The existing Google Calendar OAuth connection and event mirror.
- A single Google OAuth grant requesting Calendar event access and restricted Gmail read-only
  access.
- Gmail messages from known Luma, Meetup, and Eventbrite senders.
- Deterministic extraction of a title, provider reference, start, end, and cancellation state.
- Persistent external-event rows so a later confirmation can update or cancel the same event.
- A one-shot sync endpoint and one timer/loop process for unattended Gmail checks.
- Last-checked and last-error health in the dashboard and Settings.
- Busy-time integration, read-only external-event rendering, and failure-isolated tests.

Explicitly excluded:

- Google Drive, Google Tasks, Google Meet, Contacts, Classroom, or any other Google service.
- Sending mail, RSVP, creating meetings, or modifying events Cooper did not create.
- A queue, retry tiers, broker, worker pool, or second background process.
- Storing Gmail bodies, locations, attendee addresses, or raw Gmail message IDs.

## Data model

The existing `item` table remains the one table for local and external commitments. Add the
planned ownership/source columns:

- `owner_id`: one local owner value today, present on every newly created row.
- `source`: `me` for local items or `gmail` for imported commitments.
- `source_ref`: provider event/reference id, never Cooper's `google_event_id`.

External Gmail events are `kind="event"` rows with `status="open"`, `start_at`, `end_at`,
`source="gmail"`, and a provider `source_ref`. They are read-only in the UI. Cancellation marks
the row `dropped`; a moved confirmation updates its existing row. Sync mutations do not enter the
user undo stack, because they are facts arriving from elsewhere rather than a user action.

The existing SQLite compatibility helper is extended in place for these additive columns. Fresh
databases use SQLAlchemy metadata; existing installs receive the same safe defaults (`local` and
`me`). No new table or dependency is introduced.

## Google authentication and clients

`google.py` keeps the REST-only approach and owns shared OAuth/token plumbing. The consent URL
requests exactly these scopes:

- `https://www.googleapis.com/auth/calendar.events`
- `https://www.googleapis.com/auth/gmail.readonly`

The refresh token remains Fernet-encrypted in the existing setting. Calendar and Gmail use the
same loaded token and access-token refresh path. Disconnect clears local credentials and attempts
remote revocation best-effort; a revocation failure never prevents local disconnect.

Calendar behavior stays bounded: read only start/end/title/private Cooper tag, write deterministic
Cooper-owned blocks, and delete only known Cooper event IDs. Gmail behavior is read-only and never
calls a write endpoint.

## Gmail sync flow

`watcher.py` is the timer/loop boundary and has no database writes. It asks a Gmail client for
messages matching a fixed sender query and returns short, validated proposals:

1. Query only Luma, Meetup, and Eventbrite domains within the configured lookback window.
2. Fetch headers and the smallest body representation needed for parsing.
3. Verify the sender domain again locally before parsing.
4. Strip HTML and decode base64url content in memory.
5. Extract provider, title, provider reference, explicit start/end, and cancellation marker.
6. Reject ambiguous or incomplete messages instead of guessing.
7. Discard the body and raw message id before returning the proposal.

`app.py` calls the watcher, validates each proposal through the public `brain.validate` path, and
upserts the external item in one transaction. A new or changed event is then visible to
`sources.busy_windows`; cancellation makes it stop blocking future placement. Gmail failures,
parse misses, and expired credentials update health but never fail a local add, rank, or schedule
operation.

The watcher records `last_checked`, `last_error`, and counts in the existing `setting` key. The
same sync function powers `POST /api/google/sync` for a user-triggered refresh and the
`python -m cooper.watcher` timer loop. The loop has one fixed interval and no retry policy.

## Scheduler and UI

`sources.busy_windows()` remains the only planner seam. It merges local open items, Google
Calendar busy intervals, and open Gmail external events. `planner.py` is unchanged.

The API's `today` view adds Gmail health and includes Gmail events in the existing external-events
feed with an explicit `source`. Calendar and Home render them as outlined, read-only entries;
Cooper-created blocks remain filled and actionable. Settings shows the combined Google connection,
Gmail sync state, last check, and a `Sync now` action. An unconfigured or disconnected Google
account renders a useful offline state rather than an error.

## Security and failure boundaries

- No Gmail body, raw message id, token, or attendee data is logged or persisted.
- Only fixed sender domains are queried and accepted.
- Email-derived actions are proposals and pass `brain.validate` before persistence.
- OAuth callback state remains nonce-protected and localhost-only.
- Existing shared-key middleware protects sync and disconnect routes; the callback remains the
  only public OAuth endpoint.
- A remote failure is isolated at the source boundary. Local state remains the source of truth.

## Verification

Add unit tests for date/time/reference parsing, sender filtering, cancellation and move
reconciliation, token/scope behavior, source failure isolation, and no-body persistence. Add API
tests for sync health and offline behavior, plus frontend tests for the Settings status and
read-only Gmail event rendering. Run backend pytest/ruff, frontend tests/build/Prettier, and a
manual browser check of connected, disconnected, and empty Gmail states.
