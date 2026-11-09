# Product requirements

Cooper is one place for everything that takes up your time: tasks, events, and errands. It helps
you capture commitments, choose what matters, and make a plan you can trust.

This document owns **product scope and behavior contracts**, not implementation history or a
backlog. Read [Architecture](ARCHITECTURE.md) for the system and [AGENTS.md](AGENTS.md) before
changing it. Active work and release gates belong in the
[Cooper Project](https://github.com/users/alxxrzfyr/projects/1).

## Scope and current coverage

Cooper is a personal planner, not a team or project-management tool. It runs locally without
connected accounts and also supports owner-scoped hosted beta accounts. The accepted boundary is
[one responsive web/PWA](docs/decisions/2026-09-30-web-first-product-boundary.md), not native apps
or a suite of separate products.

| State                    | Coverage                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented              | Requirements 1–6, plus shared seven-day projection, scoped today assessment, duration-fit probes, estimate editing, guided recovery, and read-only weekly review           |
| Partly implemented       | Requirement 7: Google Calendar, iCloud Calendar, and supported Gmail confirmations work. Teams and Classroom are future sources.                                           |
| Backend only             | Bulk destructive match and confirm endpoints with one-step undo. The shown-list conversation surface is not wired into Ask.                                                |
| Implemented but disabled | Gemini and Groq adapters plus funded-AI accounting. Dispatch stays off pending the [activation gates](docs/decisions/2026-09-30-included-ai-providers.md#activation-gates) |
| Not active               | Paid subscriptions, reusable routines, Teams, Classroom, and the GCP cutover                                                                                               |

Implementation is not live-provider acceptance. The
[acceptance record](docs/LIVE_PROVIDER_ACCEPTANCE.md) separates the September connected-account
checks from later changes that still need verification.

## The problem

1. Capturing a thought takes enough effort that it never reaches the planner.
2. A list records work but does not explain what deserves the next hour.
3. A weekly plan breaks when real life changes.
4. Commitments scattered across calendars, inboxes, and classes cause double-booking.
5. Understanding today requires reconstructing it from memory.

## Seven requirements

These are the requirements every change must serve. Acceptance targets describe the intended
outcome. They are not claims that a measurement or usage trial has been completed.

| #   | Requirement                                  | Acceptance target                                                                              |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | Turn one plain sentence into a task or event | Nine of ten sentences the owner actually types need no correction                              |
| 2   | Say what to work on first, and why           | Every ranked row exposes its score and reasons                                                 |
| 3   | Put the top of that list into real time      | Exact-length blocks land locally, only inside chosen availability                              |
| 4   | Let the person take it back                  | One undo reverses the latest change, including a whole scheduling run                          |
| 5   | Show the day without being asked             | The opening screen shows what is next, today, at risk, and newly arrived                       |
| 6   | Capture without conversation                 | A structured form captures title, deadline, estimate, category, and importance without parsing |
| 7   | Respect commitments made elsewhere           | Connected meetings, classes, and supported confirmations block time before placement           |

### Capture and correction

- Home opens first. The ranked list is part of that screen, not a separate chore.
- Manual mode is a form. It needs no model or network to interpret fields. Placement may read
  connected calendars. Form and sentence capture use the same validation and writer.
- Ambiguous references ask rather than guessing. Destructive bulk actions must first show the
  matching items, then act on exactly the confirmed IDs as one undoable change.
- Additive batch creation needs no confirmation step. One undo removes the entire batch.
- Confirmation belongs in the conversation, never a composer modal. Detail frames show requested
  information, not permission requests.

### Planning and truthful answers

- Home, Calendar, navigation counts, and common Ask answers share one normalized planning snapshot.
  One item must not become duplicate cards in different Home sections.
- Distinguish an active commitment from the next one, unscheduled work from work due today, and
  priority from feasible placement. Calendar occupancy alone cannot establish that all work fits.
- Schedule exact, continuous durations inside configured hours, respecting deadlines, breaks, and
  daily limits. A task without an estimate stays ranked and visibly unscheduled. Never invent one.
- Home may recommend unscheduled work only when it fits the safe interval ahead. Candidate slots
  are unsaved suggestions, not reservations or evidence that a block was committed.
- The today assessment covers unscheduled local tasks still due before local midnight. It uses
  candidates from the full seven-day projection, so higher-ranked future work can consume today's
  slots. Overdue work, missed blocks, and other backlog remain separate.
- Report unknown estimates explicitly. They make the assessment partial. An unavailable calendar
  suppresses candidate-slot and gap claims rather than inventing free time.
- Duration-fit questions test an exact standalone block before local midnight under the same
  placement rules. They do not promise backlog priority or reserve time. Unsupported horizons ask
  for a supported today question.
- Local moves require an exact future start and duration. Unknown IDs fail, ambiguous local or
  provider matches ask, and provider-owned items are refused as read-only.
- Mutation receipts reflect refreshed, committed state, including actual times and any waiting,
  overlap, or source-health warning. Intent alone is not proof of success.
- Estimate editing supports undo. Guided recovery previews missed-block changes, rejects stale
  previews, applies atomically, and provides one conflict-safe undo. Recovery is ungated in the beta.
- Weekly review is read-only. It covers recent completions and unfinished work, then upcoming
  commitments and deadline risks. It creates no review state, streaks, or time-saved claims.
- The pilot uses the configured server timezone for every owner. Setup must disclose it.

### Connected commitments

| Source           | Current behavior                                                      |
| ---------------- | --------------------------------------------------------------------- |
| Google Calendar  | Read-only events contribute busy time                                 |
| iCloud Calendar  | Read-only CalDAV events contribute busy time                          |
| Gmail            | Supported known-sender confirmations become reconciled commitments    |
| Teams            | Future read-only meetings and assignment imports. No connection today |
| Google Classroom | Future read-only assignments as ranked tasks. No connection today     |

Meetings and events supply busy intervals. Future assignments would be tasks with due dates and
must enter ranking instead. Every incoming source must handle moves and cancellations, not just
creation. A source that only adds events eventually fills the calendar with false commitments.

Luma, Meetup, and Eventbrite have no direct integration. Gmail can recognize supported confirmation
messages. Do not promise a named service until it is verified with a real account.

## Safety and privacy contracts

1. **The model proposes, and code decides.** Invalid proposals are refused. An event parsed from
   email is also a proposal and goes through the same application validation.
2. **Answers do not mutate.** An AI answer is text, never an implicit plan application.
3. **Integrations are additive.** With no AI key, Google account, or Microsoft account, local
   capture, ranking, and scheduling still work. Manual input never calls a model.
4. **Failed calendars do not lose tasks or invent time.** Capture and ranking succeed. Placement
   waits with a visible reason until connected availability can be checked. With no calendar
   connected, scheduling proceeds locally. Gmail watcher health is reported separately.
5. **New calendar writes stay local.** No RSVP, meeting creation, or provider write-back. Preserve
   legacy Google copies. Local edits must not delete them.
6. **Model input is bounded.** Only the person's own words and titles may go to a model, never
   attendees, other people's addresses, or provider calendar contents. Treat titles as data and
   sanitize them before prompt construction.
7. **Email is a narrow processing exception.** A deterministic parser reads supported known-sender
   bodies in memory. They may contain locations or other people's names. Extract only supported
   commitment fields, never retain the body after parsing, and never log email content. This is not
   permission to send inbox contents to a model. Remove the source if these bounds cannot hold.
8. **Background work must be visibly alive.** The one Gmail timer reports its last-checked time on
   the dashboard. It must not silently look healthy after it stops.

## Product and commercial boundaries

- No projects, boards, sprints, task dependencies, collaboration, reports, streaks, or gamification.
- No AI reranker. The explainable formula is the ranking. Tune its weights instead.
- No product audit trail. Undo the latest change is enough. The funded-AI accounting ledger is a
  separate, required spending control, not permission to build general mutation infrastructure.
- Exactly four categories: academics, work, organizations, personal. Unknown categories are personal.
- No throughput-driven infrastructure for a few thousand items per person. Keep sorting in memory.
- No queue, broker, worker pool, or message bus. The one watcher is a fixed timer and loop.

The landing presents proposed Free ($0) and Plus ($8/month) choices. Beta signup works. Plus
checkout is disabled and marked coming soon. Prices, AI allowances, and paid workflows are
proposals, not active entitlements. Cooper supplies provider keys, and there is no bring-your-own-key
(BYOK) flow. Model help stays off until the
[included-AI gates](docs/decisions/2026-09-30-included-ai-providers.md) are satisfied. Do not infer
approval for pricing, commercial schema, recurring tasks, infrastructure spend, or deployment from
the web-first decision.

## Early data decisions

These four safeguards avoid expensive retrofits without authorizing speculative platform work:

1. Every row has an owner, including the single-owner local case.
2. Provider credentials belong to an owner, never to one global user setting.
3. Use SQLAlchemy rather than database-specific SQL. SQLite is the local default. PostgreSQL
   supports hosted accounts.
4. The local shared key is a placeholder for local isolation, not account authentication.

Hosted scope remains narrow: Firebase identifies the verified account, PostgreSQL stores its
owner-scoped rows, and calendar and mail consent remain separate. This adds no sharing or team
model. Gmail's restricted permission also brings public-app review and assessment obligations. See
[the architecture privacy boundary](ARCHITECTURE.md#privacy-and-secrets).

## Success in real use

Passing tests is necessary but not sufficient. The owner should:

- Open Cooper in the morning and understand the day from the first screen.
- Stop maintaining a second list elsewhere.
- Trust the top of the list enough to start instead of rereading everything.
- Actually work the scheduled blocks.
- See supported inbox confirmations accurately, with unsupported messages ignored.
- Never find a block scheduled over a known class or meeting.

After two weeks of real use, failure means reassessing the score or the idea, not automatically
adding features. Smallness is a product requirement. The earlier version grew to 55 files and
461 tests and became difficult to follow.

## Historical release context

The owner advanced the seven-day Release 1 timing gate before Release 2. That was a sequencing
decision, not evidence that seven days of mixed-source use occurred. Connected-provider acceptance
remains separate. Temporary top-level schedule compatibility fields still support independently
deployed frontend and backend builds. Their removal has not started. Track new sequencing and
release status in the Project, not as additions to this document.
