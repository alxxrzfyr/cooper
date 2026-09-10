# Cooper calendar core: CEO review

Date: 2026-09-10
Mode: HOLD SCOPE
Status: DONE_WITH_CONCERNS. Review complete; implementation and live acceptance remain undone.
Input: docs/superpowers/specs/2026-09-10-cooper-calendar-core-design.md
Baseline: 807b2e9 on main, following application commit 3873a64.

## Decision authority

The user approved the repair approach, the written specification, and Hold scope.
They subsequently asked the reviewer to resolve routine details without further
questions because the repeated decisions were overwhelming. This review follows
that explicit instruction instead of the skill's per-finding question ceremony.
There are no new integrations, external mutations, or speculative features added.
The following decisions use that delegated judgment; they are not individually
attributed to the user. No application source was changed during this review.

## System audit and premise

The problem is inconsistent behavior across capture, placement, providers, and
responses. A new AI agent architecture would not fix time-window construction or
provider errors being treated as empty calendars. Keep the existing single writer,
pure planner, provider readers, and shared action validation.

Reviewed recent 30 commits, branch diff, stash list, relevant source/tests, AGENTS,
PRD, architecture, and approved design. There are four pre-existing frontend edits
in App, Chat, tests, and theme; preserve them. No stashes or existing TODOS.md were
reported. GitHub is the remote; gh is unavailable, so open PR state was not verified.
Base is main, verified through origin/main. Brain cache was unavailable; current
conversation and source supplied the decisions. Earlier activation work is separate.
Repeated calendar detail fixes in history justify explicit rendered verification.

Alternatives already considered and approved in conversation:

| Approach | Coverage of approved goal | Human / agent-assisted estimate | Risk and reuse |
|---|---|---|---|
| Individual symptom patches | 4/10 | 1–2 days / 2–4 hours | Small diff, but inconsistent paths remain; reuses existing functions |
| Repair complete existing flow, selected | 10/10 planned | 4–7 days / 1–2 focused days | Medium integration risk; retains writer, planner, readers, UI |
| Rebuild around all desired integrations | Beyond repair scope | Weeks / several days plus account setup | High uncertainty and delay; less reuse, unnecessary today |

Estimates are planning ranges, not promises; account availability and live QA are
not accelerated by code generation. No scope expansion was accepted.

Landscape check: timeboxing and availability settings are established patterns.
Sunsama documents calendar imports and remote timeboxing; Motion documents scheduling
from duration, deadlines, and hours; Reclaim supports different hour windows. Cooper
should reuse these understandable concepts without adopting their external-write
or outside-hours policies. Its differentiator here is a clear local destination.
Sources: https://help.sunsama.com/docs/integrations/calendar/ ;
https://www.usemotion.com/help/time-management/auto-scheduling/auto-scheduling-how-to-guide ;
https://help.reclaim.ai/en/articles/3600766-set-your-working-meeting-personal-custom-hours

Dream state: unreliable receipts and unclear availability -> verified local capture,
explicit source health and exact placement -> a dependable daily view that can later
accept school assignments without changing scheduling rules.

## 1. Architecture

Findings A1–A3; decisions resolved within approved scope.

A1. Legacy Google copies: match only the same owner's saved Google event identifier
within the configured calendar. Combine display only when start, end, title, and
comparable user-authored details agree; keep provider detail accessible. Otherwise
show both with a difference notice. Orphaned copies remain visible as Google events.
Their actual external intervals remain busy. Never deduplicate by title alone and
never delete a remote copy. Existing code exposes google_event_id and provider mine,
but mine alone cannot establish that the local copy still exists or matches.

A2. One complete availability result must serve automatic placement, plan previews,
plan application, and AI availability answers. Carry provider state, checked range,
and checked time with intervals. app.py currently has separate sources.busy_windows,
execute_tool availability, and _busy_time_context paths; the latter two truncate
interval lists to 200 and 32. Merge overlapping intervals before model serialization;
if a bound still omits information, mark the response incomplete and make no free-slot
claim. Display ranges and scheduling ranges may differ but must not imply equal coverage.

