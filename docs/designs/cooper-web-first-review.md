# Cooper web-first review record

Date: 2026-09-30. Scope: product/specification review and documentation only.
No runtime implementation, deployment, live provider acceptance or Git delivery.

The owner approved one web-first Cooper product, no native mobile development,
funded Gemini with Groq fallback, and automatic self-grilling of routine choices.
New recommendations remain draft until final owner approval.

Reviewed output: [web-first design](../superpowers/specs/2026-09-30-cooper-web-first-product-design.md).
Code grounding: `planner.build_planning_snapshot`, `rank`, `place`, `_windows`,
`app.today_view`, `answer_planning_intent`, `plan_tasks`, `apply_slots`,
`Home.tsx`, `types.ts`, README and package commands. Existing work is preserved.

## Method and limitations

Brainstorming considered minimal capture, cohesive planning/recovery and a broad
suite. Gstack autoplan sequences CEO, design, engineering and contributor DX
reviews. Reviewer agents inherit the main model; they are independent reads, not
cross-model consensus. Claude CLI is unavailable. Codex authentication preflight
passed, but its ephemeral read-only review failed before initialization because
the in-process server required a write on a read-only filesystem. No external CLI
or cross-model review is claimed. No permission bypass was attempted.

The installed `grill-me` skill delegates to an unavailable `/grilling` command.
The adversarial questions below are the direct fallback, not a completed skill
interview. Missing packaged review-section/DX exemplar files are replaced by the
complete inline review instructions. The design/mockup binary is unavailable;
wireframes and state contracts replace mockups, not browser visual acceptance.

Git metadata is read-only and review metadata directories are outside the writable
workspace. Evidence is kept here instead of committing checkpoints or relying on
external gstack logs. No new dependencies or skill installations.

## Phase 1: CEO review

Independent reviewer: Bernoulli. Read-only review of proposal, PRD and actual
planning implementation. Main reviewed the separate web-first contracts.

| Finding                                                   | Severity            | Evidence                                                                | Disposition                                                               |
| --------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Today occupancy and all-open effort have different scopes | High                | `planner.py`, snapshot day bounds versus `remaining_effort_minutes`     | Disjoint today/overdue/backlog cohorts; no global-to-daily comparison     |
| Gap minutes can falsely claim a task fits                 | High                | `app.py`, `fit_duration` compares a scalar; `place` checks daily limits | Duration-fit must use a real read-only placement probe                    |
| Estimated effort is not measured remaining effort         | High                | No partial-progress model in Item or task states                        | Label whole-task estimates; recovery separate                             |
| More AI credits alone do not validate Plus                | High                | Proposed paid distinction lacks customer evidence                       | Weekly recovery/routines are the paid hypothesis; test return and renewal |
| Funded AI and migration have unresolved activation gates  | Critical for launch | No durable accounting/approved budget; restore/cutover evidence absent  | Keep disabled; capacity plan independent                                  |

The reviewer reported an isolated probe where a 30-minute fit answer accepted a
10-minute daily cap while `place()` rejected it. This is independent diagnostic
evidence, not a new HTTP or live acceptance pass by the main agent. It adds a
specific regression requirement to the first plan.

| CEO section            | Reviewed decision                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| Architecture           | One snapshot, pure scheduler, one writer; four workflows not four services               |
| Errors and resilience  | Distinct source failure, unknown estimate, no slot, stale preview and budget states      |
| Security/privacy       | Owner checked at all boundaries; sanitized own words only; no model write tools          |
| Data/interaction edges | Local-day/DST/lead/break/daily-limit semantics; duplicate requests and old previews      |
| Code quality           | Extend existing functions narrowly; preserve unrelated dirty changes; no wholesale split |
| Tests                  | Snapshot, placement, answer, HTTP, visible UX and semantic AI evidence kept separate     |
| Performance            | Reuse provider reads in a request; benchmark scheduler and sequential external calls     |
| Observability          | Counts, outcome categories and timings; no prompts, titles, email IDs or secrets         |
| Deployment/recovery    | Additive API fields; isolated restore; reversible API cutover, no DB move bundled        |
| Future scope           | Weekly/recovery schema contracts separate; no native/mobile/app suite                    |
| Design                 | First local plan before connections; reachable content at zoom; no paywalled safety      |

### Self-grill and decision audit

