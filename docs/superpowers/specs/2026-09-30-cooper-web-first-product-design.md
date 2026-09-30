# Cooper web-first product design

Implementation status, 2026-10-01: the bounded today-capacity tranche is implemented
in the working tree. See its implementation plan for automated and browser evidence.
Recovery coordination, weekly review, routines, funded AI, billing and hosted cutover
remain proposed contracts. The initial pilot displays one configured server timezone;
owner-selectable timezone support is not implemented.

Date: 2026-09-30. Status: reviewed draft, not a runtime implementation.

The owner selected one Cooper product and explicitly ruled out native mobile work.
Included Gemini with Groq fallback, freemium and a bounded-cost GCP migration are
approved directions. Feature contracts, commercial schema, budgets and launch terms
below are recommendations awaiting final approval. They are not deployed behavior.

This refines the [product rethink](../../designs/cooper-product-rethink.md).
Current behavior stays documented in [PRD](../../../PRD.md) and
[architecture](../../../ARCHITECTURE.md). Detailed provider behavior stays in the
[AI fallback specification](2026-09-30-included-ai-provider-fallback-design.md).

## The product and the reason to return

Cooper turns a person's tasks and fixed commitments into a feasible plan, explains
what cannot fit, and helps recover when the plan changes. Calendar connections
provide constraints. AI removes language and setup friction. Neither is the product.

The initial audience hypothesis is adults who already use a task list and calendar
but repeatedly reshuffle work, including working adults taking classes. This has
not been validated with customers. No team permission system or school-age launch.

The paid outcome is less repeated planning work each week. Do not charge merely
because checkout works or a larger model allowance is available. The target repeat
loop is capture, estimate, choose a feasible day, finish or recover, then review.

| Approach                                               | Benefit                                               | Cost and six-month regret                                              | Decision                                    |
| ------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| Improve capture and add funded chat                    | Smallest extension                                    | A convenient chat box with little reason to renew                      | Necessary convenience, insufficient product |
| Complete planning and recovery in the existing backend | Uses the scheduler, snapshot and undo already present | Requires truthful feasibility and useful repeated workflows            | Recommended                                 |
| Build a suite of separate productivity apps            | Broader feature list                                  | Multiple models, navigation systems and products before one is trusted | Rejected for this scope                     |

One account, one subscription, one responsive web/PWA application and one backend.
The four assisted workflows below are capabilities, not separate services, agents
with unrestricted tools, or four chat tabs. No native app, microservice split, queue,
project boards, note editor or speculative integration framework.

## Four assisted workflows with bounded authority

| Workflow            | Trigger and useful result                                                       | Authority                                                                          | Release dependency                                   |
| ------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Capture and clarify | Own sentence becomes validated tasks; missing effort asks rather than guessing  | Existing single/additive batch writer, one undo                                    | Funded admission before hosted model calls           |
| Plan and explain    | Explain selected work, constraints, unscheduled items and concrete choices      | Read-only snapshot and deterministic simulation; model may explain supported facts | Tested feasibility core                              |
| Recover             | Show missed local blocks and proposed replacements while preserving fixed work  | Explicit apply through `app.py`; recheck at write; one batch undo                  | Separate preview/apply contract                      |
| Review and reuse    | Summarize unfinished work and upcoming deadlines; reuse an owner-chosen routine | Read-only review; explicit batch creation for reuse                                | Weekly window contract; routine persistence approval |

No unprompted model loop. No model ranking, invented deadlines or durations, direct
database access, remote calendar writes, automatic email-body reasoning or vendor
web/code/MCP tools. An AI answer remains text and writes nothing. Applying a plan
is a separate explicit action, not a side effect of answering a question.

Task breakdown is an experiment after the core loop works. Suggest actions and ask
for missing estimates. Do not create a hidden dependency graph or reinterpret
suggested durations as measured effort. Existing `add_batch` remains additive and
does not acquire a permission modal.

## A useful first session

1. Show the fixed pilot timezone and set actual availability. Offer reasonable
   editable hour defaults, never imply that the whole day is available. Do not show
   a timezone picker until owner-timezone persistence exists end to end.
