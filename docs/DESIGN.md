# Interface design

The interface uses a small token set, rounded surfaces, soft elevation, and light or dark themes.
Tokens live in `frontend/src/theme.css`.

Home's "Rest of today" summary displays known estimated minutes and an explicit
unknown-task count. Partial assessment is never a zero-work verdict. Candidates
are unsaved and come from scheduling all open local tasks over seven days; the
demand cohort includes only unscheduled work still due today. Unavailable calendars
suppress slot and gap claims. Now recommendations show the earliest legal start.
Estimate buttons open existing task details, retain failed drafts, and close after
saving. Onboarding and availability settings display the fixed server timezone.

## Tokens

```text
                light        dark
background      #F2F2F7      #000000
card            #FFFFFF      #1C1C1E
raised          #E9E9EE      #2C2C2E
text            #1C1C1E      #F2F2F7
muted           #6B6B70      #98989E
accent          #0A84FF      #0A84FF
```

Green `#30B15C`, amber `#FF9F0A`, and red `#FF3B30` are reserved for state. Category colours
are purple, blue, orange, and teal.

Rounded rectangles use native continuous corners: keep `border-radius` as the fallback and apply
`corner-shape: squircle`. Use the shared 10, 14, 20, and 28px radius scale. Nested rounded
rectangles are concentric: inner radius plus the gap between surfaces equals outer radius. Capsules
use a radius equal to half their height and `corner-shape: round`; circles remain round. Do not turn
semantic capsules or circles into squircles. The font stack starts with `ui-rounded`, followed by
the available system rounded fonts. Use soft shadows and translucent surfaces instead of borders
where the surrounding component already uses them.

## Layout

The app renders both navigation variants. CSS selects the right one at 900px:

- Narrow screens use a top bar, scrolling content, composer, and bottom tabs.
- Wide screens use a left rail and hide the top bar.

The sidebar's open/collapsed state and stored preference belong to `Nav`, so a
toggle does not rerender the workspace. Its width changes once; the chevron keeps
its transform animation and reduced-motion support. Do not tween the rail width,
which repeatedly reflows the main content.

Local headless Chromium measurements on 2026-10-01 used ten toggles at 1366×768.
Scripting time fell from 419ms to 233ms at normal CPU speed, and from 2045ms to
890ms under 4× throttling. An isolated width comparison produced 68 main-content
resize callbacks with the tween versus 11 without it, including the initial
observation. These are synthetic development-build measurements, not real-device
frame-rate or production performance guarantees.

Keep responsive rules at the end of the stylesheet. Their source order lets them override
component defaults without a width listener.

Use grouped cards with hairline row separators for settings and related values. Keep the content
column constrained for reading, except for calendar grids that need the available width.

## Conversation

Chat is the input surface for sentence and question requests. User messages appear on the right;
Cooper replies appear on the left with the reply tone and, when relevant, the mascot.

Cooper is a cheerful, jolly otter companion for the person's own tasks, events, and time. The
voice is warm, encouraging, lightly playful, concise, and practical. It never guilts the person,
becomes chatty, pretends to have feelings or capabilities, adopts another role, or claims an
action happened unless the application reports it. One compact identity prompt serves both the
action parser and answer path; voice never grants tools or permission to mutate state.

Mutation replies include the parsed title and fields so the result can be checked in place. An
answer remains text and cannot mutate data. A success reply names COOPER and reflects the refreshed
committed state, including its actual time. Waiting, overlap, and provider-health warnings stay in
the reply instead of being hidden by optimistic copy. Conversation history stays in `localStorage`,
capped at sixty turns.

Suggested Ask prompts are typed product questions, not generic chatbot starters. Their labels map
to bounded planning intents and render the backend's message, facts, and warnings from the same
snapshot used by Calendar. Do not compose a second recommendation in the browser.

## Landing plans and FAQs

The `plans` chapter sits between product proof and the final signup invitation.
It inherits the landing's warm paper, forest-green actions and existing typography;
preserve the chapter order, illustration compositions and motion. The FAQ/pricing
group uses flex auto margins to center safely when it fits. On desktop, shared
subgrid rows align both headings, introductions and the FAQ/card starting edges;
plan cards also share title, price, benefit and action rows. Expanded answers remain
in normal flow rather than overlapping other questions. On narrower screens the
columns become a single content-height stack, with fluid gutters. Plan cards
stack below 560px. Native `details`/`summary` disclosures share `name="cooper-faq"`
so only one answer opens at a time; all begin closed. A delegated summary-click
fallback closes other answers where native named groups are unsupported. Preserve
visible focus and native keyboard activation.

