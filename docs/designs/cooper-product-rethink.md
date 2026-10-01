# Cooper product rethink

Status: DIRECTION APPROVED by the owner on 2026-09-30, with Gemini primary and
Groq fallback added for the initial AI setup. The four deterministic planning-answer
repairs, landing FAQ/proposed-plan chapter, today-capacity tranche and sidebar
performance correction are implemented in the working tree.
No migration, paid subscription or included-AI feature has shipped from this work.
`PRD.md` and `ARCHITECTURE.md` still describe the implemented product. This proposal
extends the approved [unified planning direction](cooper-unified-planning-wedge.md);
it does not erase that document's acceptance gates or turn hypotheses into demand.

Follow-up owner clarification: one Cooper product, responsive web/PWA first only;
no native mobile development or separate app suite. The
[web-first design](../superpowers/specs/2026-09-30-cooper-web-first-product-design.md)
refines this direction with reviewed contracts and a capacity-first sequence.
Its [review record](cooper-web-first-review.md) supersedes the review-status snapshot
at this document's end. Future feature proposals still need implementation plans;
the completed capacity tranche is recorded separately below.

## Whole-roadmap status, 2026-10-01

The product direction is approved; the whole roadmap is not implemented. The
[capacity implementation record](../superpowers/plans/2026-09-30-cooper-today-capacity.md#implementation-record)
contains current automated and browser evidence. The rest of this document's
inspection and review findings describe the earlier proposal unless stated otherwise.

| Work                                       | Current status                                                                                                      | Required next step                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| One responsive web/PWA                     | Owner-approved boundary                                                                                             | Keep one product; no native app or service suite                                                                       |
| Planning-answer repairs and today capacity | Implemented locally; 443 backend and 230 frontend tests passed                                                      | Finish native browser zoom and connected-provider acceptance before release                                            |
| Sidebar performance                        | Implemented and measured locally                                                                                    | No additional sidebar scope proposed                                                                                   |
| Guided recovery                            | Implemented: At Risk preview, stale-safe apply, all-or-nothing batch undo; ungated in beta                          | Owner browser acceptance done; decide Plus gating once billing exists                                                  |
| Weekly review and reusable routines        | Weekly review implemented (read-only, Free); routines not implemented                                               | Routines: approve a persistence and duplicate-submission design (likely a new table), then plan                        |
| Included Gemini/Groq                       | Accounting, provider adapters, atomic receipts and BYOK removal implemented (uncommitted); funded dispatch disabled | Owner browser acceptance done; approve cash envelopes, model IDs and prices; live provider acceptance; then activate   |
| GCP migration                              | Approved direction; no cutover executed by this work                                                                | Measure latency; prepare restore, ownership, callback and rollback acceptance                                          |
| Free/Plus subscriptions                    | Pricing and quotas are hypotheses; checkout disabled                                                                | Demonstrate repeated planning/recovery value, approve funding and merchant/lifecycle contracts, then implement billing |

No recovery, weekly-review, funded-AI, billing or GCP execution plan was added by the
capacity tranche. Their product specifications are inputs to those later plans,
not evidence that implementation or commercial launch is ready.

Plus renewal remains unvalidated. Cooper would fund Free, but no cash envelope was
approved by the product-direction decision. Quotas alone do not authorize spending.
The next implementation sequence remains release acceptance, guided recovery, then
weekly review, with user-value observation alongside the trusted planning loop.

## Recommendation

Make Cooper a personal planner for adults whose tasks and fixed commitments compete
for the same limited time. Its job is to turn an overloaded list into a realistic
plan, explain the tradeoffs, and help recover when the plan slips.

Proposed promise: **Know what fits. Know what comes next. Adjust when life happens.**

Calendar integration supplies constraints; it is not the product. AI helps people
express and understand their work; it does not decide what time exists. Subscription
value should come from useful repeated planning, not from selling a chat box.

Start with Free and Plus, not three superficially different paid tiers. Move the API
from Render to Cloud Run while retaining the existing PostgreSQL database initially.
Provide server-funded Gemini with Groq as an availability fallback after durable
metering exists. Keep rule/manual operation when neither model can be used. Ship accurate
planning answers before expanding their prominence or charging for them.

## Decisions, assumptions, and evidence

The owner's approved direction is GCP hosting, Cooper-funded included AI with BYOK removed,
Gemini primary with Groq fallback initially, freemium subscriptions, better product
definition, and functional repairs. These are
not authorization to choose a billing jurisdiction, incur an unspecified budget,
change encryption keys, or weaken the current privacy rules.

Working assumptions for this draft:

- Initial audience: adults managing personal, work, and study commitments. No team
  permission system or under-18 AI launch is assumed.
- Validate with five adult users before a bounded pilot of at most 50 accounts.
  Those are proposed cohort sizes, not present user counts.
- Infrastructure should target free allowances; AI has a separate, explicitly
  approved cash budget. Neither is an unconditional zero-cost promise.
- English web experience first. Local manual planning remains usable without any
  model or connected provider.
- Pricing below is a willingness-to-pay hypothesis in USD, not a localized price
  decision, approved offer, or profitability forecast.

Verified in the current repository:

| Area        | What exists                                                                     | What is missing or uncertain                                                   |
| ----------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Capture     | Sentence and manual entry; additive batch creation                              | Estimation/decomposition guidance is not a complete workflow                   |
| Planning    | Explainable ranking, exact placement, configured windows and limits             | Workload-versus-capacity answers are incomplete                                |
| Trust       | One writer, undo, source health, read-only providers; four answer repairs       | Full capacity and general model-answer fidelity still need verification        |
| Daily use   | Home Now/Next/Today/At Risk, local rescheduling, guided recovery, weekly review | Reusable routines not built                                                    |
| Sources     | Google, iCloud, supported Gmail confirmations                                   | Teams/Classroom remain future; public Gmail readiness is not established       |
| AI          | Rule fallback, read-only tools; BYOK removed, funded ledger built (2026-10-01)  | Funded dispatch disabled pending budgets, models and live acceptance           |
| Commercial  | Public pages, FAQ and proposed Free/Plus choices                                | No subscription, checkout, webhook, or usage-ledger implementation located     |
| Delivery    | Firebase Hosting/Auth, Render API, hosted PostgreSQL                            | Current DB provider/region/plan, Render plan and production latency unverified |
| Reliability | Health route and recovery documentation                                         | Hosted backup/restore acceptance is not established by local restore tests     |

These are source-inspection findings, not an exhaustive security or legal audit.
The latest recorded owner Google/iCloud acceptance is 2026-09-14 in
[LIVE_PROVIDER_ACCEPTANCE](../LIVE_PROVIDER_ACCEPTANCE.md). No new connected-account
acceptance was performed during this review.

### Reproduced planning defects and local repairs

Initial read-only probes executed the pre-repair `answer_planning_intent` and its helpers with
synthetic snapshots, without importing the running application or changing data:

| Input                                                  | Pre-repair answer                                             | Consequence                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------ |
| Meeting active at 10:00, started at 09:30              | “Your next commitment is Current meeting at 9:30 AM.”         | Now and next are conflated                                   |
| Open unscheduled task, no remaining events             | “You have no remaining calendar commitments today.”           | Valid narrowly, misleading as an answer about remaining work |
| Highest-ranked task blocked by incomplete availability | “Focus on Pending work first because it is marked important.” | Priority is presented without its feasibility limitation     |
| Eight hours of unscheduled work, no events             | “Today is not overloaded: 0 commitments occupy 0 minutes.”    | Absence of meetings is mistaken for manageable workload      |

The repairs distinguish current/next, disclose unscheduled work, separate priority
from placement, and remove the fixed seven-hour workload reassurance. Regression
tests exercise the actual renderer with isolated settings. Build a proper
demand/capacity model as a separate, tested change. Unscheduled work
is not automatically due today, and a task's full estimate is not measured remaining
effort after partial work.

Further risks identified by inspection, not reproduced defects: fit answers use a
free-block metric without demonstrating all placement constraints; general model
prose is not semantically verified against tool facts; current-free recommendations
need explicit acceptance against lead time, breaks and daily limits.

### Slowness: separate hypotheses from measurements

`today_view` reads Google and iCloud sequentially. Some request paths rebuild views;
AI parsing, repair, tool turns and fallback can add multiple model calls. The frontend
also polls the daily view every minute. These are plausible latency/cost contributors.

Render documents roughly one-minute wake-up for idle free services, but the actual
Cooper plan has not been checked. A live health request failed DNS resolution in
this environment; that is not evidence of a production outage or measured latency.
[Render free-service behavior](https://render.com/docs/free).

Measure cold/warm API, DB, provider and model times separately before declaring
that a hosting move fixes the whole issue. Reuse the existing request ID and sanitized
duration logs; never add titles, prompts, tokens or provider message IDs to logs.

## Office Hours: the problem worth solving

Hypothesized user: someone who already captures tasks but cannot tell whether their
week is possible. A working adult taking classes is one candidate, not a validated
exclusive persona. The relevant problem is deciding what to do, what to defer, and
how to recover—not possessing another calendar.

Job: “When commitments and unfinished work compete, help me make a plan I can
actually follow without maintaining a second planning system.”

Proposed replacement behavior: a task list plus calendar plus repeated manual
reshuffling. Evidence still needed: observe the real workaround, frequency and
consequence of failure, then watch whether Cooper replaces it rather than becoming
another place to check. The owner's enthusiasm is useful product input, not proof
of an external market.

### Three product directions

| Direction                                | Benefit                                                         | Tradeoff                                                                        | Verdict                                                         |
| ---------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Better capture and AI calendar           | Smallest change; quicker convenience improvements               | Easily compared with existing task tools; weak renewal reason                   | Useful first repair tranche, insufficient long-term positioning |
| Realistic personal planning and recovery | Builds on current ranking, availability, source health and undo | Needs honest capacity and recurring planning workflows                          | Recommended hypothesis                                          |
| Broad life/work operating system         | Projects, notes, habits, collaboration and many integrations    | New domain models; competes on breadth; reverses current simplicity constraints | Explore only if repeated user evidence demands it               |

Todoist already offers broad capture and organization, Reclaim calendar automation,
Motion a wider AI work suite, and Sunsama a deliberate daily planning workflow.
Cooper must demonstrate an easier path from overload to a workable day; “AI plus
calendar” is not a distinct advantage. This positioning is an inference from their
published offers, not competitive user research.
[Todoist](https://www.todoist.com/pricing),
[Reclaim](https://reclaim.ai/pricing),
[Motion](https://www.usemotion.com/pricing),
[Sunsama](https://help.sunsama.com/docs/billing/overview/).

## What the experience should do

```text
Capture → Clarify effort/deadline → Compare demand with safe capacity
                                      ↓
                               Choose a realistic plan
                                      ↓
                           Start → Finish or recover → Review
```

1. Capture several responsibilities naturally or manually. Unknown estimates stay
   unknown; Cooper offers help rather than inventing half-hour blocks.
2. Show fixed commitments, estimated work, unknown effort and provider health
   separately. Say when a plan cannot be confirmed.
3. Offer concrete choices when work does not fit: shorten scope, move a local block,
   defer a task, or change a deadline manually. Never silently change commitments.
4. Show a feasible next action with its reason. An active meeting is “Now”; a future
   commitment is “Next”; high priority alone is not “fits now.”
5. When a block is missed, offer one recovery action preserving fixed commitments
   and pinned blocks. Show the changed plan and provide one undo.
6. End with a lightweight review: unfinished work, upcoming deadlines and tomorrow's
   capacity. No moralizing score, streak punishment or fabricated productivity metric.

Example: a person has two safe hours left and four hours of work due tomorrow.
Cooper shows the shortfall, identifies unknown estimates, and proposes a smaller
today plan plus explicit deferrals. It does not pretend an empty evening outside
configured availability is free time or claim AI has solved an impossible deadline.

### Capability roadmap

| Capability                                   | User value                                | Existing leverage                                                | Order                                 |
| -------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| Accurate Now/Next/remaining/priority answers | Stops misleading advice                   | Canonical snapshot and deterministic renderer                    | First repair                          |
| Demand versus usable capacity                | Makes overload actionable                 | `Hours`, placement, busy intervals, task estimates               | Next core change                      |
| Guided recovery after missed blocks          | Prevents abandonment when reality changes | Task states, local rescheduling, undo                            | After feasibility                     |
| Daily shutdown and weekly review             | Makes return visits useful                | Deadlines and snapshot; no analytics platform needed             | Pilot core loop                       |
| Included language assistance                 | Removes API-key setup                     | Rule parser, validated actions and tools                         | After metering and budget             |
| Guided task breakdown                        | Turns vague work into estimated actions   | Existing `add_batch`; no hidden dependency graph                 | Experiment after core loop            |
| Reusable planning routines                   | Reduces repeated setup                    | Start with explicit repeatable capture, no background generation | Paid-value experiment                 |
| True recurring tasks                         | Handles weekly obligations                | Recurrence/time model not yet selected                           | Separate design and DST tests         |
| Reliable reminders when app is closed        | Removes a real limitation                 | Current browser notifications are not sufficient                 | Separate delivery/privacy/cost design |
| Teams, Classroom, more inbox sources         | Broader inputs                            | Existing source interface                                        | Demand-driven, not launch blockers    |

“Offer more” should mean completing these connected jobs. It should not mean adding
boards, a document editor or a team permission system before the core plan is trusted.
Do not call a manual reusable routine automatic recurrence, or a visible-page
notification a reliable background reminder.

### Experience and public-site requirements

Keep Cooper's friendly otter voice, warm palette and direct language. Correctness
comes first; a cheerful impossible plan is worse than a plain honest one.

Onboarding should reach a first useful local plan before asking for integrations.
Set availability, capture three tasks, make uncertainty visible, then offer optional
Google/iCloud connections. AI should require no key entry in hosted mode.

The public site needs a concrete example of an overloaded day becoming manageable,
an honest feature comparison, pricing, FAQs, integration status, privacy boundaries,
and an accessible support route. Do not advertise future recurrence, verified
background reminders, Teams/Classroom, or Gmail availability as shipped features.

Account settings need plan status, renewal date, cancellation, usage remaining,
export and deletion. Export/deletion and safe downgrade behavior are launch work,
not a premium upsell. Specify legal retention exceptions before promising immediate
deletion of payment records. No fake testimonials or invented adoption numbers.

## Freemium and pricing hypothesis

|                                               | Free                               | Plus                                           |
| --------------------------------------------- | ---------------------------------- | ---------------------------------------------- |
| Candidate price                               | $0                                 | $8 monthly or $72 yearly ($6/month equivalent) |
| Capture/manual entry                          | Included                           | Included                                       |
| Safe local scheduling, ranking, undo          | Included                           | Included                                       |
| Supported calendar reads and source health    | Included                           | Included                                       |
| Basic daily planning and manual recovery      | Included                           | Included                                       |
| Included AI allowance                         | 20 assisted actions/calendar month | 300 assisted actions/calendar month            |
| Guided weekly planning and recovery workflows | Not in initial Free scope          | Candidate paid-value feature                   |
| Reusable planning routines                    | Not in initial Free scope          | Candidate paid-value feature                   |
| Export, deletion and privacy controls         | Included                           | Included                                       |

Unlimited task capture here means no proposed arbitrary item paywall; normal service
abuse limits still apply. Do not promise unlimited model calls. Keep deterministic
questions, manual forms, ranking, undo and ordinary placement outside AI quota.
Only ship Plus when its repeated planning workflows are genuinely useful; more AI
credits alone do not validate the paid proposition.

No third tier, lifetime plan or enterprise bundle initially. Review a higher tier
only when a materially different workflow and its cost are demonstrated. Annual
pricing is a later offer if cancellation/refunds and value retention are established;
first validate monthly willingness to pay.

Proposed subscription behavior: server-side entitlements; cancellation takes effect
at paid-period end; a failed payment follows the chosen provider's explicit grace
policy; downgrade preserves existing tasks and permits reading/exporting paid-created
content. No automatic data deletion or surprise AI overage charges. Allowance resets
at a clearly displayed UTC calendar-month boundary for both plans, independent of
billing anniversary. State this at purchase.

Vendor selection depends on actual business jurisdiction, payout eligibility,
verification, fees, tax/refund handling and local payment preferences. Do not infer
merchant location from the developer's timezone or assume Stripe is available.
Paddle is a candidate merchant of record, not a provisioned or approved account.
[Stripe availability](https://stripe.com/global),
[Paddle supplier-country policy](https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle).

### Draft FAQs: publish only after the promises are implemented

The landing now publishes six beta-accurate FAQs beside proposed $0/$8 monthly
choices. Included AI and Plus workflows are explicitly not active; model use still
requires a supplied Gemini key. Future-policy FAQs below remain drafts, not
checkout, cancellation or entitlement guarantees.

- **What is Cooper?** A personal planner that helps turn tasks and fixed commitments
  into a realistic plan, then adjust it when your day changes.
- **Do I need a calendar account?** No. Capture and plan locally within Cooper;
  supported calendar connections are optional constraints.
- **Do I need my own AI key?** Not in the proposed hosted product. Cooper includes
  a stated allowance; local manual planning needs no AI at all.
- **Does Cooper change Google or iCloud events?** No. Connected calendars are
  read-only inputs; Cooper schedules and edits its own local items.
- **What uses an AI action?** A submitted request that uses the model. One accepted
  request uses at most one user allowance unit, even if bounded internal calls are
  needed. Manual entry and deterministic planning questions do not use units.
- **What happens when I run out?** Model assistance pauses until reset or upgrade.
  Your tasks, manual capture, safe scheduling and deterministic answers remain usable.
- **Can it guarantee everything fits?** No. It should show constraints and
  shortfalls, and say when missing estimates or unavailable sources prevent certainty.
- **Can I cancel or downgrade?** Proposed policy: cancel renewal in account settings;
  paid access continues to period end. Existing data remains readable and exportable.
- **What goes to AI?** Your own words and titles needed for the request. Provider
  calendar contents do not. Any enabled email-body processing needs its own clear
  exception and consent; no blanket “nothing leaves Cooper” claim.
- **What if a calendar cannot be checked?** Capture remains available. Cooper does
  not claim safe free time or commit a new placement until the source can be checked.
- **Will reminders work with Cooper closed?** Do not claim this until background
  delivery has been implemented and tested. Current browser notifications are limited.
- **Are there extra charges?** Proposed policy: no automatic AI overages. Display
  checkout taxes and the selected provider's applicable refund terms before purchase.

## Included AI: Gemini primary, Groq fallback

Owner clarification, 2026-10-01: Cooper supplies both API keys. The target product
has no user-key entry in Settings or onboarding and no optional BYOK mode. Free/Plus
allowances are enforced by the server. Current browser-key behavior is transitional;
remove it together with verified funded accounting, not before a replacement works.
The [accounting design](../superpowers/specs/2026-10-01-included-ai-accounting-design.md)
is the concrete schema approved on 2026-10-01; cash budgets remain unapproved.

The owner selected this order on 2026-09-30. The
[provider decision](../decisions/2026-09-30-included-ai-providers.md) records the
accepted direction; the [fallback design](../superpowers/specs/2026-09-30-included-ai-provider-fallback-design.md)
defines failure handling and release gates. Exact models, launch budgets and durable
accounting schema remain separate execution choices.

```text
Verified owner → rule/deterministic path ───────────────→ existing writer or answer
                    ↓ model actually needed
          durable entitlement + request reservation
                    ↓ global and per-user checks
          bounded calls → validated Action or read-only answer
                    ↓
             settle measured usage; return receipt
```

Do not fund AI merely by reading a server key in `config.py`. Current hosted rate
limits are process-local and do not enforce spending across restarts or instances.
The current parser, repair, four tool turns and fallback can total seven calls on a
request path. A proposed maximum of four calls must cover the entire path, not just
the tool loop. The same ceiling includes both providers, JSON repair and tool
continuation; switching providers does not reset it. Exhausted calls must return a
safe fallback. Provider fallback never replays an already committed mutation.

Use Groq only for Gemini timeouts, transport failures, temporary rate limits or
server unavailability. Do not switch for safety refusals, ambiguity, invalid actions,
invalid credentials or exhausted Cooper allowance/budget. Switch at most once per
request, then keep the remaining turns on Groq. If both fail, use rules or ask.

Both providers use server-held keys and the same sanitized own-words-only policy.
Disclose both before automatic fallback is enabled. First evaluate Groq's production
`openai/gpt-oss-20b`, listed at $0.075/M input and $0.30/M output on the checked date;
no Cooper benchmark has run. Parsing and tool calls need separate request formats:
Groq documents that structured outputs cannot be combined with tool use.
[Groq models](https://console.groq.com/docs/models),
[structured-output restrictions](https://console.groq.com/docs/structured-outputs).

Account for attempts on both providers under one durable Cooper budget. Groq's
limits are organization-level, not per Cooper user. Verify and enable inference
zero-data-retention before launch; Groq still retains usage metadata. Do not promise
an unlimited free backup or product-wide zero retention.
[Groq rate limits](https://console.groq.com/docs/rate-limits),
[Groq data handling](https://console.groq.com/docs/your-data).

The commercial design needs explicit approval for durable schema additions. Proposed
responsibilities are owner billing state, idempotent request usage/reservations, and
deduplicated payment events. Use transactional SQLAlchemy accounting with unique
request/event identities; not unlocked JSON counters in settings. Billing events
must not mutate planning items outside `app.py`. This does not justify a job queue,
generic billing framework or extra background consumer.

Reserve a conservative cost before each external call and reconcile actual provider
usage, including billed thinking tokens. Count one user unit for a completed useful
model-assisted request, not each hidden call. Duplicate request IDs must replay the
same outcome rather than invoke AI twice. For uncertain timeouts, retain the spend
reservation until reconciled; do not pretend an unknown call cost zero. Cross-worker
races, month rollover and restarts must be tested. The cost ledger and user allowance
are distinct: failed calls can still cost Cooper even when no user unit is charged.

Pin a model/version after quality evaluation. Candidate rates checked on 2026-09-30:
Gemini 2.5 Flash-Lite $0.10/M input and $0.40/M output; Gemini 3.1 Flash-Lite $0.25/M
input and $1.50/M output. No quality benchmark was run. Paid pricing is separate from
Cloud Run's free compute allowance.
[Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

| Scenario                                                   | 2.5 Flash-Lite | 3.1 Flash-Lite |
| ---------------------------------------------------------- | -------------- | -------------- |
| One call: 2,000 input + 300 billed output tokens           | $0.00032       | $0.00095       |
| Four calls each bounded at 4,000 input + 512 billed output | $0.0024192     | $0.007072      |
| 300 actions at that four-call bound                        | $0.72576       | $2.1216        |
| 20 free actions at that four-call bound                    | $0.048384      | $0.14144       |

These Gemini-only arithmetic scenarios are not measured average costs, dual-provider
request costs or gross margins. Primary timeout plus Groq success can cost both;
unknown primary costs remain reserved. Token
bounds must include all billed output categories; reject unsupported limits rather
than assuming prompt characters equal tokens. Payment fees, DB, egress, free-user
subsidy, support, taxes and refunds remain outside this table. Fifty free accounts
fully using the larger-model bounded allowance would cost about $7.07 in model
tokens alone. Thus “free infrastructure” does not mean “free included AI.”

Use a billing-enabled paid AI project: Google's terms distinguish paid from unpaid
data handling. Paid service is not a zero-retention guarantee. The Gemini Developer
API also prohibits services directed toward, or likely accessed by, under-18 users;
an adult-only draft persona is not a substitute for enforceable product eligibility.
Review that eligibility before launch or choose another suitable AI arrangement.
[Gemini API terms](https://ai.google.dev/gemini-api/terms).

Never expose the server key to the browser, widen the email-data exception, send
provider titles to a model, or stop sanitizing stored titles. An AI budget exhausted
state must disable model calls, not delete work or disable the manual product.

## GCP migration: practical options and limits

| Option                                                  | Cost/reliability implications                                                    | Recommendation                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Cloud Run API + existing PostgreSQL + existing Firebase | Smallest API migration; retains DB/provider risk                                 | First step, after DB plan/backup/region verification    |
| Cloud Run + production Cloud SQL + Firebase             | More unified operations; managed DB may require paid resources                   | Later, with a separate approved DB budget and migration |
| Free VM with self-managed DB                            | More operations/backup risk; free VM allowance has regional and ancillary limits | Not preferred for subscription reliability              |
| Rewrite to Firestore                                    | May fit free quotas but changes persistence, queries and migrations              | Do not rewrite just to chase a free database            |

Cloud Run request-based pricing lists 180,000 vCPU-seconds, 360,000 GiB-seconds and
two million requests monthly in its free tier. Allowances are aggregated across the
billing account and regional prices differ; networking and other products have
their own charges. Start with request-based billing, minimum instances zero,
service-level maximum one, 1 vCPU, 512 MiB and concurrency eight as test settings,
not proven optimal sizing. Co-locate API and DB where practical, then measure from
actual users rather than defaulting to a distant cheap region.
[Cloud Run pricing](https://cloud.google.com/run/pricing).

Minimum zero permits cold starts; keeping an instance warm trades cost for latency.
Maximum instances is not a strict spending cap and can briefly be exceeded.
An in-process Gmail timer cannot be relied on when request-based CPU is idle.
[Maximum instances](https://docs.cloud.google.com/run/docs/configuring/max-instances),
[billing and CPU allocation](https://docs.cloud.google.com/run/docs/configuring/billing-settings).

Cloud SQL's normal PostgreSQL trial is temporary. Google also documents an
AI-Studio-provisioned developer starter path with limited free usage, but without
backup/recovery and other production protections. It is not a drop-in production
database or justification for promising durable subscriptions on a free DB.
[Cloud SQL trial](https://docs.cloud.google.com/sql/docs/postgres/free-trial-instance),
[developer starter restrictions](https://docs.cloud.google.com/sql/docs/postgres/ai-assisted-coding-and-cloud-sql).

### Cost controls, not a zero-bill guarantee

- Separate infrastructure alerts, AI alerts and the durable application AI budget.
  Choose actual thresholds only after the owner provides an acceptable spend envelope.
- Google's current preview spend-cap budgets can pause eligible services, including
  Cloud Run and Gemini. They operate on estimated gross cost, exclude credits, are
  not instantaneous, can bill overages/in-flight work, and do not stop all persistent
  resource charges. A Cloud Run cap can take the core API down; reserve it as an
  explicitly accepted emergency tradeoff. AI-only exhaustion should leave manual
  planning online. [Spend-cap limitations](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps).
- Store only required secret versions. Secret Manager has its own allowance;
  never rotate existing encryption material casually during migration.
- Keep container retention bounded while retaining the deployed and rollback images.
  Artifact Registry's free storage is 0.5 GiB across the billing account; large images
  or scanning can cost extra. [Artifact Registry pricing](https://cloud.google.com/artifact-registry/pricing).
- If scheduled Gmail sync is retained, replace the existing timer with one fixed
  authenticated Scheduler invocation, not a second simultaneous loop. Three Scheduler
  jobs per billing account are free; their target's work still has its own cost.
  [Scheduler pricing](https://cloud.google.com/scheduler/pricing).
- Check shared-account quotas, egress, builds, log retention, registry, DB and secrets
  together. Do not equate a Cloud Run quota with an all-GCP cost ceiling.
  [Google Cloud free allowances](https://docs.cloud.google.com/free/docs/free-cloud-features).

### Cutover gates

1. Inventory the actual Render plan, PostgreSQL endpoint/region/backup policy,
   allowed origins, OAuth callback and Gmail execution topology without copying secrets.
2. Verify a hosted backup restoration to an isolated database, including encrypted
   provider settings with the existing key. Record only privacy-safe evidence.
3. Deploy a candidate API against an isolated copy first. Keep Firebase identity,
   owner scoping, encryption material, database migration versions and local-only
   writer behavior unchanged. Run migrations once in the planned release flow;
   prevent overlapping old/new startup migrations.
4. Test cold/warm requests, denied cross-owner reads/writes, unavailable providers,
   undo, and AI-disabled/manual operation. Verify container memory under concurrency.
5. Add the new OAuth callback before switching runtime API configuration. Existing
   signed states and callback transitions need explicit tests; do not assume tokens
   become invalid or rotate secrets to solve a URL change.
6. Switch the public API base only after the new route and authentication work.
   Keep the Render endpoint available for rollback. No concurrent DB relocation or
   destructive migration in the API cutover.
7. Repeat Google/iCloud manual acceptance and record it in
   `docs/LIVE_PROVIDER_ACCEPTANCE.md`. Confirm the single Gmail cadence if enabled.
8. Roll back runtime configuration on failed acceptance; only retire Render after
   an observation window and documented rollback exercise. A green CI run alone
   is neither deployment proof nor connected-account acceptance.

## CEO review: all sections, provisional conclusions

Expansion was considered; selective expansion is recommended. Preserve the small
planning core, add commercial accounting only for demonstrated paid-service needs.
The owner approved the direction, not a completed implementation or independent
engineering review. Detailed commercial and cutover release gates remain open.

| Review section      | Decision or release gate                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architecture        | Reuse snapshot, planner, single writer and Firebase. API migration and DB relocation are separate. Commercial tables require explicit schema review.                  |
| Errors/resilience   | Unknown capacity stays unknown; AI failure falls back; no silent provider failure or success before committed state.                                                  |
| Security/privacy    | Server-funded keys remain server-side; verified owner entitlements; signed webhook verification; no widened OAuth scopes; paid AI terms and age eligibility reviewed. |
| Data/UX edges       | UTC/DST, overnight windows, zero/unknown estimates, active-versus-next, pinned/fixed work, downgrade and cancellation are explicit test cases.                        |
| Code quality        | Prefer small existing-file changes; no generic service layer, queue or hidden dependency model. Existing long files are not permission for a wholesale rewrite.       |
| Tests               | Regression tests for reproduced answers; pure time/capacity tests; HTTP owner/accounting tests; visible UX and live-provider gates remain distinct.                   |
| Performance         | Measure host/DB/provider/model phases; bound all AI calls; avoid redundant reads within one request; no stale availability at a write boundary.                       |
| Observability       | Keep request IDs and sanitized durations; show source freshness and AI allowance; alert on spend, sync failures and cap activation without storing content.           |
| Deployment/recovery | Isolated restore acceptance, one migration owner, additive callback transition, staged runtime-config cutover and preserved rollback endpoint.                        |
| Future scope        | Recurrence and closed-app reminders get separate specifications; no teams/projects/platform rewrite without evidence.                                                 |
| Design              | First plan before integration prompts; transparent demand/capacity, calm recovery, honest paywalls; pricing and FAQs reflect shipped capabilities.                    |

### Failure registry

| Failure                                          | User-visible behavior                                                 | Verification                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Connected source unavailable                     | Capture succeeds; safe placement blocked with source reason           | Mock transport tests plus manual unavailable-source acceptance |
| Empty calendar but excessive work                | Separate unscheduled demand; no “not overloaded” reassurance          | Synthetic regression, then pure capacity fixtures              |
| Insufficient continuous block/daily allowance    | Explain constraint; no split/invented duration                        | Placement/acceptance tests including overnight and DST         |
| AI timeout, invalid action or budget exhausted   | No guessed mutation; rule/manual fallback; accurate allowance         | HTTP failures and accounting reconciliation tests              |
| Duplicate/concurrent model request               | One logical response/allowance unit; safe spend reservations          | Two-worker transactional tests and restart test                |
| Forged/duplicate/out-of-order payment event      | No browser-granted tier; verified idempotent entitlement              | Provider sandbox signature/replay/order tests                  |
| Missed block recovery races a new calendar event | Re-read constraints; do not commit a stale plan                       | Writer-boundary stale-state test and visible recovery check    |
| Startup/cutover failure                          | Health fails; runtime config rolls back; data remains compatible      | Isolated deployment and rollback exercise                      |
| Background Gmail stops                           | Last-checked age visible; alert without message content               | Scheduled target auth and missed-cadence check                 |
| Cancellation/downgrade                           | Renewal stopped; data retained; paid actions disabled at correct time | Billing sandbox lifecycle and export/deletion acceptance       |

### Adversarial questions: grill-me pass

The installed `grill-me` entry point references an unavailable `/grilling` command.
The adversarial method is applied here directly; it was not a completed interview.

1. **Why would someone pay instead of using their existing list/calendar?** Only if
   realistic planning and recovery save repeated effort. Validate replacement behavior,
   not whether users say the mascot looks nice.
2. **Is this genuinely different?** Not yet proven. Competitors cover much of the
   territory; ease of use, trustworthy tradeoffs and price are hypotheses to test.
3. **Does “more features” solve the actual abandonment point?** Observe where people
   lose the plan first. If they cannot trust time placement, fix that before recurrence.
4. **Can free-tier hosting and a fast always-warm service both be guaranteed?** No.
   Choose measured scale-to-zero latency or an approved warm-instance budget.
5. **Who funds free AI users?** Cooper does. Bound the pilot, reserve cost before
   calls and set a separate approved monthly allowance before enabling it.
6. **Can a safety warning or manual correction become a paid feature?** No. Basic
   truthfulness, safe planning, undo and data access cannot depend on upgrading.
7. **What makes Plus worth renewing when AI novelty fades?** Repeated weekly planning,
   useful recovery and routines. If those do not earn retention, do not launch a
   paid tier merely because checkout is built.
8. **What breaks the current product rules?** Commercial tables and funded AI replace
   the no-ledger/BYOK assumptions; recurrence may change the time model. Review each
   deliberate exception; do not accidentally relax read-only providers or privacy.
9. **What would invalidate this recommendation?** Users primarily need collaborative
   projects, already recover effortlessly, refuse estimated durations, or will not
   return/pay despite a correct plan. Reconsider the audience or proposition then.

## Validation and execution order

Proposed success thresholds are targets, not measured results:

- Five adult users complete real planning sessions; at least three use Cooper on
  three separate days in a week and actually replace one previous planning routine.
- A first usable local plan within three minutes, without connecting a provider.
- Zero false “fits,” wrong-time, provider-write or misleading success claims in the
  bounded acceptance scenarios; source failures must always remain visible.
- Warm deterministic API p95 below two seconds and cold-start path below ten seconds
  are initial goals to test, not guarantees or current benchmarks.
- Test the $8 monthly offer with real purchase decisions after core usage succeeds;
  stated interest alone does not validate pricing. Do not collect money before billing,
  cancellation, policy and delivery gates pass.

Execution sequence:

1. **Trust repair:** reproduce and fix the four audited answer defects. The scoped
   [implementation plan](../superpowers/plans/2026-09-30-cooper-planning-trust.md)
   is implemented locally without commercial schema or hosting changes. HTTP,
   visual acceptance and delivery gates remain open as recorded in that plan.
2. **Core value:** start with scoped today capacity and real duration-fit checks,
   then separately specify recovery and weekly review with adult-user evidence.
   The next [capacity plan](../superpowers/plans/2026-09-30-cooper-today-capacity.md)
   is draft and does not depend on commercial or hosting work.
3. **Latency and API migration:** measure alongside core work; inventory real
   services, restore a hosted backup, stage Cloud Run and cut over separately
   from DB relocation. Migration is not a prerequisite for the capacity tranche.
4. **Included AI:** implement Gemini primary and Groq fallback after budget and schema
   approval; build reservations/entitlements before enabling server-funded keys;
   evaluate both providers and shared full-path call limits.
5. **Commercial launch:** choose eligible billing provider, validate monthly price,
   implement lifecycle/export/deletion, then replace proposed pricing/FAQs with
   verified launch terms. The current landing comparison is explicitly a preview.
6. **Expansion:** implement recurrence/reminders only after separate time/delivery
   design and demonstrated demand. More sources follow verified user need.

These are independently testable workstreams, not one giant redesign PR. After each
shipped change, synchronize PRD, architecture, AGENTS, README, ADRs and relevant
acceptance docs. Record new architectural decisions as decisions only when approved;
do not rewrite historical decisions to make proposed behavior look implemented.

## GSTACK REVIEW REPORT

| Skill                                    | Work performed                                                    | Status                                         |
| ---------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| Office Hours                             | Existing wedge, user job, assumptions and evidence gaps examined  | Discovery draft; external demand not validated |
| CEO Review                               | Alternatives, expansion boundaries and all eleven review sections | Direction approved; detailed gates still open  |
| Brainstorming                            | Three directions, connected experience and feature sequencing     | Owner approved direction; market unvalidated   |
| grill-me                                 | Adversarial questions and falsification criteria                  | Direct fallback; interview not completed       |
| writing-plans                            | First-tranche answer repairs executed; remaining gates recorded   | Implemented locally, not shipped               |
| Engineering/design implementation review | Automated regression/build checks and scoped design detector      | Browser review blocked; no independent review  |

Unresolved launch decisions: actual adult audience/eligibility, acceptable infrastructure
and AI spend, production DB/backup facts, billing jurisdiction/vendor/refund rules,
model-quality benchmark, commercial schema approval, and evidence that Plus earns
repeat use. These do not block this draft or the scoped trust-repair design.