2. Capture up to three sample responsibilities chosen by the person, or real work.
   Do not require three items to continue. Manual input works without AI.
3. Ask for missing durations; a skipped estimate stays unknown.
4. Show fixed commitments, candidate slots, unplaced tasks and uncertainty.
5. Apply safe local placement using the existing schedule action, then return a
   verified receipt with undo. Offer calendar connections after useful local work.

Example acceptance fixture, not marketing testimony: two separate 60-minute gaps
cannot contain one continuous 90-minute task even though their sum is 120 minutes.
Cooper says no slot was found and offers a deadline/availability/estimate edit.
It does not split the task or schedule outside configured hours.

## Web experience and responsive contract

Keep Home, capture/Ask, Calendar and Settings. Home answers what is happening now,
what comes next and what needs attention. Add a compact capacity summary to Home,
not another top-level application. A weekly-review entry can live on Home when
that workflow exists. Settings owns plan status, usage, sources and data controls.

```text
Home, roomy web                         Home, narrow web
----------------------------------     --------------------------
Greeting       Sources checked         Greeting / source health
Now            Next                    Now, then Next
Rest of today / estimate gaps          Rest of today / estimate gaps
Today's agenda Unplaced work           Agenda, then unplaced work
Review / recover when relevant         Review / recover
Composer                               Composer
```

The app uses normal vertical document flow. The public landing retains its
established horizontal chapters on desktop CSS widths of at least 900px, with
vertical wheel input driving horizontal travel. Below that width it flows vertically.
Do not change direction because the viewport is short. Do not use CSS zoom or
shrink the whole design to hide overflow.

FAQ and subscription headings share a row on roomy screens; introductory copy and
content start on shared rows. Stack the two groups when their minimum readable
widths cannot fit. Answers expand in normal flow, with at most one open. Pricing
features and buttons align within their own grid, not to individual FAQ rows.
Hide section scrollbar chrome without disabling keyboard/touch overflow access.
If content exceeds the viewport height, keep it reachable; no clipped accordion,
fixed-height answer box or decorative arrow positioned outside its label wrapper.

For a tall desktop chapter, `.landing__panel` is the vertical overflow container,
not an extra FAQ-only pane. Vertical wheel input retains horizontal chapter travel;
touch vertical drag and keyboard PageUp/PageDown within the focused panel reach
overflow, and Tab must scroll the focused disclosure/link into view. Add panel
focusability and an accessible name during a future UI change if needed. Disclosure
expansion and column stacking must trigger chapter sizing refresh and preserve
focus. Test the longest expanded answer in a short desktop viewport at enlarged text.

Landing copy remains beta-accurate: model assistance currently needs a supplied
Gemini key; funded AI and Plus workflows are coming soon. Show proposed allowances
and non-active subscription status beside the cards, not only inside a FAQ. Beta
signup works and Plus purchase stays disabled until commercial release gates pass.

Use existing tokens and otter assets. Green remains reserved for done and red for
gone within the application. Status is also text/icon, never color alone. Do not
replace the public site's established palette during this product-design pass.

Planned acceptance sizes: 320, 390, 768, 900, 1024, 1366 and 1920 CSS pixels;
short laptop height; 80%, 100%, 110%, 125%, 150% and 200% browser zoom; enlarged
text; keyboard-only; reduced motion. These checks are not yet performed. Maintain
readable text, flexible zero-minimum columns, 44px primary touch targets and WCAG
AA contrast. No viewport scaling, overlapping copy or inaccessible content.

Refresh preserves focus. Announce final receipts and error summaries through a
polite live region, without rereading the agenda on each poll. Associate field
errors with controls. Dismissing a preview returns focus to its launch control;
conflicts return to a refreshed preview with a concise announcement. Undo is
keyboard reachable; an unavailable or conflicting undo explains why without
overwriting newer work. Keep native FAQ disclosure semantics and visible focus.

