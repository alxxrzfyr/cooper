# Cooper refinement and connected planning

Source: the attached 18-section brief and 13 screenshots, reviewed 2026-09-08.
This work serves PRD requirements 1, 3, 4, 5, 6, and 7. Preserve Cooper's cream/green
paper appearance, illustrations, handwriting, categories, importance, navigation,
and separate mobile layout.

## Verified starting state

At 1366x768, the running Vite app has a 744px landing track. Its final panel's
footer ends at y=799, below the viewport. Login occupies 1042px and its card is
734px tall. Form needs 983px inside a 680px scroll area. The final card nests its
footer below the signup form. General opening-card CSS overrides Form's compact
styles. Multiple auth CSS blocks compete over page dimensions.

LandingPage.tsx runs requestAnimationFrame continuously and calls setState for
every Lenis scroll event. The calendar capture loads eagerly. App.tsx invents
Gmail/Calendar progress from keywords and marks steps successful using timers.

Google Calendar and Gmail already use server-side, owner-scoped encrypted grants.
Calendar.add_block uses deterministic IDs but did not verify ownership before patching a conflicting
ID or deleting a saved event reference.
sources.busy_windows collects Google/local/Gmail commitments. brain.py proposes
validated Actions; app.py writes and owns undo. Calendar write failures can be
swallowed by place_one and schedule_now. There is no MCP or iCloud adapter.

The checkout contains earlier auth, onboarding, config and visual changes. Keep
them in place and retain explicit commit checkpoints.

## Execution sequence

1. Fit landing, auth, and Form with shared spacing and viewport tokens. Move the
   closing footer into its own grid row. Keep input targets at least 44px. Pair
   auth fields on desktop and preserve stacked mobile auth. Replace the Form
   introduction with a small illustration beside the heading. Group optional
   fields in a row and preserve their values and behavior.
2. Apply one landing type rhythm using panel three as the reference. Keep the
   opening hero distinct. Use a horizontal sketched navigation cue. Trigger
   entrances once with IntersectionObserver, pause offscreen work, lazy-load
   the capture, and run Lenis frames only while scrolling.
3. Let Calendar use the full workspace width. Reduce heading and toolbar overhead,
   retain scrollable readable timelines, improve date borders, event cards and
   month rows. Keep working hours, category colors, Day/Week/Month and details.
4. Remove simulated provider progress. Define a bounded MCP tool catalogue shared
   by the Ask planning loop and authenticated backend tool endpoint. The model
   selects tools; app.py validates arguments, owner and allowed mutation intent.
   Preserve text-only answers and conversational confirmation for bulk deletion.
5. Expose calendar occupancy, known Gmail confirmations, planning and owned Google
   block writes through tools. All mutations go through existing Action validation,
   scheduling and undo. Return confirmed provider outcomes separately from local
   capture. Show failures and incomplete calendar knowledge explicitly.
6. Add an iCloud CalDAV provider and Settings connection flow. Use a real CalDAV
   client with recurrence/timezone support, server-side encrypted app passwords,
   and a common provider contract. Read busy time by default; write capability is
   a pending product decision because the current PRD permits Google writes only.
7. Verify the affected routes with realistic content, empty/error states, mobile,
   keyboard use, reduced motion and provider failures. Update documentation to
   describe the implemented boundaries and actual connection requirements.

## Acceptance and evidence