| Challenge                                                    | Answer and resulting constraint                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Why pay when a calendar and list are free?                   | Only repeated planning/recovery value can justify renewal. Do not launch Plus on allowance alone.           |
| What if users never estimate durations?                      | Unknown stays unknown. Test whether clarification is tolerable; reconsider audience if not.                 |
| Isn't four-agent branding just four chatbots?                | Keep four bounded workflows inside existing navigation/backend. No agent picker or new autonomous services. |
| Can we promise fast and always free hosting?                 | No. Scale-to-zero permits cold starts; warm capacity needs an approved budget. Measure first.               |
| What stops a free account from spending our cash?            | Atomic admission, durable reservations and global budget. No funded enablement before these exist.          |
| Can a failed calendar be ignored to improve UX?              | No. Capture continues; safe placement waits. AI cannot invent free time.                                    |
| Does a preview make bulk mutation safe?                      | Only if the writer rechecks ownership, items, hours and fresh busy intervals, then records one atomic undo. |
| Should mobile or more integrations make it feel bigger?      | No. Complete one web planning loop first. Browser-responsive is not native development.                     |
| Do five enthusiastic testers prove $8 pricing?               | No. A small usability cohort finds failures; purchase and renewal require separate evidence.                |
| Can we auto-decide merchant country, limits and legal terms? | No. Those require real owner/business/provider facts; keep explicit activation gates.                       |

Owner-confirmed boundaries are recorded above. Recommendations self-selected in
this pass: cohesive backend, today's capacity first, monthly-only offer candidate,
manual core without model quota, progressive connection setup, and separate
commercial/migration plans. No budget, demand, legal eligibility or schema approval
was invented.

## Phase 2: design review

The failure/rescue registry used across the reviews:

| Category                          | Boundary/rescue                                          | User result                                     | Required proof                         |
| --------------------------------- | -------------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| Source transport/auth failure     | Existing adapter reports unavailable                     | Capture retained; safe placement waits          | Mock API and connected acceptance      |
| Unknown estimate                  | Pure assessment retains ID, excludes guessed effort      | Estimate action and partial facts               | Snapshot plus actual save test         |
| No slot under ranking             | `place()` returns no candidate, not an exception         | Named unplaced item; no impossibility guarantee | Fragmentation/caps/lead/break tests    |
| Ambiguous or invalid action       | Existing validation/409, never best guess                | Conversation clarifies                          | Parser and HTTP negative paths         |
| Stale recovery preview            | Future writer rereads/recomputes, rejects changed result | Refreshed preview; no silent partial apply      | Concurrent item/hours/source tests     |
| AI timeout/429/5xx                | Typed availability outcome; one budgeted switch          | Rules/manual or accurate outage                 | Transport and whole-chain budget tests |
| AI refusal/401/403/schema failure | No automatic switch, distinct outcome                    | No false success or raw vendor body             | Adapter/semantic/privacy cases         |
| Budget exhausted                  | Atomic admission before dispatch                         | Core still works, reset/limit shown             | Two-worker/rollover/restart tests      |
| Late/duplicate AI result          | Unique logical identity and receipt                      | No duplicate charge or mutation                 | Replay/race/crash-window cases         |
| Forged/replayed billing event     | Signature, unique event and authoritative lifecycle      | No browser-granted tier                         | Chosen merchant sandbox acceptance     |
| DB outage                         | Sanitized API failure; health fails                      | No success receipt; draft retained              | HTTP outage and isolated restore       |
| Gmail cadence stops               | Freshness and one producer                               | Visible missed checks                           | Trigger auth/cutover acceptance        |

Future rescues are specifications, not implemented safeguards. Unexpected
programming faults cannot become "nothing fits" or silent rule fallback. Record
request identity, outcome category, durations and counts, never content or secrets.

```text
Today: owner items + source facts -> one snapshot -> Home / Ask
Next:  same inputs -> pure placement simulation -> unsaved capacity facts
Later: explicit refreshed apply -> app.py transaction -> verified receipt + undo
AI:    admission/reservation -> bounded providers -> same answer or writer
```

Read-only success, validated mutation, partial placement and unknown/error have
separate UI/test contracts. Additive capacity fields permit independent API/UI
rollout; no schema migration in this tranche. Code rollback and GCP API-base
rollback are separate. Benchmark added simulation on 100/1,000-item fixtures
before latency claims. Do not refresh providers twice merely to calculate capacity.
Fresh read facts expire; the writer must reread constraints before applying.

Independent reviewer: Peirce. Subjective plan completeness 7/10 before corrections,
not a live quality score. No visual QA claimed.