| State                          | What the person sees and can do                                            |
| ------------------------------ | -------------------------------------------------------------------------- |
| No tasks or providers          | Useful manual capture; no integration wall or empty AI pitch               |
| Missing estimate               | Named task and estimate action; no zero-effort assumption                  |
| Connected calendar unavailable | Name/freshness/reconnect action; capture continues, safe placement blocked |
| Loading                        | Keep previous content labeled as refreshing; do not imply it is current    |
| AI quota exhausted             | Reset date and manual/rule actions; no disabled core or surprise charge    |
| AI transport failure           | Explicit temporary limitation; preserved input and safe manual option      |
| Plan changed since preview     | Refresh preview; do not apply obsolete times                               |
| Partial placement              | Exact placed/unplaced list with reasons; no blanket success                |
| Mutation succeeds              | Committed-state receipt and one undo; duplicate clicks do not replay AI    |
| Downgrade                      | Data remains accessible; paid automation stops at entitlement boundary     |

Bulk destructive actions list their targets in the conversation before acting.
No new composer confirmation modal. Empty/error states must name the next useful
action; no generic retry button for invalid credentials or impossible deadlines.

## First buildable contract: today's feasibility, not a productivity score

Extend the canonical snapshot with a read-only `capacity` assessment. Keep legacy
metrics for compatibility; stop interpreting all-open effort as today's demand.

The assessment reports the remainder of the current planning day only. The first
pilot uses the configured server timezone that `current_hours()` installs today.
Onboarding must display that timezone as a fixed pilot setting and must not offer
an owner-timezone selector that the backend ignores. Owner-selectable timezones are
a separate end-to-end contract covering settings persistence, date inputs, source
normalization, scheduling, rendering and DST acceptance before a wider launch.
The planning day ends at the next midnight in the effective timezone converted to
UTC, which may be 23 or 25 hours away on DST days.

Report these distinct cohorts: unscheduled open work with a deadline from `at`
inclusive to today's end exclusive, overdue work with a deadline before `at`,
other unscheduled backlog, existing scheduled
blocks and unknown estimates. Missed blocks remain visible as risks and need the
future recovery workflow. Do not silently clear their schedule in a read-only check.

Assessment and scheduling use one simulation. Factor the existing scheduling inputs
into a pure `project_open_tasks()` helper: all owner-scoped open local tasks, all
existing local blocks, normalized remote busy intervals, the configured hours and a
seven-day horizon. It reuses `rank()` and `place()`, including pinning, lead time,
breaks, exact duration, deadlines, daily block limits and daily minute limits.
`app._plan_in_session()` must call the same helper before it writes slots.

The capacity assessment does not run a smaller due-today schedule. It filters the
due-today outcome from that full seven-day projection. A pinned future task can
therefore take a scarce slot before a due-today task, exactly as a real scheduling
run would. The summary labels this distinction: demand scope is unscheduled work due
today; scheduling scope is all open local tasks over seven days. Add an explicit end
boundary to `place()` only for the separate standalone duration probe. Do not modify
input ORM objects or persisted slots. Use the same sampled `at`, timezone and source
health as the parent snapshot.

Proposed wire contract:

```text
capacity = {
  day, generated_at,
  status: checked | needs_estimates | source_unavailable,
  demand_scope: due_today_unscheduled,
  scheduling_scope: all_open_local_tasks_7_days,
  due_today_ids, overdue_ids, other_backlog_count, missed_block_ids,
  unknown_estimate_ids, unknown_estimate_count, assessment_partial,
  known_estimated_due_today_minutes,
  candidate_slots: [{item_id, start_at, end_at}],
  unplaced: [{item_id, reason: overdue | no_feasible_slot}],
  open_window_minutes: number only when source health is complete
}
```