A3. Local placement needs final owner-scoped validation and serialized commit. Two
requests must not both reserve the same free interval. Use SQLAlchemy transaction
semantics and an existing per-owner setting row as a serialization anchor where the
database supports row locking; a process-local lock alone is insufficient for hosted
workers. Engineering planning must prove the SQLite and Postgres behavior before code
is called ready. Do not add a queue, table, or background process for this.

```
BEFORE: capture -> local writer -> Google writer
        view / planner / AI -> separate calendar reads
AFTER:
Prompt -> proposal -> shared validation --+-> local capture + undo
Form -----------------------------------+           |
Google / iCloud -> complete read + health ----------+|
Settings -> validated local windows ----------------+-> pure planner
                                                     -> final owner check/commit
                                                     -> receipt and day view
```

```
Missing source: disconnected -> local scheduling allowed
Empty source: successful full read -> zero external busy intervals
Error/partial source: saved task -> waiting for source -> no automatic slot
Valid source: complete intervals -> available window -> exact local slot
```

The database is the local single point of failure; failure must roll back the affected
transaction. A provider outage limits placement but not capture. There is no new service.
At 10x traffic, repeated provider reads dominate; at 100x, provider quotas and serialized
owner operations dominate. This personal app does not require new infrastructure for
those hypothetical loads. Owner checks apply to every settings and item operation.

## 2. Error and rescue map

Findings E1–E3: raw provider errors, hidden failure states, and mutation receipts can
mislead. Resolve with safe error categories and structured outcomes, not generic success.
Existing CalendarError remains the provider boundary; do not invent many exception
classes where a result state is sufficient. Domain outcomes below are not exceptions.

| Path | Trigger / actual exception | Current handling | Required handling and user result |
|---|---|---|---|
| Google _send | HTTPError, including 401/403/429/5xx | CalendarError includes response body | Safe reconnect/rate-limit/unavailable category; never expose body |
| Google _send | URLError, TimeoutError | CalendarError | Failed source; save task, do not place; bounded retry on user action |
| Google _send / normalization | JSONDecodeError; wrong object/invalid event fields | Some malformed data becomes empty/skipped | Mark incomplete read unless a known non-event case; no free-time inference |
| iCloud events | CalDAV/network failures | catch Exception -> CalendarError | Retain protective boundary, identify installed library exceptions in engineering review; safe failure state |
| Window construction | ValueError, ZoneInfoNotFoundError | end=24 can reach invalid time | Validate settings; construct next-day boundary; reject invalid timezone without replacing saved settings |
| API input | Pydantic ValidationError | request rejection | 422 with field guidance; no partial settings save |
| Brain.read | JSONDecodeError; transport/SDK errors | repair then broad fallback | Deterministic recognized commands may work; failed uncertain AI interpretation asks instead of executing guessed add |
| AI output | empty/refusal/invalid action, domain outcome | May fall back | Distinct no-write receipt; never claim model success |
| Proposed plan | incomplete source/no fit/missing duration, domain outcome | Empty plan or generic explanation | Explicit reason per item; no new mutation |
| Final placement | stale local schedule/settings, domain outcome | No complete reservation check shown | Recompute under owner serialization; if no fit, saved task stays waiting |
| DB save/undo | SQLAlchemy OperationalError, IntegrityError | session rollback | Failed save: no success; known capture already committed: saved but placement unavailable |
| Browser refresh | fetch failure/AbortError/non-JSON response | Needs targeted verification | Retain known committed receipt; reload state, never auto-resubmit creation |

The map covers all changed logical paths. Exact CalDAV exception mapping is a named
engineering concern, not an assertion of verified handling. No raw prompts, tokens,
calendar details, addresses, email bodies or message IDs go to logs. A broad catch is
acceptable only as the final provider isolation boundary with a visible failure;
remove catches that silently turn bugs into empty successful results.

## 3. Security

Findings S1–S2. Existing owner-scoped data and encrypted credentials remain intact.
No auth, scopes, secret storage, dependencies, or hosting changes are authorized here.

S1. app.execute_tool GmailArgs can refresh the watcher from a supposedly read-only
AI answer; it also returns imported titles. Remove that tool from the AI answer tool
set for this repair. Calendar questions use content-free occupancy, and only the
user's own item titles enter the model. The existing separate watcher is not removed.
Risk: medium likelihood of unintended local mutation, high trust/privacy impact.

