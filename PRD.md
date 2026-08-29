# Cooper: what it must do

One user. One machine. A calendar you talk to.

## The problem

Four things go wrong with my time, and they are the same problem wearing four hats:

1. Something lands on my plate and never reaches the calendar, because opening Google Calendar
   and filling a form costs more than the thought was worth.
2. Everything is written down somewhere and I still cannot tell what deserves the next hour.
3. I plan a week and it survives until Tuesday.
4. Tasks live in my head, time lives in Google Calendar, and the two never meet.

## The four things it must do

| # | Requirement | Done when |
| --- | --- | --- |
| 1 | Turn one plain sentence into a task or an event | Nine of ten sentences I actually type need no correction |
| 2 | Tell me what to work on first, and why | Every row shows a score I can expand into its reasons |
| 3 | Put the top of that list into real time | Blocks land in Google Calendar, only inside hours I chose |
| 4 | Let me take it back | One undo reverses the last thing, including a whole scheduling run |

## The five rules it must never break

These are not features. They are the reasons I can leave it alone.

1. **The model proposes; code decides.** Gemini returns an action. `brain.py` validates it and
   `app.py` executes it. A wrong answer is refused, never applied.
2. **Nothing is booked outside my hours.** Candidate times are built from my working hours, so
   there is no path to any other time. Not a check that could be skipped: the shape of the data.
3. **When it is unsure, it asks.** An ambiguous reference produces a question. Acting on the
   wrong task is worse than one more exchange.
4. **It works with no API key.** No Gemini key, no Google account, and it still captures, ranks,
   and schedules. The model makes parsing better, never possible.
5. **Nothing leaves the machine that does not have to.** Prompts carry my own words and my own
   task titles. Never event descriptions, locations, or other people's addresses.

## What it must never become

Written down because these are the exact things I will be tempted by at 1am.

- **No second user.** No accounts, no sharing, no permissions. If a feature only makes sense
  with someone else in the picture, it is out.
- **No audit trail.** Undo the last thing is enough. Nobody audits their own calendar.
- **No infrastructure.** No queue, no broker, no worker process, no cache, no migration tool.
  One person's tasks fit in a SQLite file.
- **No AI reranker.** A model second-guessing the score, with a logged reason, sounds clever and
  is unexplainable in month three. The formula is the feature.
- **No project management.** No boards, no sprints, no dependencies between tasks, no reports,
  no streaks, no gamification.
- **No scale work.** A few thousand items, sorted in memory. Anything added for throughput is a
  misreading of this document.

The previous attempt at this app had all of the above. It was 55 files and 461 tests and I
could not follow it. Small is the requirement, not the compromise.

## How I will know it works

Not "the tests pass". These:

- I open it in the morning without deciding to.
- I stop keeping a separate list somewhere else.
- I trust the top of the list enough to just start, instead of re-reading the whole thing.
- When it schedules my day, the blocks are ones I actually work.

If after two weeks of real use those are not true, the answer is not more features. Either the
score is wrong, in which case the weights in `planner.py` need tuning, or the idea is wrong, in
which case stop.

## Where it stands

All four requirements work. Google Calendar needs my own Google Cloud credentials to write to a
real calendar; without them everything else runs and the calendar reports itself as off.
