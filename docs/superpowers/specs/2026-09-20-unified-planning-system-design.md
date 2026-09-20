# COOPER unified planning system

## Intent

Make Ask, Home, Calendar, tasks, integrations, and navigation indicators different views of one
planning system. COOPER must reason from the user's real commitments, communicate the difference
between advice and saved changes, and never claim that a mutation succeeded until the committed
state proves it.

This is a coherence pass, not a feature expansion. It reuses the existing local item table,
provider readers, deterministic planner, validated `Action` boundary, and `app.py` write path. It
does not introduce a synced event ledger, provider write-back, a second background process, or a
project-management workflow.

## Product contract

COOPER presents one unified schedule while preserving ownership boundaries:

- COOPER owns local tasks, events, deadlines, and scheduled work.
- Google Calendar, iCloud/Apple Calendar, Gmail, and future providers remain authoritative for
  their external records.
- External providers are read-only inputs.
- The database remains authoritative for COOPER-owned mutations.
- A derived planning snapshot is authoritative for interpreting the user's current situation.
- Ask, Home, Calendar, badges, workload calculations, and scheduling consume that same snapshot.

The data flow is:

```text
COOPER records ───────┐
Google Calendar ──────┤
iCloud Calendar ──────┼─> normalize -> deduplicate -> planning snapshot
Gmail-derived items ──┤                              ├─> Ask
future providers ─────┘                              ├─> Home
                                                     ├─> Calendar
                                                     ├─> counts
                                                     └─> planner
```

## Architectural boundaries

### `sources.py`

`sources.py` owns the read-only commitment boundary:

- normalize local and provider commitments into a common representation;
- preserve provider identity, source aliases, and editability;
- resolve explicit provider/local links;
- conservatively deduplicate records;
- report provider health;
- continue producing busy intervals for the scheduler.

It never writes, creates, cancels, or RSVPs to provider records.

### `planner.py`

`planner.py` owns deterministic planning calculations:

- task ranking;
- importance and deadline pressure;
- task-state derivation;
- occupied time and free blocks;
- conflict and risk detection;
- current and next focus selection;
- explainable recommendation reasons;
- the final planning snapshot projection.

Gemini does not calculate any of these facts.

### `app.py`

`app.py` remains the only database writer. It:

- orchestrates local and provider reads;
- builds the planning snapshot;
- executes validated actions;
- commits mutations;
- rebuilds the snapshot after a mutation;
- verifies the affected item in committed state;
- creates a mutation receipt from that state.

### `brain.py`

`brain.py` remains an interpretation and validation boundary. It:

- classifies bounded planning questions;
- turns mutation requests into validated `Action` values;
- sanitizes model-bound user text;
- cannot calculate authoritative schedule facts;
- cannot write to the database;
- cannot modify external records.

## Unified commitment model

Every scheduled commitment is normalized to the same conceptual fields:

- stable identity;
- source and provider identifier;
- source aliases when records were deduplicated;
- task or event type;
- title, retained server-side;
- start and end;
- all-day status;
- category;
- deadline and estimated duration when applicable;
- importance when applicable;
- derived state;
- editable or read-only capability;
- conflict information.

Tasks remain flexible units of work. Events remain fixed commitments. A scheduled task can occupy
time without becoming an event or losing its task identity.

## Conservative deduplication

COOPER merges records only when identity is sufficiently strong:

1. Same provider and remote event identifier.
2. An explicit COOPER relationship such as `google_event_id` or Gmail `source_ref`.
3. An exact cross-source signature: normalized title, start, end, all-day status, and compatible
   event type.
4. Otherwise, preserve both records.

Merged records retain aliases so the UI can say that an event appears in more than one provider.
COOPER prefers an occasional visible duplicate over hiding two real commitments that happen to
look similar.

## Planning snapshot

`/api/today` exposes a canonical `planning` object containing:

- generation time, local date, and timezone;
- completeness and per-source health;
- normalized commitments;
- ranked open tasks with derived state and recommendation reasons;
- the current and next focus references;
- risks and conflicts;
- daily metrics, including scheduled count, occupied minutes, remaining task effort, largest free
  block, and conflict count.

