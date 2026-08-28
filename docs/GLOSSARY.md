# Glossary

The vocabulary is precise. Using these words loosely produces designs that drift, so prefer the
exact term over a synonym.

| Term | Meaning |
| --- | --- |
| **Task** | Work with no fixed time. Has effort, importance, and optionally a deadline. Rankable and placeable. |
| **Event** | A fixed commitment at a fixed time, such as a dentist appointment. Never ranked, never re-placed. |
| **Block** | A span of calendar time allocated to a task by the scheduler. A task may have several. Distinct from an event. |
| **Focus window** | A recurring local-time span the user has declared as available for automatic scheduling. The only territory the scheduler may write into. |
| **Daily cap** | Maximum number of blocks the scheduler may place in one window on one day. |
| **Intent** | A validated structured object representing one requested change. The complete output space of the language model. See spec section 7. |
| **Intent compiler** | The component that turns one user sentence into one intent. Sees only text the user typed. |
| **Reranker** | The component that may reorder the top 10 already-ranked candidates. Cannot mutate anything. |
| **Candidate** | An active task with no incomplete blockers whose `earliest_start` falls within the horizon. Eligible for ranking. |
| **Shortlist** | The top of the ranked candidate list, after reranking. What the Today view shows. |
| **Score** | Deterministic priority number from the weighted formula in spec section 9. |
| **Slip** | An increment to `slip_count`, recorded when a placed block passes unworked. Raises the task's future score. |
| **Pin** | A user override setting `pinned_for_date`, placing a task first and bypassing scoring entirely. |
| **Placement** | The deterministic first-fit algorithm that turns a shortlist plus free window time into blocks. |
| **Projection** | Google Calendar's role. It reflects Cadence's state and is never the source of truth. |
| **App-owned** | A calendar event carrying Cadence's `extendedProperties.private.cadence_block_id` tag. The only events Cadence may modify. |
| **`user_moved`** | Block state after the user moved it by hand in Google Calendar. Excluded from automatic re-placement. |
| **`orphaned`** | Block state after the user deleted its calendar event. Its task returns to the backlog. |
| **Outbox** | Durable queue of pending calendar writes. Keeps calendar writes out of database transactions. |
| **Batch** | Set of mutations sharing a `batch_id`, produced by one user turn or one job run. The unit of undo. |
| **Mutation log** | Append-only record of every change with before state, after state, and batch. Makes undo possible. |
| **Scrubber** | Field allowlist applied at the adapter boundary. Sensitive fields never enter the database. |
| **Quota governor** | Wrapper around model calls handling backoff and the circuit breaker. |
| **Degraded mode** | Designed product state entered when model quota is exhausted. Capture, ranking, and scheduling all still work. |
| **Day drift** | Divergence between the plan and reality during a day. Repaired by `day_drift_reconcile`. |
| **Catch-up job** | A scheduled job that runs at startup if overdue, rather than firing only at a trigger time. Required because the machine sleeps. |
| **Kill criterion** | The binding gate after Phase 2. Not opening Today on 10 of 14 days ends the project. |
