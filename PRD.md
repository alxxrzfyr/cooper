# Cooper: what it must do

One place for everything that takes my time — tasks, events, and errands — that I can talk to.

Today it runs on my machine for me alone. A small public beta can also run with Firebase sign-in,
PostgreSQL, and owner-scoped data. That does not make it a team
tool: there is still no sharing, projects, reports, or collaboration.

The accepted product boundary is [one responsive web/PWA](docs/decisions/2026-09-30-web-first-product-boundary.md),
not a native mobile or separate app suite. Shared seven-day projection, scoped today capacity,
legal duration probes, manual estimate editing, guided recovery, and a read-only weekly review are
implemented.

The [included-AI decision](docs/decisions/2026-09-30-included-ai-providers.md) selects Gemini
primary and Groq fallback. Cooper supplies both keys; BYOK has been removed from Settings,
onboarding, and request payloads. Provider adapters and the four-table accounting ledger are
implemented, but funded dispatch remains disabled until cash, evaluated model IDs, prices, and
live-provider acceptance are approved.

Subscriptions, Teams, Google Classroom, reusable routines, funded AI, and the GCP cutover remain
inactive. Execution budgets and commercial schema require separate decisions. Active work,
priority, and release gates live in the
[Cooper Project](https://github.com/users/alxxrzfyr/projects/1), not in this requirements document.

## The problem

Five things go wrong with my time, and they are the same problem wearing five hats:

1. Something lands on my plate and never reaches my calendar, because opening another app
   and filling a form costs more than the thought was worth.
2. Everything is written down somewhere and I still cannot tell what deserves the next hour.
3. I plan a week and it survives until Tuesday.
4. My commitments are scattered across four places — tasks in my head, meetings in Google,
   classes and assignments in Teams, events I RSVP'd to in an inbox — and none of them know
   about each other. So every one of them can be double-booked by the others.
5. I have no single screen that tells me what today looks like. I have to assemble it from
   memory every morning.

## The things it must do

Requirements 1–6 work today. Requirement 7 is partly built: Google Calendar, iCloud Calendar,
and the Gmail confirmation watcher are available; Teams and Google Classroom remain future sources.

| #   | Requirement                                     | Done when                                                                               |
| --- | ----------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | Turn one plain sentence into a task or an event | Nine of ten sentences I actually type need no correction                                |
| 2   | Tell me what to work on first, and why          | Every row shows a score I can expand into its reasons                                   |
| 3   | Put the top of that list into real time         | Exact-length blocks land in Cooper's calendar, only inside availability I chose         |
| 4   | Let me take it back                             | One undo reverses the last thing, including a whole scheduling run                      |
| 5   | Show me my day without being asked              | One screen: what's next, what's today, what needs attention, what arrived               |
| 6   | Capture without talking to it                   | A form with the fields I actually fill, no parsing involved                             |
| 7   | Know about commitments I made elsewhere         | Meetings, classes and RSVP'd events all block time before anything is scheduled into it |

### What each of the new three means

**5 — The dashboard.** _Built._ The app opens here, not on the chat. Four things on it: the single next
thing to do, today's fixed events and booked blocks in one strip, anything overdue or running out
of runway, and what has arrived from elsewhere since I last looked. The ranked list is a section
on this screen, not an errand I run.

**6 — Manual is a form.** _Built._ Manual mode stopped meaning "type a sentence and simple rules
read it," which was the worst of both. It is a form now: title, deadline, how long, category,
importance. No model or network is needed to interpret the form; scheduling may read connected
calendars to avoid conflicts. AI mode is where I talk. Two doors, same room. A
typed item goes through the same validation and the same single writer as a parsed one, so there
is no second, looser way in.

The destructive verbs work in bulk through two steps: a match that lists everything a phrase hits
and writes nothing, then a confirmation that acts on exactly those ids and is recorded as one
change, so a single undo reverses the whole batch. The backend and its guarantees are built and
tested; wiring the two steps into the AI conversation as a shown list is the piece still to do.

**7 — Commitments from elsewhere.** Four sources, one idea:

| Source           | What arrives                  | Shape               |
| ---------------- | ----------------------------- | ------------------- |
| Google Calendar  | my events                     | busy time           |
| iCloud Calendar  | my events                     | busy time           |
| Teams meetings   | meetings, once connected      | future busy time    |
| Google Classroom | assignments, once connected   | future ranked tasks |
| Gmail            | supported event confirmations | busy time           |

Everything except assignments arrives as the same thing: time that is already spoken for, which
the scheduler must route around. Assignments are the exception and arrive as tasks with due
dates, which the existing score already knows how to rank.

The pipe this depends on is built. `sources.py` turns every commitment into one list of busy
intervals the scheduler routes around: Google Calendar, iCloud Calendar, Cooper's own blocks,
and confirmed Gmail events today. Teams and Classroom need separate connection work before they
can contribute anything.

Luma, Meetup, and Eventbrite have no direct integration. Gmail can import supported confirmation
messages, but a named service must be verified with a real account before its events are promised.
Teams and Classroom assignments are not imported today.

An incoming source is read-only and must handle change, not just creation. An event that moves
gets moved; an event that is cancelled is marked gone. A watcher that only ever creates fills
the calendar with things that are not happening, which is worse than an empty calendar because
it costs me trust.

## The rules it must never break

These are not features. They are the reasons I can leave it alone.

1. **The model proposes; code decides.** Gemini returns an action. `brain.py` validates it and
   `app.py` executes it. A wrong answer is refused, never applied. This applies to anything
   parsed out of an email too: a parsed event is a proposal.
2. **Nothing is booked outside my hours.** Candidate times are built from my working hours, so
   there is no path to any other time. Not a check that could be skipped: the shape of the data.
3. **When it is unsure, it asks.** An ambiguous reference produces a question. Acting on the
   wrong task is worse than one more exchange. Bulk destructive actions always show the list.
4. **It works with no API key and no account connected.** No Gemini key, no Google, no Microsoft,
   and it still captures, ranks, and schedules. Every integration is additive. Manual form entry
   never calls a model; placement checks calendars only when they are connected.
5. **An AI answer is text.** It can tell me anything about my own items and change none of them.
6. **My own words stay mine where they can.** Anything I typed and any title I wrote may go to a
   model. Nothing else may — not attendees, not other people's addresses, not the contents of my
   calendar entries.

   **Email is the exception, and it is a knowing one.** A deterministic parser reads a
   confirmation body in memory, and those bodies can contain locations and other people's names.
   Therefore: only messages matching a known sender are parsed, only the fields in requirement 7
   are extracted, the body is never stored after parsing, and no email content is ever logged. If
   this cannot hold, the Gmail source comes out.

7. **A background process must be visibly alive.** The email watcher is the first part of Cooper
   that runs while I am not looking, and so the first part that can fail silently. Last-checked
   time is on the dashboard. A watcher that has been dead for a week and looks fine is worse
   than no watcher.
8. **A failed integration never loses my task or guesses a free slot.** A task is still captured
   and ranked. If a connected calendar cannot be checked, it waits unscheduled with a visible
   reason and can be retried. With no calendar connected, local scheduling works normally.

## What it must never become

Written down because these are the exact things I will be tempted by at 1am.

- **No project management.** No boards, no sprints, no dependencies between tasks, no reports,
  no streaks, no gamification.
- **No AI reranker.** A model second-guessing the score, with a logged reason, sounds clever and
  is unexplainable in month three. The formula is the feature.
- **No audit trail.** Undo the last thing is enough.
- **No write-back to event platforms.** Cooper does not RSVP, create meetings, or post anywhere.
  Google and iCloud are read-only sources. New tasks and events live in Cooper's own calendar.
  Previously written Google blocks remain visible; Cooper does not delete them.
- **No fifth category.** Academics, work, organizations, personal. Unrecognised is personal,
  which is a better default than a wrong guess.
- **No scale work.** A few thousand items per person, sorted in memory. Anything added for
  throughput is a misreading of this document.
- **No infrastructure beyond one watcher.** The email watcher is the single exception to what was
  previously a flat no. It is a timer and a loop. It is not a queue, a broker, a pool of workers,
  or a message bus, and it must not become the excuse that lets those in.

The previous attempt at this app had a queue, an outbox, a circuit breaker, a quota governor and a
mutation ledger. It was 55 files and 461 tests and I could not follow it. Small is the requirement,
not the compromise. That is why requirement 7 is one idea with four pipes rather than four
integrations.

## Decisions made now because they are cheap now

Other people will use this eventually. That is not a feature to build today, but four things get
brutally expensive if they are deferred, so they are settled now:

1. **Every row knows who owns it.** An owner column from here on, even with exactly one owner.
   Retrofitting ownership onto existing rows is the single worst version of this change.
2. **Tokens are stored per owner, not as one global setting.** Google and Microsoft credentials
   hang off an owner, not off the app.
3. **No database-specific SQL.** Everything goes through SQLAlchemy so the move to Postgres is a
   connection string. SQLite stays until accounts arrive, because it needs no account, no bill,
   and no network, and it keeps working offline.
4. **The shared key is a placeholder, not the design.** It is one user's front door. It is not
   authentication and must not be extended into a pretend version of it.

Accounts and hosting are intentionally narrow: Firebase identifies a verified account, PostgreSQL
stores each owner's rows, and Google Calendar/Gmail consent stays per owner. Nothing about that
adds sharing or team features.

**The expensive thing to know about:** reading Gmail is a restricted permission. For me, in
testing mode, it is free. For a published app with other users, Google requires a paid annual
third-party security assessment. The cheapest-looking part of the plan is the one with a
recurring bill attached.

## The order

Not a schedule. A dependency chain.

1. **Dashboard.** First, because I cannot see my own life in this app yet, and every source I
   add makes that worse until this exists.
2. **Manual as a form, and bulk verbs.** Small, and it changes daily use.
3. **One busy-time pipe.** The shared idea behind requirement 7. Build it once with Google, the
   source it already has.
4. **The email watcher.** Known confirmations over Gmail, on one fixed timer and loop.
5. **Teams and Google Classroom.** Separate future plans: meetings become busy time and
   assignments become ranked tasks only after each read-only connection is built and verified.
6. **Accounts, Postgres and hosting.** Built as one piece: Firebase Auth, owner-scoped rows,
   PostgreSQL migrations, Render, and Firebase Hosting.

## How I will know it works

Not "the tests pass". These:

- I open it in the morning without deciding to, and the first screen tells me everything.
- I stop keeping a separate list somewhere else.
- I trust the top of the list enough to just start, instead of re-reading the whole thing.
- When it schedules my day, the blocks are ones I actually work.
- A supported confirmation from a connected inbox shows up accurately, and unsupported messages
  do not create calendar entries.
- Nothing gets booked over a class or a meeting, ever.

If after two weeks of real use those are not true, the answer is not more features. Either the
score is wrong, in which case the weights in `planner.py` need tuning, or the idea is wrong, in
which case stop.

## Where it stands

Requirements 1–6 work. Google Calendar and Gmail are optional: without my own Google Cloud
credentials the app stays fully local and reports both services as off.

Requirement 7's shared pipe (`sources.py`) combines Google Calendar, iCloud Calendar, Cooper
blocks, and supported Gmail confirmations. Connected calendar reads must complete before a task
is placed; an unavailable source leaves it captured and waiting. The one Gmail timer reports its
last check. Teams and Classroom are future read-only sources, and Luma/Meetup have no direct
integration. The owner manually verified the Google Calendar and iCloud Calendar acceptance flows
on 2026-09-14; the repeatable record is in `docs/LIVE_PROVIDER_ACCEPTANCE.md`. Bulk destructive
verbs still need their conversation surface in AI mode.

Calendar, navigation counts, and the common Ask questions now consume one normalized planning
snapshot. That snapshot conservatively deduplicates commitments, retains their source and editability,
derives task state, and reports provider health. Importance is an explainable ranking term rather
than decorative metadata. Common questions such as what to focus on, what remains today, what to do
next, and whether a focus block fits are answered from that snapshot without sending provider event
contents to a model. Creation and scheduling replies are rebuilt from committed state and include
any overlap, waiting, or unavailable-source warning; a successful-looking reply is never generated
from intent alone.

Planning answers distinguish an active commitment from the next one and disclose
unscheduled work separately from today's calendar, without assigning every open task
a today deadline. A highest-priority task is not a confirmed time slot. Workload
answers report calendar occupancy, overlaps, estimated unscheduled effort and unknown
estimates; they do not declare the day manageable from a calendar-only threshold.
Home assesses known unscheduled due-today demand against candidate slots filtered
from the full seven-day scheduler. Unknown effort makes the assessment partial;
unavailable calendars suppress capacity claims. Duration-fit answers respect exact
placement constraints and local midnight. Manual estimate editing refreshes the
assessment and supports undo. The pilot uses one configured server timezone for all
owners. Guided recovery of missed blocks (preview, then explicit apply, one undo) is
implemented and ungated in the beta. A read-only weekly review (`GET /api/review/week`, Home's
This week panel) is implemented. Broader demand analysis and reusable routines remain future work.

The public landing includes FAQs beside proposed Free and Plus choices ($0 and
$8/month). The beta signup link works; Plus checkout is disabled and explicitly
coming soon. Included AI allowances and paid planning workflows are proposals, not
active entitlements. The FAQ explains that no user key is needed and model help is
unavailable until Cooper-funded AI is enabled.
Landing chapters remain horizontal from 900px and retain vertical flow below that
width. Section scrollbars are hidden without disabling scrolling. FAQ answers open
one at a time in normal flow; centered FAQ/pricing columns share alignment rows and
stack on narrow screens. Vertical wheel input continues driving horizontal travel
on desktop. Flexible chapter tracks and content-height cards support resize/zoom
without fixed minimum columns pushing content outside its chapter.

Home now presents that snapshot as a command center: Now, Next, Today, At Risk, and Upcoming all
refer to one underlying task or commitment instead of duplicating cards. A recommended task appears
in Now only when it fits the safe free interval immediately ahead. If a connected source cannot be
checked, Home says planning is incomplete and does not claim that time is free. External commitments
remain visible and read-only.

Local COOPER items can be moved to an exact future time with a required duration from either Ask or
Home. Both surfaces use the same `app.py` writer, record undo, and build their success reply from the
refreshed committed snapshot. Ambiguous local matches or local/provider title collisions ask instead
of guessing; unknown ids fail, and provider-owned targets are refused rather than written back.

The owner explicitly advanced the seven-day Release 1 timing gate before starting this Release 2
work. That was a sequencing decision, not retrospective evidence that seven days of mixed-source use
occurred. The existing Google Calendar and iCloud acceptance record remains the separate live-provider
evidence. Legacy top-level schedule fields also remain temporarily because the backend and frontend
can be deployed independently; Release 3 compatibility-field removal has not started.

Requirement 5 also settled an argument the docs had lost with the code: an errand was being given
an invented half-hour block, against what all three documents promised. The dashboard's "waiting
for a time" group is what made keeping the promise safe, because skipping is no longer silent.
