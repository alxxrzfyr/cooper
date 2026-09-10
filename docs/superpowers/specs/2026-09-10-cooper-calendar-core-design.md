# Cooper calendar core repair

Date: 2026-09-10
Status: Design direction approved in conversation; written specification awaiting review.
Review status: CEO review pending. Implementation has not started.

## Purpose

Cooper is the user's primary view of tasks, appointments, deadlines, and priorities.
Google and Apple/iCloud supply existing commitments. Items created in Cooper stay in
Cooper. A task with a duration automatically receives a free slot when Cooper can
check availability. The user explicitly approved repairing the existing flow rather
than patching isolated symptoms or rebuilding around new integrations.

This serves PRD requirements 1–7 through capture, ranking, local placement, undo,
the day view, Manual mode, and awareness of external commitments. It changes the
destination in requirement 3 from Google to Cooper. It also changes the previous
remote-failure policy: capture and ranking remain available, but automatic placement
waits when an enabled connected calendar cannot be checked. These are intentional,
user-approved reversals of older product rules, not accidental implementation drift.

## Evidence and limits

Inspected local checkout: main at 3873a64, with pre-existing frontend edits.
These findings describe local source, not verified production behavior:

- `app.py` creates Google events from fixed-event creation, individual task placement,
  and whole-plan scheduling. Other mutation and undo paths also call Google.
- `place_one` suppresses CalendarError; `apply_slots` skips failed Google writes.
- `sources.collect_google` returns an empty list both for unavailable calendars and
  calendars that have no commitments. This loses the distinction needed for safe placement.
- `HoursIn` accepts end_hour=24; `_first_gap` passes it to datetime.time, which raises
  ValueError. The underlying datetime failure was reproduced, not an HTTP reproduction.
- `planner.place` clamps durations to 20–90 minutes instead of preserving the estimate.
- The current ranking uses deadline, age, and duration. ARCHITECTURE.md describes an
  older formula that includes importance. No ranking weights are changed by this design.

The cause of the user's reported worsening AI behavior is still unconfirmed. Prompt
classification, validation, tool routing, execution, and displayed results need an
end-to-end investigation with repeatable examples. No live-provider acceptance is claimed.

## Approved scope

1. Local-only creation and mutation of Cooper items.
2. Reliable Google and iCloud reading and conflict avoidance within connected sources.
3. Automatic scheduling with exact durations and deadline constraints.
4. All-day, weekday-specific, multiple, and overnight availability windows, configurable
   breaks, and a daily task workload limit, while preserving existing settings.
5. Clear source failures and saved-versus-scheduled outcomes.
6. Verified AI action boundaries, correction, and undo.
7. Clear appointments, work sessions, deadlines, waiting reasons, and priority explanations
   in the existing day/calendar experience, retaining desktop and mobile design patterns.

## Behavior

### One destination

Cooper owns its local tasks and events. Google/iCloud events retain their provider
identity and are read-only in Cooper. Their changes and cancellations must be reflected
when refreshed. A source label makes ownership understandable.

Creating, changing, completing, removing, or undoing a Cooper item must not create,
update, or delete any external event. Audit every mutation entry point, including
Manual, AI, batch, schedule, tool application, and undo. Removing only the add call
is insufficient. Keep provider authentication and token storage unchanged in this work.

Existing Google copies must not be deleted automatically. Preserve their identifiers
so the application can recognize links. Their display and conflict treatment after a
local item moves needs an explicit CEO-review decision; do not hide a real external
commitment simply because it was originally written by Cooper.

### Capture and placement

The AI returns a proposed action; application code validates and executes it. Manual
input uses the same validation and writer without calling a model. No new database
writer, background process, dependency, or table is proposed.

A task with an explicit duration is saved and automatically considered for placement.
A task without a duration remains ranked and visible with a missing-duration reason.
Never invent an estimate or silently shorten or lengthen the requested duration.

Implementation default proposed for review: preserve one continuous work session per
task in this repair. If the whole duration cannot fit, leave it waiting; do not silently
split it. Automatic multi-session task splitting is not included in the approved scope.

Candidate slots must be inside availability, after the scheduling lead time, outside
busy intervals and configured breaks, within the daily workload limit, and finish by
the deadline when one exists. An overdue task remains visible as overdue instead of
being described as scheduled before its deadline. Already scheduled items are not
silently rearranged when another task is added.

A fixed appointment retains the explicitly requested time. Availability controls
automatic task placement, not whether a user may record an appointment. If another
commitment overlaps, show the conflict rather than silently moving the appointment.

### Flexible availability

Use the existing owner-scoped settings storage. Represent availability as local
weekday windows with minute precision and an explicit timezone. All-day means local
midnight to the next local midnight, not datetime.time(24). Overnight windows have an
end on the following date. Multiple windows are allowed; overlapping windows are
normalized so they cannot inflate capacity. Empty availability means no automatic
placement, with a clear explanation.

Existing start/end/weekday settings convert to equivalent windows without changing
the user's chosen hours. Offer an explicit all-day preset for every day; do not reset
existing users to it. Preserve the existing daily task-count cap during conversion.
Add a separately labeled daily task-minutes limit so count and hours are not confused.

Count already booked local task time and new placements against limits, including
repeated single-task additions. Apportion cross-midnight workload to the dates it
occupies. Fixed external appointments block time but do not count as task-work minutes.
Breaks must apply consistently between existing and newly placed work sessions.