| Finding                                          | Severity | Correction incorporated                                                                            |
| ------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------- |
| Today/overdue/unknown cohorts were ambiguous     | High     | Disjoint deadline boundaries; today's unknowns exclude backlog; source failure takes precedence    |
| Hypothetical slots could resemble booked work    | High     | Now/Next stays primary; timestamped rest-of-day summary; possible slots explicitly unsaved         |
| Workflow journeys and Free recovery unclear      | Medium   | Entry/action/return/receipt matrix; manual Free versus proposed batch Plus recovery                |
| Tall horizontal FAQ had no named vertical access | Medium   | Panel overflow, touch/keyboard/focus access, sizing refresh and longest-answer check               |
| Dynamic announcements/focus unspecified          | Medium   | Preserve refresh focus; polite receipt/error summary; preview dismissal returns focus              |
| Landing current versus future promises unclear   | High     | BYOK beta disclosure, proposed allowances, coming-soon paid/funded workflows and disabled purchase |

Seven design passes covered hierarchy, states, journeys, consistency, existing
tokens, responsive/a11y behavior and unresolved promises. Corrections address the
document findings; rendered resize/zoom geometry remains an implementation gate.

## Phase 3: engineering review

Independent reviewer: Beauvoir. Static code/specification review, not execution.

| Finding                                      | Severity          | Correction incorporated                                                                   |
| -------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------- |
| Estimate opened detail without an editor     | High              | Small manual editor using existing `api.edit`, refresh and undo; save/failure tests       |
| Tomorrow/week fit could use today's probe    | High              | Explicit whole-today guard and unsupported-horizon clarification with tests               |
| Fit regression only checked absence of "Yes" | High              | Concrete no-slot result, no candidate fact, `None` probe and positive exact-duration case |
| Class test snippets omitted `self`           | Execution blocker | Correct bound methods so failures test missing implementation                             |

The reviewer confirmed the local-midnight clamp, disjoint cohorts, source-failure
suppression, scheduled-field reconstruction and no input mutation in the proposed
snippets. Architecture, code quality, tests and performance were reviewed. Added
simulation/deduplication needs before/after measurement. Corrected drafts still
need implementation, HTTP and rendered acceptance; no runtime result is claimed.

Focused independent recheck found one remaining high issue in the initial scope
blacklist: "today until noon" and "today from 14:00 to 15:00" could still bypass it.
Replace the blacklist with bounded whole-today full-match forms; every extra time
qualifier clarifies with no probe. Add both exact negative regressions. The reviewer
found no other high/critical issue in that focused recheck. The replacement guard
is locally probed as documentation logic, not installed API behavior.

## Phase 4: contributor DX review

Main-agent review of the internal contributor/operations experience, grounded in
README, `.env.example`, `config.py`, package scripts, CI and the recovery runbook.
This is not a public SDK or API business. No live install/timing claim.

Contributor perspective: I should be able to open this repository, know what
Cooper already does, and test a local planning loop without enrolling in several
cloud services. Before this pass, README described the stack and production
providers but did not contain a local startup path. AGENTS had commands, while
the minimum local-key constraint lived in configuration and the environment
example. A newcomer could mistake Google or Gemini setup for a prerequisite.
The new README path names the required Python/Node versions, locked installs,
local-only settings, two terminals, manual capture, schedule and undo. It also
says what health does not prove. As a contributor debugging a fit answer, I need
the sampled local day, configured limits and source status, not the user's prompt
or calendar contents. As an operator, I need explicit restore and callback gates
before switching API hosts. As a maintainer, I need planned fields kept distinct
from implemented ones so I do not build billing against nonexistent reservations.
Those requirements justify the added setup guide, additive capacity contract and
bounded plan, not an SDK, developer portal or new community infrastructure.

| Journey stage      | Grounded finding or correction                                                          |
| ------------------ | --------------------------------------------------------------------------------------- |
| Discover           | README links current PRD and separately labeled target design                           |
| Evaluate           | Current sources, BYOK beta and unbuilt commercial features distinguishable              |
| Install            | Add lockfile-based `uv sync --frozen` / `npm ci` and CI-aligned versions                |
| First local result | Manual capture, configured hours, schedule and undo; no providers                       |
| Integrate          | Existing auth/owner/provider contracts; future AI adapter scope is bounded              |
| Debug              | Specific unavailable/no-slot/unknown/horizon states; no generic retry for invalid setup |
| Upgrade            | Optional capacity field; exact wire names; no DB migration for this tranche             |
| Scale              | Durable accounting before replicas/funded keys; benchmark actual request phases         |
| Migrate            | Isolated restore, preserved secrets, single watcher, callback transition and rollback   |