| Brief | Pass condition | Evidence needed |
| --- | --- | --- |
| 1 | Final panel and footer fit at laptop sizes, beta bar included | Bounds and screenshots at 1366x768, 1440x900, 1920x1080 |
| 2 | Matching labels, heading/body hierarchy, side padding and handwriting | All four panels, computed shared type values |
| 3 | No idle RAF loop or scroll-driven React updates; offscreen assets deferred | Runtime idle/scroll instrumentation and image requests |
| 4 | Entrances trigger once; reduced motion disables them | Scroll forward/back and reduced-motion browser check |
| 5 | Keep going arrow points horizontally to Features | Screenshot and mouse/keyboard navigation |
| 6-7 | Both auth routes fit normal desktop height, full forms and footer visible | Route and size matrix, email/login behavior tests |
| 8 | Calendar uses workspace, dates/events and working hours remain readable | Day/Week/Month screenshots and event detail interactions |
| 9-10 | All Form fields and submit fit laptop; blank duration retains existing policy | Browser bounds, task/event HTTP tests and form submission |
| 11 | Gmail reads and Google reads/writes use explicit tools | Tool execution tests and connected provider response |
| 12 | Real CalDAV adapter supports iCloud and feeds planner through shared contract | Adapter recurrence/timezone tests and account connection |
| 13 | Model cannot access credentials or bypass owner/action permissions | Endpoint and model-boundary tests, request inspection |
| 14 | Project/deadline scenario reads commitments, explains plan, books only permitted actions | End-to-end scenario, conflict and failure cases, UI refresh |
| 15 | Shared layout values work on specified desktop, tablet and mobile sizes | Responsive matrix and no unintended horizontal overflow |
| 16 | No added animation dependency, no offscreen continuous work or major layout shifts | Build, browser timing and animation instrumentation |
| 17 | Existing identity, categories, sidebar and Form/Ask concepts preserved | Compare all changed screens with supplied references |
| 18 | Every affected route visually audited and integrations truthful | Final QA report, relevant tests, build, formatting, diff check |

## Integration constraints

- Retain one writer and one watcher. No extra tables or background processes.
- Calendar event bodies, attendee details and credentials never reach Gemini.
  Gmail uses the existing known-sender deterministic parser; return extracted
  scheduling facts rather than arbitrary inbox content to the model.
- Use the existing Google scopes. CalDAV passwords stay in server-side owner
  settings encrypted at rest and never return in status responses or tool output.
- MCP tool calls validate server-derived ownership; never accept owner IDs from
  a model or tool caller. Reject unknown tools and invalid arguments.
- Calendar reads subtract busy periods from working hours. Provider failure must
  be visible and must not imply that unknown remote periods are available.
- Local capture survives provider failures. External success requires a provider
  confirmation; replaying a write must not create duplicate blocks.
- No deployment, production connection changes, or live calendar mutations are
  needed to implement the patch. Live provider verification requires a connected
  account and a designated test block, with removal after checking.

## Verification status

Verified implementation: Form fits its 680px desktop viewport with every field and submit visible.
Login and signup fit 1366x768, 1440x900, and 1920x1080 including their footer. All four landing
panels fit the 744px area below the beta bar at 1366x768; the final footer ends inside the viewport.
The 390x844 landing, Form, and Calendar have no horizontal document overflow.

Ask uses model-selected, bounded read tools and returns actual tool outcomes. The authenticated MCP
endpoint exposes availability, Gmail confirmations, plan preview, and explicitly confirmed plan
application. Google retries and deletes verify Cooper's private ownership tag. iCloud credentials
are encrypted per owner, CalDAV recurrence expansion feeds the shared busy-time pipe, and iCloud
remains read-only under the PRD's Google-only write rule. Gmail confirmation parsing now retains
safe meeting links and locations without storing message bodies.

Final checks: backend `304 passed`; frontend `154 passed`; production frontend build passes; Ruff
passes; `git diff --check` passes. Live screenshots cover landing, final CTA, signup, Form, Settings,
and Calendar at desktop and mobile sizes. The browser console has no application errors. Live
external Google/Gmail/iCloud calls were not made because no designated test account or event was
provided; provider behavior is covered with transport and API tests.

## Rollback

Revert only this task's changes, preserving the earlier uncommitted checkout work.
Disconnecting a provider removes its credential, not locally captured tasks.
Existing undo reverses Cooper-owned creation and scheduling. No production
configuration or database schema changes are part of this specification.