S2. Validate settings arrays, bounds, integer types, timezone, and item IDs at the
boundary. Ignore no unknown fields silently. Keep owner identity server-derived.
Risk: medium likelihood, high cross-owner impact if checks are omitted. Test user A
cannot retry, edit, undo, or serialize user B's tasks/settings. Render provider text
as text, never raw HTML; credentials never enter tool results. Keep undo rather than
adding a new audit ledger. Secret-safe operation codes are sufficient diagnostics.

## 4. Data flow and interaction cases

Findings I1–I4 resolved by the following rules.

I1. One task means one exact continuous session in this repair. No clipping or automatic
splitting. A 120-minute task needs 120 minutes. If no slot fits before its due time,
leave it waiting. An already overdue task remains overdue and unscheduled until the
user changes its deadline or explicitly assigns a time. No automatic deadline change.

I2. Ordered batches validate every step before saving and retain a single undo. If an
earlier step cannot be placed, later steps are saved but wait for that earlier step;
do not schedule them ahead. Do not drop invalid or untitled parts silently. This is
ordering within the current batch, not a new persistent dependency system.

I3. Recovery is an explicit Retry scheduling action on the existing waiting item.
It rechecks providers and current settings, then reserves time once. Refresh alone
does not rearrange the day. An already scheduled retry is a no-op. Creation timeouts
must not be automatically retried: reload items and show uncertain outcome if no
confirmed receipt is available. This avoids a new request ledger.

I4. Missing end/duration for a fixed appointment asks for duration instead of silently
inventing one hour. Explicit start+duration or start+end is sufficient. A user-specified
appointment time is preserved even outside task hours, with known overlap warnings;
when source checking fails, say conflicts could not be checked.

```
Input -> validation -> capture commit -> complete availability -> plan -> final check -> slot commit
 nil/empty: ask          DB failure       source failure        no fit   changed state
 wrong type: 422         no success       saved/waiting         waiting recompute once
                                                    output -> truthful receipt -> screen refresh
                                                                 refresh failure: preserve receipt
```

| Interaction | Required outcome |
|---|---|
| Double submit | Disable in-flight UI submit; do not automatically replay creation |
| Two tabs schedule | Final owner serialization and revalidation prevent overlapping reservations |
| Navigate away | No second submission on return; reload persisted items |
| Save during rollout | Backward-compatible response fields; old inputs remain readable |
| Retry twice | Existing item ID; scheduled item is a no-op |
| Change settings mid-plan | Apply current settings during final validation |
| Empty availability | Save valid closed schedule; task waits with reason |
| Overnight/DST | Local window boundaries, UTC elapsed duration; count work on each occupied date |
| Partial source read | Incomplete health; no safe-slot claim |
| Imported move after booking | Show overlap after refresh; never silently move a fixed appointment |

## 5. Code quality

Findings Q1–Q2. Reuse one availability collector and one placement validator rather
than cloning logic across AI, Form, and MCP. Return explicit placement outcomes so
"no room" does not also mean "provider offline" or "duration missing".
Keep these small types in existing files. Do not introduce a service hierarchy.

The repair will likely touch more than eight files including existing UI/types/tests
and docs. That is justified by the same behavior crossing those boundaries, not a
reason to omit a route. Group work into the eight tasks below; no broad renaming.
Update AGENTS, PRD, architecture, and source comments that still require Google writes
or silent local scheduling on provider failure. Preserve current scoring weights and
explain deadline/age/duration plus pinning accurately; importance-based reranking is
outside this repair. New branching should reflect named outcomes, not nested catch-all
fallbacks. Existing App/Chat edits must be inspected and retained during implementation.

## 6. Tests

Finding TST1: existing tests include owner-specific remote deletion, broad question
recognition, scheduling, and undo. Passing them unchanged would certify old behavior.
Replace only assertions intentionally superseded; keep owner and undo guarantees.
No dedicated project AI-evaluation command was identified; use the existing parser
and HTTP suites plus a fixed prompt acceptance set. Do not claim a live Gemini eval
from mocked model output.