`unknown_estimate_ids` and `unknown_estimate_count` include only the due-later-today
cohort, not unrelated backlog. `known_estimated_due_today_minutes` is explicitly a
subtotal, never a total when `assessment_partial` is true. Overdue work and its
estimate warnings are separate from today's simulated demand. Source failure takes
precedence over `needs_estimates` while retaining those warnings. `checked` means
inputs were checked, not that all work fits. `source_unavailable` has no candidate
slots or certified free-time figure and still names unknown estimates.
`needs_estimates` may show placements for known-estimate tasks, but Home must lead
with "Partial assessment: N due-today tasks need estimates." It must not present
"0 estimated minutes" or "0 possible slots" as a complete result when effort is
unknown. The frontend represents these variants as a discriminated union, not
optional fields that allow contradictory states.

Call remaining gap minutes `open window minutes`, not executable capacity. They
subtract merged busy intervals and existing-block break protection and start after
lead time, but daily task limits and fragmentation can make placement impossible.
Only returned candidate slots establish that those exact estimated tasks could
fit in that ranked simulation. A greedy simulation failure is not proof that no
different ordering can ever work. Say "No slot found under this plan."

Home keeps Now/Next visually primary. Its unscheduled "Now" recommendation must
come from the same full projection used by scheduling. Recommend a task only when
its projected slot starts at the scheduler's first legal start (`at + LEAD`) and
fits every placement rule. If daily limits, pinning, existing blocks or another
ranked task prevent that placement, Home shows no unscheduled "Now" task. An active
commitment remains the current item independently of that projection.

Label the summary "Rest of today" and show its sampled update time. State "Due today"
for the demand cohort and "Plan my day considers all open tasks over seven days" for
the scheduling scope. Candidates are "Projected slots, unsaved", never saved agenda
blocks. Checked input shows counts and named blockers; missing estimates adds
task-detail estimate actions; unavailable sources show uncertainty and existing
source-settings actions.

No measured remaining-effort claim for active/partially worked tasks. Estimates
are whole-task estimates until an explicit remaining-effort model exists. No
single overloaded/not-overloaded badge for unknown estimates, unrelated backlog,
missed blocks or incomplete calendars.

Read-only capacity is the first implementation plan. Fix the existing duration-fit
answer to use actual placement constraints in that tranche. Do not redesign every
Ask intent or build recovery/commercial state at the same time.

Missing-estimate actions must actually save a manual estimate through the existing
owner-checked PATCH/undo path. Opening current detail alone is insufficient.
Limit this editor to open unscheduled local tasks in the first tranche. Save
refreshes the snapshot, failure retains input, and no model call occurs.
The initial duration probe supports explicit whole-rest-of-today requests only.
Tomorrow, week, explicit future date, narrower window or unclear horizon must
clarify rather than accidentally answer for today. Candidate fit is a standalone
session check, not a promise to outrank all unscheduled deadline work.

## Recovery and weekly value require their own contracts

Recovery preview selects owner-owned open local task blocks that were missed.
Pinning alone currently affects ranking, so preserving pinned blocks is a new
explicit preview rule. Fixed local events and all remote commitments are immutable.
Show old/new times and remaining unplaced work before the explicit apply action.

Apply must reread selected items, hours and fresh provider constraints. Compare the
preview's expected item/hours values, recompute the proposed plan and reject a
changed result with a conflict response. Apply no stale or partial plan unless
the refreshed preview explicitly says so. Record every previous slot in one
transaction so one undo restores the batch. Undo must have a defined conflict
policy before concurrent recovery ships. This is a follow-up specification, not
authorization to add a recovery endpoint today.

Free basic recovery means existing manual per-item edits/rescheduling and undo.
Proposed Plus coordination means a reviewed multi-task preview/apply with one
atomic batch undo. Source failures, deadline warnings and manual correction remain
Free. Do not disable existing manual rescheduling to create a paid distinction.

| Journey                | Entry and primary action                                        | Cancel/return                                   | Receipt                                                |
| ---------------------- | --------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------ |
| Capture/clarify        | Existing Form or Ask; submit, answer missing-estimate question  | Preserve draft; return to same composer         | Saved items and existing undo                          |
| Plan/explain           | Home rest-of-day summary or deterministic Ask; inspect blockers | Remain on Home/Ask; no changes to cancel        | Read-only sampled facts, candidates explicitly unsaved |
| Recover, deferred      | Home missed-block entry; preview then explicit apply            | Dismiss to launch control with no mutation      | Changed local blocks, unplaced work and one undo       |
| Review/reuse, deferred | Home weekly entry; review, then choose routine capture          | Return to Home; no automatic recurring creation | Review is read-only; reuse returns created batch/undo  |