Existing `shortlist`, `scheduled`, and `events` fields may remain during a bounded migration. They
must not survive as a second permanent interpretation of the schedule. Frontend calendar merging
and counting are removed after all consumers move to `planning`.

## Calendar counts and workload

A calendar count represents scheduled commitments on the date:

- scheduled COOPER tasks;
- COOPER events;
- Google Calendar events;
- iCloud/Apple Calendar events;
- Gmail-derived scheduled items;
- future normalized providers.

It excludes unscheduled backlog tasks, completed or dropped items, cancelled provider events, and
deduplicated aliases. Timed and all-day commitments count on every local date they occupy.

Counts are not workload. The snapshot separately reports occupied minutes, remaining task effort,
free-block size, conflicts, and at-risk work. Four short events must not be presented as equivalent
to four long commitments.

If a connected provider fails, available records remain visible, but the snapshot is incomplete.
Counts are labelled incomplete and scheduling is blocked because missing provider data cannot be
treated as free time.

## Priority and explainable ranking

Importance must affect behavior. Ranking follows this hierarchy:

1. Explicitly pinned work.
2. Deadline feasibility and work that must begin soon to fit.
3. Overdue or approaching deadlines.
4. Importance among tasks with comparable deadline pressure.
5. Duration and age as tie-breakers.

Importance affects Home ordering, Ask recommendations, scheduling order, conflict resolution
between flexible tasks, and risk warnings. It never overrides fixed commitments, configured
availability, or a hard feasibility limit.

User-facing importance is simplified to Low, Normal, Important, and Critical while retaining the
existing numeric storage range: 1 is Low, 2–3 are Normal, 4 is Important, and 5 is Critical.
Recommendation output explains the relevant facts rather than presenting an opaque AI score.

## Derived task states

COOPER avoids a workflow-heavy status system. It derives useful states from existing data:

- **Not started**: open and unscheduled.
- **Scheduled**: open with a future work block.
- **In progress**: the current time falls within the scheduled work block.
- **Blocked**: open but waiting because availability or a connected provider cannot be verified.
- **Overdue**: incomplete after its deadline.
- **Missed block**: the scheduled work period passed without completion.
- **Completed**: explicitly marked done.
- **Dropped**: explicitly removed from the active plan.

`Snoozed` is intentionally excluded. It needs a real hidden-until field and product behavior and
must not be simulated by silently changing a deadline.

## Ask Mode

Ask is a planning interface over the snapshot, not a general chatbot with calendar text pasted into
its prompt.

### Product queries

Common questions use deterministic COOPER calculations:

- what to focus on;
- what remains today;
- what is next;
- whether a day is overloaded;
- whether a duration fits;
- approaching deadlines;
- conflicts;
- planning a bounded part of the day.

Curated prompt buttons send explicit read intents rather than relying on model interpretation of a
sample sentence. Typed questions may map to the same intents through rules or bounded model
classification. The model may improve wording but cannot invent or recalculate the facts.

### Open-ended questions

Unusual questions may use bounded read tools. Answers must be grounded in returned snapshot facts.
When data is absent or incomplete, COOPER says so instead of returning generic productivity advice.

### Privacy-aware provider context

External calendar contents remain outside Gemini prompts. The model may receive opaque identifiers,
provider, time range, busy status, conflict state, safe classifications, and connection health. It
does not receive external titles, descriptions, attendees, addresses, or locations.

Deterministic server responses may include an external title after reasoning because the title is
never exposed to or interpreted by the model. Long-tail model answers use redacted labels.

### Intent and outcome vocabulary

Every Ask interaction is one of:

- **Inspect**: read current state.
- **Suggest**: recommend without changing state.
- **Preview**: calculate a possible plan without saving it.
- **Create**: save a new COOPER item.
- **Modify**: change a COOPER-owned item.
- **Complete or remove**: apply an explicit task action.

Response language must match the operation. “I recommend” and “Here is a possible plan” mean no
state changed. “I added” and “I moved” require a committed mutation receipt.

## Truthful mutation receipts

Every write follows:

```text
interpret -> validate -> app.py mutation -> commit -> fresh snapshot -> verify -> receipt -> reply
```