| New/changed flow | Happy-path test | Failure and boundary tests |
|---|---|---|
| Local-only writes, HTTP | Add/edit/complete/drop/batch/undo make zero provider writes | Linked legacy IDs do not trigger delete; owner mismatch rejected |
| Exact placement, pure | 5/20/90/120 minutes retained | No fit/deadline equality/overdue/empty windows/DST/cross-midnight |
| Availability, unit+HTTP | Empty successful source permits slot | Timeout, malformed item, second-page error, disconnected, >200 intervals |
| Settings, HTTP+browser | Save all-day/custom/overnight and reload | Invalid range/timezone/type; preserve legacy windows/caps |
| Retry/final commit, HTTP | Same item reserves one slot | Duplicate retry; two concurrent requests; settings change mid-request |
| AI, parser+HTTP | Task, appointment, question route correctly | Malformed JSON, refusal, no model, ambiguous reference, prompt-like title |
| Batch, HTTP | Ordered steps fit and undo once | First step too long or invalid; later steps remain waiting |
| Display, browser | Local/imported sources and deadlines distinguishable | Matching/divergent/orphan Google copy, failed refresh, mobile long text |

```
UX: capture / settings / waiting / retry / calendar details
Data: proposal / source health / windows / exact slot / result receipt
Async: provider reads and model calls, no new job
Integration: existing Google + iCloud readers; external writers forbidden
Errors: every row in section 2 -> one targeted regression where changed
```

Friday-night confidence test: a real prompted task appears at its exact local time,
Google/iCloud commitments block overlaps, Retry never duplicates it, and Undo removes
only the local item. Adversarial test: concurrent requests at midnight while a source
fails on page two. Chaos test: capture commits, response refresh fails, user returns
and retries placement. Freeze clocks in fixtures; isolate databases; do not make unit
suites depend on network or timing. Live Google/iCloud read-only checks and browser
checks are mandatory separate evidence before claiming the integrations fixed.

## 7. Performance

Finding P1. Current day view fetches a year of provider events, while placement fetches
a shorter range and batches repeat place_one. Avoid multiplying provider reads for
each task. Read once per planning operation; reuse within that operation and report
range completeness. Do not add a cross-request stale cache to accelerate safe placement.

The three likely slow paths are year-long calendar reads, sequential batch reads,
and the bounded AI tool loop. p99 is unmeasured and must not be invented. Measure
provider-call counts and end-to-end latency on representative fixtures, then live
accounts. A thousand intervals must be processed without silently clipping them.
Owner indexes already exist; no new table or query index is justified by this review.
Network I/O must happen before the short reservation transaction. No connection pool
or background worker expansion is proposed.

## 8. Observability and recovery

Finding O1. Use existing Settings and item responses to show source state and checked
range/time, plus item-specific waiting reasons. No new dashboard or analytics vendor.
Safe diagnostic events contain operation type, result category, source name, elapsed
milliseconds, and opaque correlation ID, never payload contents or provider bodies.

Useful acceptance counts are saved, placed, waiting-by-reason, failed reads and external
write attempts (must be zero for item actions). Derive these in tests and safe request
logs; no metrics service. A reported bug can be traced to a safe operation result but
logs intentionally cannot reconstruct private prompts. Reproduce with a synthetic
example instead. Runbook: unavailable -> reconnect/refresh -> retry existing task;
invalid settings -> correct field; capture receipt missing -> reload, not resubmit.

## 9. Deployment and rollback

Findings D1–D2. No schema migration is required by the product shape. Use a versioned
settings payload under existing settings storage and preserve a legacy-compatible copy.
Keep existing hours/caps on upgrade. New task-hour limit defaults to unlimited within
allowed windows until configured; retain 10-minute break and 15-minute lead defaults.
Existing count cap remains configurable. Midnight counts toward the actual local date.

```
Verify no-write backend baseline -> deploy compatible reader/backend
 -> deploy Settings and receipt UI -> enable new availability schema
 -> no-account smoke -> connected read-only smoke -> monitor safe failures
```

D1. New backend accepts old settings input. Old UI must not silently overwrite rich
windows; detect a legacy write against rich settings and return a reload/update message.
D2. Rollback must target the no-external-write compatibility baseline, not today's
backend. Retain rich settings and the legacy copy; never delete data to roll back.

