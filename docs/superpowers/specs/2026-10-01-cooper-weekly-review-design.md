# Weekly review

Date: 2026-10-01. Status: IMPLEMENTED (see the execution record at the end).

Serves PRD requirement 5 ("Show me my day without being asked") extended to the week,
and the web-first spec's "Review and reuse" journey (read-only review). Routines are
**out of scope**: the spec requires a reviewed persistence and duplicate-submission
design first, which likely needs a new table and therefore owner approval.

## Contract

`GET /api/review/week` is read-only and deterministic. No model, no write, no `Change`.
Every boundary is a local date in the owner's configured timezone.

- **Past seven local dates** (`today - 6` through today): local tasks completed in
  that window, by `done_at`. Dropped work has no timestamp and is not reported.
- **Still unfinished**: open local tasks that are overdue (`due < at`) and missed
  blocks (`end_at <= at`). Recovery is the action for missed blocks.
- **Upcoming seven local dates** (today through `today + 6`), per day:
  - `fixed_minutes`: merged busy time from local events and connected calendars.
    Only durations are shown; remote titles and attendees never appear.
  - `planned_minutes`: scheduled open local task blocks.
  - `deadlines`: open local tasks due that day.
- **Deadline risks**: open local tasks due in the upcoming window that neither have a
  block ending by the deadline nor get one from the shared seven-day projection.
  Reasons: `unknown_estimate`, `no_feasible_slot`, or `calendar_unchecked`. When a
  connected calendar can't be checked, Cooper never claims a deadline fits.
- **Uncertainty**: `unscheduled_count`, `unknown_estimate_count`, and `complete`
  (false when any connected calendar failed).

There are no streaks, scores or "time saved" figures. Weekly review is Free.

## UI

Home has a "This week" section with **Review the week**. It opens an inline panel
(not a modal) with the four parts above and a **Close** button. It has no mutation
controls; existing Home actions (recovery, scheduling) remain the way to act.

## Execution record

Filled in at implementation time.