A successful receipt contains the operation, affected local item, actual committed timing,
resulting state, warnings, and snapshot generation time. The conversational response is rendered
from this receipt rather than from the model's expectation.

If the saved result differs from the requested time, COOPER states both. If calendar health is
incomplete, COOPER may capture the task but leaves it unscheduled with a visible reason. If
post-commit verification cannot find the affected item, COOPER reports that the outcome could not
be verified, tells the user to refresh before retrying, and returns no success language. It must not
claim that the write rolled back when the commit outcome is already uncertain.

External records remain read-only. Requests to move them explain the boundary and may offer to
schedule COOPER work around them.

## Home command center

Home answers “What do I need to know and do right now?” using the same snapshot.

- **Now** shows the current commitment or the highest-value task that fits the current free block.
- **Next** shows the next chronological commitment and the time available before it.
- **Today** shows one unified agenda across COOPER and connected providers.
- **At Risk** summarizes problems and points to the affected item rather than duplicating it.
- **Upcoming** shows a restrained set of meaningful near-term commitments and deadlines.

Each item has one rendered instance. Now, Next, and At Risk are focused references into the same
collection, not independent copies. Source is visible but secondary; it affects editability and
trust, not whether the time counts.

COOPER-owned tasks support completion, starting, scheduling or rescheduling, pinning, editing, and
dropping. External events can be inspected and used for availability but not edited by COOPER.

On mobile, the same hierarchy becomes a single vertical flow. It must not squeeze a desktop
dashboard into a narrow viewport.

## Loading and degraded states

- Initial load uses structural skeletons matching Now, Next, and Today.
- Provider refresh preserves known COOPER data and shows provider-level progress.
- Partial failure shows available information with an explicit incomplete-state notice.
- Mutation progress belongs to the affected action and settles only after the committed receipt.
- An empty day is presented as an intentional state with a useful next action.

The application must never briefly show an empty schedule merely because data is still loading.

## Delivery sequence

1. Add pure normalization, deduplication, state, metric, and ranking tests.
2. Build the backend snapshot while retaining legacy response fields.
3. Move Calendar and navigation counts to snapshot data.
4. Move Home to snapshot focus, agenda, tasks, and risks.
5. Replace curated prompt strings with typed Ask intents.
6. Ground open-ended Ask in privacy-safe snapshot tools.
7. Add verified mutation receipts and local rescheduling.
8. Remove duplicated frontend calculations and obsolete response fields.
9. Update product, architecture, and provider-acceptance documentation.
10. Verify automated behavior and the rendered desktop/mobile application.

## Acceptance criteria

1. One scheduled COOPER item, two Google events, and one Apple event produce a count of four.
2. An explicitly linked or confidently duplicated event counts once and retains source aliases.
3. External events block task placement and affect available-time answers.
4. A provider failure marks the snapshot incomplete and prevents invented availability.
5. “What should I focus on?” names real work and explains the relevant deadline, importance,
   duration, or available-block facts.
6. “What remains today?” includes local and external commitments.
7. Importance changes ranking between otherwise comparable tasks while deadline feasibility remains
   dominant.
8. Home shows coherent Now, Next, Today, At Risk, and Upcoming information without duplicate item
   cards.
9. Creating or moving a local item returns its committed result from a refreshed snapshot.
10. Failed writes never produce success language.
11. Requests to change external events clearly explain that they are read-only.
12. External titles, descriptions, attendees, addresses, and locations never enter Gemini prompts.
13. Manual/Form mode works without Gemini and with no connected providers.
14. Calendar, Home, Ask, and badges agree on counts and current state.
15. Initial loading, empty, partial-provider, mutation-progress, and failure states are visibly
    distinct.
16. Backend tests, frontend tests, linting, formatting, build, and browser checks pass.

## Explicit non-goals

- No external calendar write-back.
- No new synchronized event table.
- No event-sourcing or audit-log system.
- No second watcher or queue.
- No projects, assignments, permissions, or reporting.
- No AI reranker.
- No fifth category or new semantic colour.
- No attendee, external description, or email-address model context.
- No persisted snooze state in this delivery.