Horizontal chapters retain the original 900px width breakpoint, independent of
window height. Narrower screens retain vertical flow. Hide section scrollbars while
preserving overflow access. Vertical wheel input drives smooth horizontal travel
on desktop, including over FAQ answers; do not enable Lenis nested-scroll bypass.
Do not clip content or remove keyboard/touch
access. Arrow-key chapter navigation applies only in horizontal mode and must not
intercept links, buttons or FAQ summaries. Authenticated-app scrolling is unchanged.

Desktop chapter columns use zero-minimum fractional tracks instead of fixed pixel
minimums. Preserve the established heading sizes and artwork scale at 100% zoom;
do not shrink all chapters or switch FAQ/pricing into smaller type merely because
the viewport is short. Layout should reflow instead of requiring 110% zoom.
Feature/proof cards and the closing stage grow with their content. Connected-source
art uses content-sized grid slots: planned labels stay outside the calendar image,
live sources occupy their own column, and the annotation and mascot share a flex
row without overlapping. Each planned label owns its decorative arrow and reserved
connector space; never combine independent label offsets with a fixed-coordinate
SVG overlay. A named inline-size container reflows that diagram into two columns
when its own content width is 560px or less. This does not change chapter navigation.
Zoom
changes the CSS viewport and uses the same 900px breakpoint, not a separate zoom
listener. At extreme short heights, preserve overflow access rather than clipping
text to force a fit. Real browser resize/zoom acceptance is still required.

The Free beta CTA links to signup. Plus is a disabled coming-soon action, not a
checkout. Prices, AI allowances, and paid workflows are labeled proposed; the FAQ
states that no API key is needed and that model help stays off until Cooper-funded
AI is enabled. Never turn proposed benefits into claims of shipped subscription functionality.

## Offline behavior

Product-refinement contracts are in the
[web-first decision](decisions/2026-09-30-web-first-product-boundary.md).

One responsive web/PWA is the owner-approved boundary. No native app work, separate
agent dashboards or viewport scaling. Real rendered widths, browser zoom, longest
FAQ expansion and keyboard/touch overflow acceptance remain required.

The PWA precaches the application shell. `frontend/public/sw.js` never caches API responses, so
an offline view cannot present stale task data as current.

Use `viewport-fit=cover` and the safe-area environment variables for devices with an inset. Keep
composer text at 16px or larger so mobile browsers do not zoom the page on focus.

## Mascot assets

Source images may include a light background and ground shadow. Run `tools/mascot_cutout.py` to
remove connected background pixels, fade the antialiased rim, trim the image, and centre it in a
square canvas.

```text
assets-src/mascot/*.{webp,jpeg}          source images
tools/mascot_cutout.py                   build script
frontend/public/assets/mascot/*.webp     transparent images used by the app
```

The script keeps light pixels enclosed by the mascot's outline and removes only background pixels
connected to the frame edge. It caps output at 512px and preserves alpha at the edge.

Use the mascot where it communicates state: beside active work, in an empty state, for an
ambiguous reference, or when the backend is unavailable. Do not add decorative mascot instances.

## Public authentication visuals

Login and signup use separate responsive compositions inside the public auth visual panel. The
login illustration stays centered with a small inset from the panel edges so the mascot has room to
breathe at desktop and compact viewport sizes. Keep that inset proportional when adjusting the
illustration; the signup collage has its own layout and should not inherit the login sizing.

## Interaction rules

- Show score details in a disclosure instead of making users infer the ranking.
- Derive badges and per-day density from every normalized commitment, regardless of source; retain
  source identity for detail and editability without making external events visually disappear.
- Put undo on the mutation reply instead of using stacked toasts.
- Use a frame for requested detail, not for permission. Close it with Escape or an outside click.
- Keep light, dark, and system appearance choices in `localStorage`. Resolve system to light or
  dark before applying CSS.

## Colour semantics

Category colour identifies the kind of item:

- Academics is purple.
- Work is blue.
- Organizations is orange.
- Personal is teal.

Reply and action colour identifies the outcome. Green means added or completed. Red means removed
or refused. Blue means an answer. Amber means the user needs to inspect something.

## Copy and accessibility

Use plain, specific labels such as "Put these in my calendar" and "Do this first". Errors state
the next action.

Use real buttons, labelled inputs, visible focus styles, and `aria-pressed` on toggles. Give
decorative mascot images an empty alt value. Respect `prefers-reduced-motion`, and set explicit
image dimensions to prevent layout shifts.
