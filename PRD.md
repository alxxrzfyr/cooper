# Cadence: Product Requirements

Companion to the design spec at
`docs/superpowers/specs/2026-08-29-ai-calendar-agent-design.md`. The spec describes how the
system works. This document states what must be true for it to count as working. Where they
appear to disagree, the spec wins on mechanism and this document wins on acceptance.

## Product in one sentence

A single-user web app where one typed sentence becomes a correctly structured task, a ranked
shortlist tells the user what to work on next, and the top of that shortlist is placed into
real Google Calendar time inside boundaries the user declared.

## The user

One person: the author. No second persona exists, and no requirement may be justified by an
imagined other user. Assumed context: works at a computer, already lives in Google Calendar,
is comfortable with a terminal, and runs the app on their own machine.

## Success metrics

| Metric | Target | Measured how |
| --- | --- | --- |
| Capture latency | Under 3 seconds from Enter to visible parsed chip | Manual timing during Phase 1 use |
| Capture accuracy | 9 of 10 everyday sentences parse without correction | The intent fixture set, plus corrections counted in real use |
| Daily open rate | Opened on at least 10 of 14 days | Honest self-report during the Phase 2 gate |
| Plan survival | Half or more of placed blocks are worked, not released | `slip_count` and block state after Phase 4 |
| Degraded usability | Full capture, ranking, and scheduling with zero model calls | Run the suite with the provider forced to `RuleBasedProvider` |

## Kill criterion

After Phase 2 ships, development stops for two weeks of real use. If the Today view is not
being opened on at least 10 of those 14 days, the project ends and Phase 3 is never built.

This gate is binding. The expensive half of the system is calendar writes, undo, and
reconciliation, and all of it is worthless if the cheap half has not already earned a habit.

## Requirements by phase

Each phase is independently useful. Acceptance criteria are the definition of phase completion.

### Phase 0: Foundation

Stories:

- As the user, I can start the backend and frontend with one documented command each.
- As the user, I can grant Google Calendar access once and see my existing events listed.
- As the user, I can create, edit, complete, and delete a task through the UI with no AI.

Acceptance:

1. `alembic upgrade head` creates the full schema from section 6 of the spec.
2. The OAuth flow completes and stores an encrypted refresh token. The token never appears in
   logs or in git.
3. Existing calendar events appear in `calendar_event_cache` with descriptions, locations, and
   attendee emails absent. Verified by inspecting rows, not by reading code.
4. The API refuses a request lacking the shared-secret header, refuses an unknown `Origin`,
   refuses an unexpected `Host`, and binds `127.0.0.1` only.
5. The `import-linter` contract runs in CI and fails if `core` imports `services`, `adapters`,
   `api`, SQLAlchemy, FastAPI, or any vendor SDK.

### Phase 1: Capture

Stories:

- As the user, I can type "dentist thursday 3pm" and get a calendar event without a form.
- As the user, I can type "write the quarterly report, 3h, important, due friday" and get a
  task with effort, importance, and deadline populated.
- As the user, when the parse is wrong, I can fix it in one click without a dialog.
- As the user, when my sentence is genuinely ambiguous, I am asked instead of guessed at.

Acceptance:

1. The intent fixture set passes against recorded model responses in CI and against the live
   model in the nightly contract job.
2. Every capture echoes a parsed chip with inline edit and undo. No modal appears on the
   capture path at any point.
3. An unresolvable or near-tied entity reference produces `Clarify` with candidates listed.
   Model-reported confidence is not consulted anywhere in the codebase.
4. A capture never issues more than two model calls.
5. With the provider forced to `RuleBasedProvider`, the common sentence shapes still parse.

### Phase 2: Prioritize

Stories:

- As the user, I open Today and see a ranked shortlist without typing anything.
- As the user, I can see why an item ranks where it does.
- As the user, I can force a task to the top for today when I disagree with the ranking.

Acceptance:

1. The scoring function matches section 9 of the spec exactly, weights read from config.
2. Tasks with incomplete blockers are absent from candidates, not merely ranked low.
3. Each Today item exposes its per-term score contributions.
4. `pinned_for_date` set to today places the task first, bypassing scoring.
5. Ranking runs with zero model calls. Verified by a test asserting the provider was not
   invoked.

### Phase 3: Schedule

Stories: declare recurring focus windows, have the shortlist placed inside them, see those
blocks in Google Calendar, and undo any batch of changes.

Acceptance:

1. Property tests prove no block is ever placed outside a declared window, no daily cap is
   exceeded, and no block overlaps busy time.
2. Both DST transitions are covered by explicit tests.
3. An app block moved by hand in Google Calendar is marked `user_moved` and is never
   automatically re-placed.
4. An event with other attendees is never moved or deleted by any automatic path.
5. Undo of a batch restores the prior database state, proven by round-trip tests, and issues
   the corresponding calendar corrections through the outbox.
6. Killing the process mid-write leaves no orphaned calendar event and no lost outbox row.

### Phase 4: Intelligence

Stories: the ranking accounts for judgment the formula cannot express, tomorrow is planned
overnight, a drifted day repairs itself, and the user sees what the AI did unattended.

Acceptance:

1. The reranker may only reorder the 10 candidates it was given. A response naming an unknown
   ID, or omitting one, is rejected and deterministic order stands.
2. Every rerank stores a reason under 200 characters, displayed beside the affected item.
3. Closing the laptop through the nightly job's scheduled time still results in the job running
   at next startup, exactly once.
4. `day_drift_reconcile` releases past unstarted blocks, increments `slip_count`, and re-places
   the remainder of the day.
5. The digest lists every AI-originated batch since the last digest.

### Phase 5: Hardening

Stories: quota exhaustion degrades the app instead of breaking it, and credential expiry is
visible rather than mysterious.

Acceptance:

1. Simulated sustained `429` responses open the circuit breaker and enter degraded mode, and
   the UI says so plainly.
2. In degraded mode, capture, ranking, and scheduling all still work.
3. A `410 Gone` on the sync token triggers a full resync with no duplicate blocks.
4. An expired refresh token surfaces a re-auth prompt in the UI within one hour.

## Out of scope

Listed in section 2 of the spec and not repeated here. The two worth restating because they are
the most likely to be violated by accident: **this is not a competitor to Motion or Reclaim.ai**,
and **scale must not be engineered for**.