```
Regression? -> pause new placement -> preserve capture/data
 -> restore compatible no-write build -> verify old+new settings readable
 -> verify zero remote writes -> resume placement after smoke checks
```

First five minutes: health/auth, local save, no writes, all-day setting, waiting receipt.
First hour: live imported move/cancellation, failure/recovery, overnight placement,
mobile/desktop view. Hosted environment changes and deployment are not performed by
this review. Exact release commands and rollback build ID belong to the engineering
plan; expected rollback duration is unmeasured until a staging rehearsal.

## 10. Long-term trajectory

Finding L1. This repair must have one documented product contract. School assignments
can later enter as source-linked tasks with deadlines, but no placeholders or pretend
connections should appear now. Keep unsupported integrations out of success claims.

Reversibility: 4/5 for local code/settings, with the deliberate condition that rollback
never restores remote writes. Debt retained: single-session task model, no automatic
rescheduling of existing work, provider freshness only at the check time. These are
explicit constraints rather than silent guarantees. An external event can change just
after a read; Cooper can detect the overlap on refresh, not promise omniscience.
No rewrite, distributed system, AI reranker, or new subscription is needed.

## 11. Design and UX

Findings U1–U2. Preserve the existing desktop and stacked mobile aesthetic. Add clear
source labels, waiting reasons, and Retry scheduling inside existing views. A stored
Google ID must no longer be labeled as proof the current local version is synced:
Row.tsx and Frame.tsx currently use that ID to label the item as Google-backed.
Do not hide provider detail, attendee text, or metadata to simplify the calendar.

| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Capture | Existing three-stage loader | Prompt guidance | Safe no-save result | Actual item/time | Saved, placement waiting |
| Calendar | Refresh indicator | No commitments in range | Source unavailable | Source-tagged entries | Stale/missing source label |
| Settings | Save pending | Closed availability | Inline field error | Saved windows | Legacy reload guidance |
| Retry | Disabled while pending | Missing duration reason | Source/no-fit reason | Same item scheduled | Batch earlier-step waiting |

```
Prompt/Form -> actual receipt -> day/calendar
                   | waiting       | open details
                   v               v
              reason + Retry   local or source-backed item
Settings -> valid windows -> future placements use them
```

Keyboard focus stays on actionable feedback; loading/result changes are announced
accessibly. Controls have labels, adequate touch targets, and readable contrast.
Green remains done and red remains gone; warnings use neutral/orange treatment.
No new modal approval flow. Browser design review is required after implementation,
including all-day windows and overnight controls on narrow screens.

## Failure modes registry

All rows are implementation acceptance requirements, not tests claimed to pass now.
A listed planned rescue closes a design omission; it does not fix current code.

| Path | Failure | Planned rescue | Planned test | User sees | Safe log |
|---|---|---|---|---|---|
| Capture | invalid proposal | ask, no mutation | parser+HTTP | clarification | result code |
| Model | transport/refusal/empty | no guessed write | fixtures | unavailable/clarification | category |
| Calendar | failed/partial read | pause placement | unit+HTTP | waiting source | source/category |
| Planner | no duration/no fit/deadline | retain waiting task | pure+HTTP | exact reason | outcome |
| Settings | invalid/legacy conflict | preserve prior value | HTTP | field/reload message | category |
| Placement | concurrent reservation | serialize/revalidate | HTTP concurrency | slot or waiting | outcome |
| Receipt | refresh after commit fails | retain committed result | browser+HTTP | saved, refresh failed | correlation |
| Batch | earlier step cannot fit | later steps wait | HTTP | ordered waiting | counts |
| Legacy copies | divergence/orphan | show real external entry | browser+unit | difference/source | no content |
| Undo | database error | transaction rollback | HTTP | undo failed | category |
| Release | old backend restored | no-write baseline | staging smoke | capture retained | build/result |

No unaddressed silent failure is accepted by the plan. Current implementation gaps
remain blockers until proved fixed. Engineering concerns are transaction portability,
exact provider exceptions, and compatible release/rollback rehearsal. Live acceptance
is pending access; the review did not access credentials or mutate external calendars.

## Implementation Tasks

Synthesized from the review. Estimates exclude live-account waiting time.

