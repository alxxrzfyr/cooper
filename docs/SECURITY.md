# Security

Cadence holds a live Google Calendar write credential and runs without user authentication. That
combination is safe only under specific assumptions. This document states them, so nobody
violates one by accident during deployment.

## Assumptions

1. The app runs on the user's own machine.
2. It is bound to `127.0.0.1` and is not reachable from any network.
3. The only human with access to the machine is the user.

**If any assumption stops holding, this design is not safe.** The mitigations below defend the
assumptions; they are not a substitute for authentication.

## Threats and mitigations

### A web page you visit attacks the local API

Real, not theoretical. A browser will happily let any page issue requests to `localhost`, and DNS
rebinding defeats naive origin checks by resolving an attacker-controlled hostname to `127.0.0.1`.
An attacker who succeeds can rewrite the user's calendar.

Mitigations, all required in Phase 0:

- Bind `127.0.0.1` explicitly. Never `0.0.0.0`.
- Lock CORS to the exact app origin. No wildcard, no origin reflection.
- Validate the `Host` header against an allowlist. This is the specific defense against DNS
  rebinding, and origin checks alone do not provide it.
- Require a shared-secret header on every mutating request, with the value read from `.env` and
  injected into the frontend at build time.

### Exposing the app so a phone can reach it

Out of scope for all six phases. Doing it requires, at minimum, session-based login, HTTPS, and a
threat model for a public endpoint. Treat it as a new project, not a deployment flag. Changing the
bind address is the moment this document stops applying.

### Credential theft from disk

- The OAuth refresh token is encrypted at rest with a key from the environment.
- `.env` is git-ignored from the first commit, and `.env.example` carries no real values.
- Tokens never appear in logs, error messages, or API responses.
- The OAuth scope is `calendar.events`, not full calendar access. A stolen token cannot read the
  user's calendar list or alter calendar settings.

### Prompt injection through calendar content

Other people's event titles enter the system through calendar sync. That text is untrusted.

The containment is structural rather than filter-based. Third-party text reaches only the
reranker, whose output is validated as a permutation of IDs the system itself supplied plus a
reason string. A completely hijacked reranker can do exactly one thing: order ten of the user's own
tasks incorrectly. The intent compiler, the only component whose output causes mutations, sees
only text the user typed.

Filtering injection attempts out of event titles is not attempted. Filters lose. The
capability boundary holds regardless of what a title says.

### Data leaving the machine

Gemini's free tier may use prompts and responses to improve Google products, confirmed in
Google's documentation on 2026-08-29. Moving to a paid tier is what excludes that.

Mitigation is minimization at ingestion. Event descriptions, locations, meeting links, and
attendee emails are stripped by the scrubber before storage, so they never exist in the database
and cannot reach a prompt. Titles are transmitted, which is a deliberate accepted tradeoff: the
reranker needs them to be useful.

The scrubber uses a **field allowlist, not a denylist**. A field added to the model later is
excluded by default rather than silently transmitted. This is the difference between a policy and
a guarantee.

### Runaway autonomy

The AI applies changes without confirmation by decision. Bounds:

- The scheduler cannot write outside declared focus windows.
- No automatic path may move or delete an event with other attendees.
- A per-turn mutation cap, default 20, aborts the batch rather than half-applying it.
- Every mutation is logged with its inverse, and undo operates on whole batches.
- A daily digest reports what was done unattended.

### Accidental secret commit

`.gitignore` covers `.env`, `token.json`, `credentials.json`, `*.pem`, and database files from the
first commit. Recorded test fixtures are scrubbed before being committed, and a test asserts no
fixture contains an email address or a token-shaped string.

## Reporting

Single-user personal project. No disclosure process. If a weakness is found, fix it and record it
in `docs/DECISIONS.md`.
