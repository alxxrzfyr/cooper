# Testing

The organizing idea: push logic into `core/` where it is pure, and test it without mocks. Mocks
are reserved for the boundary, and even there a hand-written fake is preferred over a mock
library because a fake can enforce the Protocol's contract.

## Layout

```
tests/
  core/        Pure unit tests. No I/O, no fixtures beyond plain data. Fast.
  services/    Orchestration against a real in-memory SQLite and fake adapters.
  adapters/    Each adapter against a fake or recorded transport.
  fixtures/
    intents.jsonl        Sentence to expected intent, the golden set.
    calendar_pages.json  Recorded events.list responses, already scrubbed.
  e2e/         One happy path: sentence in, block on the fake calendar.
```

Run `uv run pytest tests/core -q` constantly while working. It should stay under a second.

## Domain core

Plain unit tests plus property tests for the scheduler. The property tests assert the invariants
directly, and each is named after the invariant it defends:

- `test_scheduler_never_places_outside_window`
- `test_scheduler_never_exceeds_daily_cap`
- `test_scheduler_never_overlaps_busy_time`
- `test_scheduler_never_places_in_the_past`
- `test_split_pieces_meet_minimum_or_do_not_split`

Generate window sets, busy intervals, and task lists, then assert the invariant over every
output. Hypothesis is the tool of choice, pinned.

DST needs explicit non-generated cases, because the interesting inputs are two specific instants
per year:

- A window overlapping the spring-forward gap shifts to the first valid time.
- A window overlapping the fall-back repeat resolves to the first occurrence.
- A day containing a transition still produces a valid, non-overlapping schedule.

## Scoring

Table-driven. One row per term, asserting monotonicity: raising importance never lowers a score,
an overdue task always outscores an identical task due next week, a task slipped three times
outscores an identical never-slipped task. Monotonicity tests catch weight-tuning mistakes that
exact-value assertions miss.

Also assert the composite: `test_ranking_makes_no_model_calls` uses a provider fake that raises
on any call. Ranking must work with zero model calls, and this test is what keeps that true.

## Intent compiler

The hard problem: the component is non-deterministic and the thing it talks to changes without
notice. Three layers handle it.

1. **Golden fixtures in CI.** `intents.jsonl` holds sentence-to-intent pairs. CI runs them
   against recorded responses, so the suite is fast, offline, and deterministic.
2. **Nightly live contract test.** The same fixtures run against the live model on a schedule,
   outside CI. This is how a model rename or a behavior change is discovered before it reaches
   the calendar. Failure here is information, not a broken build.
3. **Rule-based provider tested directly.** The same fixture subset covering common shapes runs
   against `RuleBasedProvider` with no network at all.

Temperature 0 for compilation. Add a fixture row whenever a real sentence parses wrongly; that
file is the regression record of every mistake worth not repeating.

## Reranker

Adversarial, because this component receives third-party text.

- A response naming an ID that was not supplied is rejected.
- A response omitting a supplied ID is rejected.
- A response with a duplicate ID is rejected.
- A reason over 200 characters is rejected or truncated, and the choice is asserted.
- A response containing instruction-like text in the reason changes nothing beyond ordering.

That last test is the injection containment invariant expressed as an executable assertion.

## Calendar adapter

Tested against a fake implementing `CalendarClient`. Required cases: `410 Gone` triggers full
resync with no duplicate blocks; a `429` backs off and retries; a duplicate `insert` with the same
client-generated ID does not create a second event; an event with other attendees is refused by
every automatic mutation path.

## Undo

Round trips. Apply a batch, snapshot, undo, and assert the database matches the pre-batch state.
Cover a multi-mutation batch, a batch that included a calendar write, and undo of an already
undone batch, which must be a no-op rather than an error.

## Jobs

- A job whose `last_run_at` is overdue runs at startup.
- The same job run twice produces no duplicate effect.
- `day_drift_reconcile` releases past unstarted blocks, increments `slip_count`, and re-places the
  rest of the day.

## Security

- A request without the shared-secret header is refused.
- An unknown `Origin` is refused.
- An unexpected `Host` is refused.
- The app binds `127.0.0.1`, asserted against the running configuration.
- No test fixture, log line, or recorded response contains a real token, an attendee email, an
  event description, or a location.

## Layer purity

`lint-imports` runs as part of the suite, not only in a separate CI step, so a violation surfaces
locally before it is committed.

## What is not tested

No load tests, no performance benchmarks, no browser matrix. One user, one browser, one machine.
Effort spent there is effort not spent on the invariants that can actually corrupt a calendar.