- [ ] **T1 (P1, human: 4h / agent: 1h)** — app/google — Remove every external item-write path and preserve legacy copies; update MCP receipts. Verify all mutation routes and undo with forbidden provider writers.
- [ ] **T2 (P1, human: 8h / agent: 2h)** — sources/app/providers — Share complete availability and safe source health; no hidden/truncated free-time claims. Verify empty, failed, malformed, partial-page and dense reads.
- [ ] **T3 (P1, human: 8h / agent: 2h)** — planner/app/settings UI — Implement validated all-day, weekday and overnight windows with compatible settings. Verify midnight, DST, invalid payload and upgrade behavior.
- [ ] **T4 (P1, human: 8h / agent: 2h)** — planner/app — Preserve duration/deadline, workload, breaks and batch order; serialize final placement. Verify exact durations, concurrent requests, retries and no-fit outcomes.
- [ ] **T5 (P1, human: 6h / agent: 2h)** — brain/app/mcp — Keep questions read-only and uncertain model output non-mutating; ask for missing appointment duration. Verify fixed prompt set, model failures and no Gmail-refresh tool on answer path.
- [ ] **T6 (P1, human: 6h / agent: 2h)** — frontend API/types/calendar/details — Show truthful receipts, waiting retry, source health and legacy-copy differences. Verify failure after save, old-copy states, keyboard and mobile.
- [ ] **T7 (P1, human: 4h / agent: 1h)** — docs/config compatibility — Align AGENTS/PRD/architecture and prepare no-write rollback baseline. Verify settings compatibility, zero external writes and unchanged secret/hosting configuration.
- [ ] **T8 (P1, human: 6h / agent: 2h)** — existing tests/browser/live readers — Run regressions, full relevant checks and read-only provider acceptance. Record fixture versus live evidence, timings and any unavailable checks.

Each task maps respectively to A1/E1, A2/E1/P1, E2/D1, A3/I1–I3,
S1/I4, U1–U2/E3, Q2/D2/L1, and TST1/O1. Existing tests are the baseline;
no implementation acceptance is complete merely because this document exists.

## Deferred work and not in scope

Teams/Classroom integration planning is tracked in TODOS.md, after this repair.
Luma/Meetup, remote item writes, automatic task splitting, new dashboards, broad
reranking and full UI redesign are excluded. Existing watcher behavior is preserved
outside removal from the supposedly read-only answer path. No scope proposals added.

## Completion summary

All eleven sections evaluated: architecture 3 findings; errors 3; security 2;
data/interaction 4; quality 2; tests 1; performance 1; observability 1; deployment 2;
trajectory 1; UX 2. These are 22 grouped findings with overlapping implementation tasks.
Error registry: 12 rows. Failure registry: 11 rows. Eight implementation tasks.
Diagrams cover architecture, source states, data flow, UI, deployment and rollback.
Stale diagrams: ARCHITECTURE.md's Google-write tail must change; source comments and
spec state diagram must reflect complete source health. No code diagrams changed yet.
Machine-readable task export: skipped because jq is not installed; install jq before
using autoplan aggregation. The eight tasks are fully recorded above.
Outside voice: not run; this is a primary-agent review, not independent consensus.
Operational learning review: relevant findings are recorded in this report; no memory
files updated because the user did not request memory changes.

Verdict: The approved product direction is sound and complete enough for engineering
planning. It is not ready to claim fixed or ship. No additional product decisions are
required from the user. Engineering review and implemented tests remain required.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs for this repair | Status | Findings |
|---|---|---|---|---|---|
| CEO | /gstack-ceo | Approved repair consistency | 1 | DONE_WITH_CONCERNS | 22 grouped findings, 8 tasks; routine decisions resolved |
| Engineering | Next step | Transactions, provider errors, rollout | 0 | REQUIRED | Must verify implementation feasibility and checks |
| Design | After implementation | Existing UI behavior | 0 | PENDING | Desktop/mobile/source states need rendered verification |
| Independent review | Optional | Second opinion | 0 | NOT RUN | No independent consensus claimed |

**VERDICT:** CEO review complete; engineering review required. Application fixes and live validation pending.
NO UNRESOLVED DECISIONS
