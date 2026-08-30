# Cooper: what it must do

One place for everything that takes my time — tasks, events, and errands — that I can talk to.

Today it runs on my machine for me alone. It is being built so that other people can use it
later, and that intent shapes a handful of decisions listed at the bottom. It does not mean
building account features now.

## The problem

Five things go wrong with my time, and they are the same problem wearing five hats:

1. Something lands on my plate and never reaches the calendar, because opening Google Calendar
   and filling a form costs more than the thought was worth.
2. Everything is written down somewhere and I still cannot tell what deserves the next hour.
3. I plan a week and it survives until Tuesday.
4. My commitments are scattered across four places — tasks in my head, meetings in Google,
   classes and assignments in Teams, events I RSVP'd to in an inbox — and none of them know
   about each other. So every one of them can be double-booked by the others.
5. I have no single screen that tells me what today looks like. I have to assemble it from
   memory every morning.

## The things it must do

Requirements 1–5 work today. 6 and 7 are the build.

| # | Requirement | Done when |
| --- | --- | --- |
| 1 | Turn one plain sentence into a task or an event | Nine of ten sentences I actually type need no correction |
| 2 | Tell me what to work on first, and why | Every row shows a score I can expand into its reasons |
| 3 | Put the top of that list into real time | Blocks land in Google Calendar, only inside hours I chose |
| 4 | Let me take it back | One undo reverses the last thing, including a whole scheduling run |
| 5 | Show me my day without being asked | One screen: what's next, what's today, what needs attention, what arrived |
| 6 | Capture without talking to it | A form with the fields I actually fill, no parsing involved |
| 7 | Know about commitments I made elsewhere | Meetings, classes and RSVP'd events all block time before anything is scheduled into it |

### What each of the new three means

**5 — The dashboard.** *Built.* The app opens here, not on the chat. Four things on it: the single next
thing to do, today's fixed events and booked blocks in one strip, anything overdue or running out
of runway, and what has arrived from elsewhere since I last looked. The ranked list is a section
on this screen, not an errand I run.

**6 — Manual is a form.** Manual mode stops meaning "type a sentence and simple rules read it,"
which is the worst of both. It means a form: title, deadline, how long, category, importance.
No parsing, no network, no misreads. AI mode is where I talk. Two doors, same room.

AI mode also handles the destructive verbs, including in bulk — complete these, drop those. Bulk
shows me the list and asks first. Undo is enough correction for one item and not enough for
twenty.

**7 — Commitments from elsewhere.** Four sources, one idea:

| Source | What arrives | Shape |
| --- | --- | --- |
| Google Calendar | my events | busy time |
| Outlook / Teams | my meetings | busy time |
| Teams classes | assignments, with due dates | ranked tasks |
| Gmail | Luma, Meetup and Eventbrite confirmations | busy time |

Everything except assignments arrives as the same thing: time that is already spoken for, which
the scheduler must route around. Assignments are the exception and arrive as tasks with due
dates, which the existing score already knows how to rank.

Luma, Meetup and Eventbrite are not integrated directly. They send email, so Gmail is the bridge
and one connection covers all three — and covers Teams assignments too, when a school tenant
refuses direct access.

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
   and it still captures, ranks, and schedules. Every integration is additive. Manual mode is the
   default and never calls a model or the network at all.
5. **An AI answer is text.** It can tell me anything about my own items and change none of them.
6. **My own words stay mine where they can.** Anything I typed and any title I wrote may go to a
   model. Nothing else may — not attendees, not other people's addresses, not the contents of my
   calendar entries.

   **Email is the exception, and it is a knowing one.** Parsing a confirmation email means
   sending its body to a model, and those bodies contain locations and other people's names.
   The price of not maintaining three fragile scrapers. Therefore: only messages matching a
   known sender is parsed, only the fields in requirement 7 are extracted, the body is never
   stored after parsing, and no email content is ever logged. If this cannot hold, the Gmail
   source comes out.

7. **A background process must be visibly alive.** The email watcher is the first part of Cooper
   that runs while I am not looking, and so the first part that can fail silently. Last-checked
   time is on the dashboard. A watcher that has been dead for a week and looks fine is worse
   than no watcher.
8. **A failed integration never blocks me.** Google down, Microsoft down, watcher stopped — the
   item is still captured, still ranked, still scheduled locally. Local is the source of truth
   and every remote is a mirror.

## What it must never become

Written down because these are the exact things I will be tempted by at 1am.

- **No project management.** No boards, no sprints, no dependencies between tasks, no reports,
  no streaks, no gamification.
- **No AI reranker.** A model second-guessing the score, with a logged reason, sounds clever and
  is unexplainable in month three. The formula is the feature.
- **No audit trail.** Undo the last thing is enough.
- **No write-back to event platforms.** Cooper does not RSVP for me, does not create Teams
  meetings, does not post anywhere. It reads commitments and schedules around them. Writing is
  Google Calendar only, and only for blocks it placed.
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

And two things that are explicitly *not* being solved yet: real accounts, and hosting. Both
arrive together, with Postgres and a migration tool, in one deliberate piece of work.

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
4. **Outlook and Teams meetings.** Cheap once the pipe exists. Then Teams assignments, which
   feed the ranked list rather than the calendar.
5. **The email watcher.** Luma, Meetup, Eventbrite. Roughly half the total work, and the only
   item that needs a rule rewritten to allow it.
6. **Accounts, Postgres and hosting.** One piece of work, not spread out. Only when someone else
   actually needs in.

## How I will know it works

Not "the tests pass". These:

- I open it in the morning without deciding to, and the first screen tells me everything.
- I stop keeping a separate list somewhere else.
- I trust the top of the list enough to just start, instead of re-reading the whole thing.
- When it schedules my day, the blocks are ones I actually work.
- An event I RSVP to on Luma shows up without me touching anything, and nothing else does.
- Nothing gets booked over a class or a meeting, ever.

If after two weeks of real use those are not true, the answer is not more features. Either the
score is wrong, in which case the weights in `planner.py` need tuning, or the idea is wrong, in
which case stop.

## Where it stands

Requirements 1–5 work. Google Calendar needs my own Google Cloud credentials to write to a real
calendar; without them everything else runs and the calendar reports itself as off.
Requirements 6 and 7 are not built. Nothing in the current code contradicts them.

Requirement 5 also settled an argument the docs had lost with the code: an errand was being given
an invented half-hour block, against what all three documents promised. The dashboard's "waiting
for a time" group is what made keeping the promise safe, because skipping is no longer silent.