Eight DX passes covered first use, interfaces/errors, documentation/discovery,
feedback, backward compatibility, secrets/configuration, measurement and support
responsibility. Time to first useful plan remains unmeasured. Target a five-minute
manual setup after dependencies are installed, then measure with a clean checkout;
do not advertise that number as a benchmark. CI has backend tests/Ruff, frontend
serial tests/format/build and deploy gates; this pass did not run private CI.
The current local shared-key setup is documented, not modified or promoted to
hosted authentication. HTTP and browser environment blockers remain open.

## Capacity-plan correction pass

The 2026-09-30 follow-up kept the product direction and blocked execution of the
first capacity draft until five contracts were corrected. Two synthetic read-only
probes reproduced the load-bearing defects:

| Probe                                                                | Observed before implementation                                                               | Corrected contract                                                                         |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 30-minute open task with a 10-minute daily task limit                | Home snapshot selected the task for `focus.now_id`; `place()` returned no slot               | Home derives an unscheduled Now task only from the same full projection used by scheduling |
| One due-today task and one pinned future task competing for one slot | Due-today-only assessment placed today's task; full scheduling placed the pinned future task | Capacity filters due-today outcomes from the all-open-local-task seven-day projection      |

The implementation plan now labels `demand_scope=due_today_unscheduled` separately
from `scheduling_scope=all_open_local_tasks_7_days`. Unknown effort has an explicit
count, partial flag and known-estimate subtotal. Home may not present zero minutes or
zero slots as a complete result while due-today estimates are missing.

The first pilot is explicitly constrained to the configured server timezone.
Onboarding and availability settings display that value and offer no timezone picker.
Owner-timezone support requires its own end-to-end plan before a wider launch.

Funded AI remains disabled. Its activation contract now separates read-only answer
semantics from service accounting and planning mutations. Admission reserves one
allowance unit and maximum attempt cost transactionally before dispatch; unique
request and attempt keys handle concurrency; uncertain provider cost remains reserved
after a crash or timeout; a committed planning mutation has its own idempotent receipt.
These are required future tables and tests, not implemented safeguards or approved spend.

Self-grill conclusions remain unchanged: Plus must earn renewal through demonstrated
weekly planning and recovery value, Cooper funds Free only after cash envelopes are
approved, and the team finishes one trusted web planning loop before expanding scope.

## GSTACK REVIEW REPORT

Historical pre-implementation review, 2026-09-30. The table and documentation checks
below describe that review pass, not the subsequent implementation status.
On 2026-10-01 the capacity tranche was implemented and verified locally, followed
by the sidebar performance correction. See the
[current roadmap status](cooper-product-rethink.md#whole-roadmap-status-2026-10-01)
and [capacity implementation record](../superpowers/plans/2026-09-30-cooper-today-capacity.md#implementation-record).
Recovery, weekly review, funded AI, billing and migration still need their own
implementation plans and acceptance gates.

Fresh verification for this documentation pass:

- Prettier checked all ten touched documentation files successfully.
- `git diff --check` passed for the current worktree.
- Local-link check resolved all 38 checked links, with none missing.
- Placeholder/pending-review scan found no matches in the plan/review record.
- Twelve isolated assertions passed against the draft whole-today scope guard,
  extracted from the plan. No application import, persistence or model call.

These checks validate formatting, references and that one draft guard. They do
not prove the full plan, HTTP contract, rendered layout, provider semantics,
hosting, billing or performance. Existing runtime changes remain untouched.

| Review                | Status                   | Remaining scope                                          |
| --------------------- | ------------------------ | -------------------------------------------------------- |
| Brainstorming and CEO | Complete for draft       | Customer demand and willingness to pay unvalidated       |
| Self-grill            | Direct fallback complete | `/grilling` command unavailable                          |
| Design                | Reviewed and corrected   | State/interaction contracts; live geometry unverified    |
| Engineering           | Reviewed and corrected   | Shared projection specified; execution tests remain open |
| Contributor DX        | Reviewed; docs corrected | Internal workflow only; setup timing unmeasured          |
| Writing-plans         | Draft complete           | Capacity subsystem only; no runtime execution            |

Verdict: the corrected capacity plan may proceed to implementation. Funded AI and
paid launch remain blocked on their separate activation and validation gates.

Unresolved launch decisions:

- Approved infrastructure and AI cash envelopes and pilot admission size.
- Actual provider eligibility, adult-access controls, regions and model evaluations.
- Commercial schema approval, merchant jurisdiction/provider and lifecycle policies.
- Production DB/backup/region inventory, hosted restore and migration acceptance.
- Evidence of repeated planning value, paid purchase and renewal.