Use timezone-aware boundaries and UTC storage. Test daylight-saving transitions as
well as Manila time. A displayed overnight window must match the actual permitted span.
Settings saves validate the complete payload atomically; invalid data preserves the
previous settings. A settings change does not silently move existing appointments.

### Calendar health and recovery

Represent these states separately: not connected, successfully read with no events,
successfully read with events, and failed/incomplete read. Each result must indicate
the time range it covers. Only successful reads covering the candidate scheduling
range may establish that external time is free.

If any enabled connected source fails, save and rank the task but pause automatic
placement. Explain which source needs attention. With no sources connected, local
scheduling operates normally. Never turn a failed refresh into an empty-success state.
If previously displayed data is retained, label it as stale and do not use it to claim
a newly scheduled slot is conflict-free.

Recovery must retry placement for the existing item, not create another task. A
successful refresh alone must not unexpectedly rearrange the day. The exact recovery
interaction is a CEO-review decision. No retry daemon or second watcher is proposed.

### AI boundaries and replies

Questions must never enter mutation execution. A proposed action must be validated
even if it arrived through a tool. Ambiguous references ask instead of selecting a
guess. Bulk destructive actions show the exact list first; additive batches retain
one undo without a new confirmation modal.

Invalid, empty, refused, or unavailable model output must not produce a fabricated
success. Preserve the existing privacy boundary: external event contents, attendees,
addresses, credentials, and provider payloads do not enter model prompts. Calendar
availability can be supplied as sanitized time intervals. Provider text is data.

Replies distinguish: needs clarification, saved and scheduled, saved but missing a
duration, saved but no suitable slot, saved but calendar unavailable, and failed save.
Use actual execution results to produce action receipts. A failure to refresh the
screen after a committed save must not invite a duplicate creation.

## Existing architecture to reuse

```
Prompt -> brain.py proposal -> app.py validation and owner checks
Manual form ----------------> app.py validation and owner checks
                                      |
                                      v
                              local item + undo
                                      |
Google/iCloud reads -> sources.py availability + source health
                                      |
Settings ---------------------> planner.py exact placement
                                      |
                                      v
                             app.py local time write
                                      |
                                      v
                        factual reply + calendar/day view
```

`brain.py` stays database-free. `app.py` stays the sole writer. `planner.py` stays
pure. `sources.py` carries source completeness alongside busy time. The frontend
continues to use existing API/types and day/calendar components.

```
Task saved
  +-- duration missing ----------------> waiting: duration
  +-- connected source unavailable ----> waiting: source check
  +-- no complete slot before deadline -> waiting: no suitable slot
  +-- all checks pass -----------------> scheduled locally
  +-- explicit undo -------------------> restore previous local state
```

## Verification required before delivery

- Pure scheduler tests: midnight, end=24 conversion, overnight/weekend windows,
  multiple windows, timezone transitions, 5/20/90/120-minute exact durations,
  deadline boundaries, full days, existing workload, breaks, and repeated additions.
- HTTP tests: local event/task creation, Manual parity, batch order/undo, every
  mutation making zero external writes, unavailable versus disconnected sources,
  invalid settings, and retry using the same item identifier.
- AI fixtures: task versus appointment versus question, ambiguous references,
  malformed output, refusal, unavailable model, destructive batches, prompt-like
  titles, and receipts derived from actual execution. Compare to current behavior;
  do not claim the reported AI regression is diagnosed without a reproduction.
- Provider fixtures: empty calendar, timeout, partial pagination, moved/cancelled
  events, all-day and recurring events, duplicate identities, and requested-range coverage.
- Browser checks: create from a prompt and Manual, confirm the actual displayed
  calendar date/time, inspect waiting reasons, change availability, retry after a
  failed source check, and verify desktop/mobile layout and accessible controls.
- Live read-only Google/iCloud acceptance with connected test accounts is separate
  from fixtures. Confirm known events appear once and block their actual times.
- Run relevant backend/frontend tests, Ruff, frontend formatting/build, and diff checks.

## Rollout and constraints

Update PRD, architecture, and relevant user-facing setup language to describe the new
local-only destination and honest failure behavior. Do not present this specification
as already implemented. Preserve unrelated uncommitted frontend edits.

Do not change hosted configuration, auth, shared keys, localhost bindings, token
storage, or OAuth scopes as incidental work. Any necessary change there requires a
separate concrete decision. No automatic deletion of existing remote copies.

Rollback must retain new availability settings without losing the old values and
must not re-enable remote writes accidentally. The implementation plan must specify
a compatible rollback target rather than blindly reverting to the current writer.

## Deferred scope

- Teams and Google Classroom assignments: separate integration design and consent
  work after the calendar core is dependable; not represented as working features.
- Luma and Meetup: outside this repair; existing code is not proof of live integration.
- Automatic task splitting, broad reranking changes, new agents, queues, dashboards,
  and wholesale interface redesign: not part of the approved repair.

## Review checkpoints

The high-level direction is approved. The written specification is awaiting the
user's review. CEO review should hold this repair scope and examine its unresolved
details, including legacy Google copies, recovery interaction, and long-task handling.
Those defaults are recommendations, not claims of separate user approval. Complete
the review before describing the plan as implementation-ready.
