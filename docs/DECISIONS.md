# Decision Log

Every entry records what was decided, why, and what was rejected. Read this before proposing an
alternative. Most alternatives were already considered.

Format: decision, date, rationale, rejected alternatives, consequences.

---

## 1. All four pain points are one loop, not four features

**2026-08-29.** Capture friction, decision paralysis, plan decay, and fragmentation form a
closed loop: capture, prioritize, schedule, re-plan.

Rejected: picking one pain and shipping a narrow tool. Rejected because the loop only pays off
when it closes, and a capture tool that does not rank is a worse notes app.

Consequence: phasing is mandatory. Each phase must stand alone or the project cannot be stopped
safely partway.

## 2. Web app, not CLI or chat bot

**2026-08-29.** React frontend plus FastAPI backend.

Rejected: a CLI, which is cheapest but useless for capture away from the desk; a Telegram or
Slack bot, which has the best capture ergonomics but no surface for reviewing a plan.

Consequence: a frontend, a backend, and localhost hardening are all in scope from Phase 0.

## 3. Own database is the source of truth; Google Calendar is a projection

**2026-08-29.** Cadence owns tasks, priorities, and history. Calendar reflects them.

Rejected: Calendar as source of truth with metadata in event descriptions, which cripples
prioritization and makes parsing your own data fragile. Also rejected: full bidirectional sync,
whose conflict resolution cost buys nothing for a single user with a single writer.

Consequence: the outbox pattern, ownership tagging, and sync tokens are all required.

## 4. Full autonomy, with correction instead of confirmation

**2026-08-29.** The AI applies changes without asking. Author's explicit choice, overriding a
recommendation for tiered autonomy gated by blast radius.

Rejected: confirming every calendar write, which reintroduces the friction the project exists to
remove.

Consequences, all now mandatory rather than optional: the mutation log with inverse operations,
batch undo, the daily digest, the per-turn mutation cap, and the parsed chip as the correction
path. Safety comes from the AI being structurally unable to do arbitrary damage, since it cannot
come from asking permission.

## 5. Multi-attendee events are never moved automatically

**2026-08-29.** The one carve-out from full autonomy, retained over the author's preference for
no exceptions.

Rationale: moving such an event emails other people. Undo restores database state; it does not
un-send email. The failure is unrecoverable and lands on third parties.

## 6. Deterministic scoring ranks; the model may only reorder the top 10

**2026-08-29.** A weighted formula produces the order. The reranker may permute the top 10 and
must state a logged reason.

Rejected: pure model judgment, which is unrepeatable and undebuggable, and reads like a
horoscope by month three. Also rejected: formula only, which cannot express judgment.

Consequence: ranking works with zero model calls, which is what makes degraded mode viable.

## 7. Gemini free tier only, behind a provider adapter

**2026-08-29.** Author's constraint.

Verified against Google's documentation on 2026-08-29: free-tier prompts and responses may be
used to improve Google products, and moving to paid tier is what excludes that. Free-tier rate
limits are no longer published as a fixed table; they are per-project, visible only in AI Studio,
and explicitly not guaranteed.

Consequences: sensitive fields are stripped at ingestion; the quota governor learns its ceiling
rather than assuming a published number; model IDs live in configuration because the Gemini
lineup changes frequently; and a second provider implementation exists from day one.

## 8. The scheduler may write only inside declared focus windows

**2026-08-29.** The user declares recurring windows. The scheduler places the shortlist inside
them, under a daily cap.

Rejected: blocking every task into any free time, which fills the calendar with fiction the user
learns to ignore, at which point the calendar stops being trustworthy at all. Also rejected:
never auto-blocking, which forfeits the scheduling half of the loop.

Consequence: this is the guardrail that makes decision 4 safe. Territory outside declared windows
is unreachable by construction, not by policy.

## 9. Intent compiler architecture, not a tool-calling agent loop

**2026-08-29.** The model emits one validated intent. Deterministic services execute it.

Rejected: an agent loop with registered write functions. It handles compound requests more
gracefully but costs several round trips against an unpublished quota, is hard to test, and hands
write capability to a non-deterministic component, which combines badly with decision 4. Also
rejected: batch-only planning, which cannot answer "what now" with knowledge of the last hour;
its nightly job was retained as one component rather than the whole architecture.

Consequence: one model call per utterance, a testable core, and prompt injection containment.

---

The following were adopted during the 26-question design grill on 2026-08-29.

## 10. The Today view is the primary surface; chat is a capture bar

Reviewing a plan by typing questions at it is slower than looking at a list already on screen.
Chat is good for input and poor for review, so the roles were split. This was the largest
correction from the grill: the original framing treated chat as the application.

## 11. Disambiguation is deterministic, not model-reported confidence

Model self-reported certainty is uncalibrated. A reference resolves only when exactly one
candidate clears the similarity threshold. Zero matches or a near-tie yields `Clarify`.

## 12. The parse pipeline is bounded at two model calls

Schema-constrained generation, one repair retry, then the rule-based parser, then `Clarify`.
Bounds cost and guarantees a terminating path.

## 13. Scheduled jobs are catch-up based

A cron-style trigger at 03:00 never fires on a laptop that is asleep, which would make the design
quietly fail rather than visibly fail. Jobs record `last_run_at` and run at startup if overdue.

## 14. Prompt injection containment is an architectural invariant

Third-party event titles reach only the reranker, whose output is validated as a permutation of
supplied IDs. A fully hijacked reranker can only misorder ten of the user's own tasks. The
mutating path never sees third-party text. No future change may relax this.

## 15. Localhost hardening is required in Phase 0

A no-authentication local API holding a calendar write token is reachable by any web page the
user visits, and DNS rebinding defeats naive origin checks. Required: bind `127.0.0.1`, lock
CORS, validate `Host`, and require a shared-secret header. This is not authentication; it is what
makes the localhost-only assumption hold.

## 16. OAuth consent screen mode is a documented setup decision

A consent screen left in Testing mode expires refresh tokens after seven days. This is the most
likely thing to make the project appear broken while the code is correct, so it gets a token
health check, an explicit re-auth flow, and a setup step.

## 17. A binding kill criterion after Phase 2

Two weeks of real use with no development. Not opening Today on 10 of 14 days ends the project.
The expensive half of the system is worthless if the cheap half has not earned a habit.

## 18. The first implementation plan covers Phases 0 through 2 only

Planning past the kill gate would presume the outcome the gate exists to test, and would produce
a plan too large for review checkpoints to mean anything.