Do not render working entry controls for deferred workflows before implementation.

Weekly review labels retrospective completed work over the previous seven local
dates ending at `at`, separately from the upcoming seven local dates starting
today. Each query has explicit timezone-aware boundaries, not aggregate all-time
counts. Show completed work, unfinished work, upcoming fixed commitments, deadline
risks and uncertainty. No fabricated time saved or streak penalty. A reusable
routine starts as explicit user-selected batch capture with relative dates resolved
in the owner's timezone; it is not background recurrence. Persistence and duplicate
submission behavior need a reviewed design before this feature is implemented.

## Commercial and AI boundaries

Owner clarification, 2026-10-01: Cooper supplies the Gemini and Groq keys. Included
AI replaces BYOK entirely in the target product. No API-key field, provider selector
or user-key setup remains in Settings or onboarding. Runtime removal accompanies
the verified accounting/provider cutover. The concrete schema, approved on 2026-10-01, is in the
[accounting design](2026-10-01-included-ai-accounting-design.md).

Free keeps manual capture, deterministic answers, ranking, safe local scheduling,
basic recovery, source warnings, undo and data access. Plus can add guided weekly
planning, coordinated recovery and reusable routines when those work. Candidate
pricing remains $8/month with proposed 20/300 assisted actions per UTC calendar
month. Neither the price nor allowances are an active offer. Annual billing waits.

Funded keys remain server-side. An AI answer remains text and never changes planning
data. Service accounting is the permitted exception to the phrase "answers write
nothing": the service may create and settle usage records, but it cannot write an
`Item`, planning setting or `Change` row on the answer path. A model-proposed mutation
still uses the existing `app.py` writer after validation, in a separate idempotent
mutation step.

Admission must run in one database transaction and lock the owner's allowance row
plus the active spend-envelope row. It verifies entitlement, the UTC allowance
period, a client-supplied logical request id, allowance remaining and provider/global
cash headroom. It then inserts or returns one unique logical request receipt and
creates a pending allowance reservation plus a pending maximum-cost reservation for
the first attempt before any provider call leaves the process. The unique keys are
`(owner_id, logical_request_id)` for the request and `(request_id, attempt_no)` for
attempts. Concurrent duplicates return the existing receipt or an in-progress
response. They never create a second reservation, provider call or mutation.

One useful completed logical request consumes one allowance unit. Each primary,
repair, tool and fallback attempt has its own cost reservation under one shared
four-call ceiling. On a measured provider response, settle that attempt to actual
usage and release only the unused cost reserve. On a definite pre-dispatch failure,
release both pending reserves. On timeout, worker crash or ambiguous transport
failure, retain the cost reservation as `uncertain`; do not redispatch that attempt
or release its reserve until
provider evidence or a reviewed reconciliation action resolves it. A live-worker
eligible fallback reserves separately while retaining uncertain primary cost;
crashed requests have no automatic takeover. An allowance
reservation may settle to consumed after a useful response, or release only when the
request definitely produced no useful response. Expired pending requests are not
blindly freed by age.

For mutations, store a mutation receipt keyed to the logical request before execution.
The transaction that changes planning data also marks that mutation receipt committed
and stores the existing committed-state response. A retry returns that receipt.
There is no provider fallback or replay after the mutation transaction starts. This
is an activation contract, not implemented protection. Its accounting tables were
approved on 2026-10-01; migrations and implementation remain ahead. Never build it
as unlocked JSON counters in `Setting`.

```text
Verified owner -> rules/manual ------------------------> existing writer or answer
              -> admitted request + cost reservation -> Gemini
                                                        | eligible outage only
                                                        v
                                                       Groq
              -> validate -> read-only answer -> response receipt
                         -> proposed mutation -> existing writer + mutation receipt
              -> settle allowance/cost or retain uncertain reservations
```

One shared four-call ceiling and monotonic model deadline cover the whole chain.
Provider refusal, invalid credentials, ambiguity, invalid action or Cooper budget
exhaustion never trigger an availability fallback. No failover after a mutation.
Parsing and read-only tool turns use separate Groq request formats because its
[structured output mode does not support tool use](https://console.groq.com/docs/structured-outputs).

Required schema responsibilities, accounting schema approved but not migrated: owner entitlement and
allowance period; spend envelopes; logical request receipts; per-attempt cost
reservations with `pending | settled | uncertain | released`; mutation receipts; and
unique verified billing event identities. Activation tests must cover two concurrent
requests with one logical id, two different requests racing for the last allowance
unit, a crash after reservation, a timeout with unknown provider cost, a crash after
planning commit but before HTTP response, fallback after an eligible pre-mutation
failure, and refusal of fallback after mutation starts. Signed webhooks, deduplicated
events, server entitlements, approved cash envelopes and provider sandbox lifecycle
acceptance precede checkout. Browser tier flags confer no rights. Deletion/export and
no data loss on downgrade are launch requirements.

An adult persona does not satisfy provider eligibility by itself.
[Gemini's terms restrict under-18 API-client access](https://ai.google.dev/gemini-api/terms).
Review eligibility, supported regions and paid data handling before a funded pilot.
Disclose both providers and enable verified Groq data controls; do not promise
product-wide zero retention. Preserve own-words-only prompts and sanitization.

## GCP without a big-bang rewrite

Keep Firebase Hosting/Auth and PostgreSQL first; move only the API after measuring
cold/warm host, DB, calendar and model timings. Keep encryption keys, owner IDs and
local-only writes unchanged. Stage against an isolated restored copy, not a second
watcher operating on production. API cutover and database relocation are separate.

Initial Cloud Run sizing remains a test candidate: request billing, minimum zero,
maximum one, 1 vCPU, 512 MiB and concurrency eight. These are not proven sizing or
an always-warm promise. Free allowances are shared by billing account and other
services/egress cost separately. [Cloud Run pricing](https://cloud.google.com/run/pricing).
Alerts-only budgets do not stop spend; optional preview caps have separate tradeoffs.
Neither Cloud Run settings nor a GCP cap control Groq's bill.
[Google budget controls](https://docs.cloud.google.com/billing/docs/how-to/budgets).

The in-process Gmail timer is incompatible with relying on scale-to-zero execution.
If retained, replace it with one authenticated fixed scheduled trigger and disable
the old loop. This is a deliberate topology decision, not a second consumer or a
new background framework. No timer-dependent launch until missed-cadence reporting
and cutover are tested. Keep Render as rollback until fresh connected acceptance.

## Release order and falsification

1. Close current trust/UI acceptance gates. Build today's capacity and true
   duration-fit checks without new schema, AI, hosting or dependencies.
2. Observe five consenting adults planning and recovering over a week. Candidate
   target: three return on three days and replace a prior planning routine. Record
   behavior, not invented testimonials. This sample is directional, not market proof.
3. Specify and test recovery, then weekly review. If users mainly need collaboration
   or refuse estimates, revisit the target job before adding more integrations.
4. Measure latency and stage GCP independently. No promise that migration cures
   provider/model latency. Restore, ownership, callbacks and rollback are gates.
5. Approve commercial schema and separate AI/infra envelopes; implement reservations,
   evaluate both models, then enable a bounded funded pilot. Manual stays usable.
6. Test willingness to pay once repeated value exists. Choose an eligible merchant,
   lifecycle and policies; only then offer Plus checkout and verified launch FAQs.

Demand validation and infrastructure measurement can run alongside core work.
Recovery depends on feasibility; funded AI depends on accounting; paid launch
depends on both delivered value and commercial acceptance. No native mobile phase.

Review evidence and unresolved launch decisions are in the
[review record](../../designs/cooper-web-first-review.md). The first executable
tranche is the [capacity plan](../plans/2026-09-30-cooper-today-capacity.md).
