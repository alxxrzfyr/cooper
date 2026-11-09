# Interface design

This document owns visual and interaction contracts. [PRD.md](../PRD.md) owns planning behavior.
[Architecture](../ARCHITECTURE.md#planning-pipeline) explains its implementation. Use the relevant
section rather than copying rules into feature notes.

## Visual system

Tokens live in `frontend/src/theme.css`. Use rounded surfaces, soft elevation, and light and dark
themes. Preserve the owner-selected gradient Cooper wordmark and its light and dark variants on app
and public pages.

| Token      | Light     | Dark      |
| ---------- | --------- | --------- |
| Background | `#F2F2F7` | `#000000` |
| Card       | `#FFFFFF` | `#1C1C1E` |
| Raised     | `#E9E9EE` | `#2C2C2E` |
| Text       | `#1C1C1E` | `#F2F2F7` |
| Muted      | `#6B6B70` | `#98989E` |
| Accent     | `#0A84FF` | `#0A84FF` |

### Shape and color

- Rounded rectangles use a `border-radius` fallback plus `corner-shape: squircle`, on the shared
  10, 14, 20, and 28px scale. Nested surfaces are concentric, so inner radius plus the gap equals
  outer radius.
- Capsules use a half-height radius and `corner-shape: round`. Keep circles round.
- Typography starts with `ui-rounded`, then available system rounded fonts. Use existing soft
  shadows and translucency rather than adding borders to components that do not use them.
- Categories are academics purple, work blue, organizations orange, and personal teal. No fifth
  category.
- Outcomes are green `#30B15C` for added or completed, red `#FF3B30` for removed or refused, blue
  for answers, and amber `#FF9F0A` for inspection. State colors are not category colors.

## Workspace layout and interactions

Both navigation variants render, and CSS selects at 900px. Narrow screens use the top bar,
scrolling content, composer, and bottom tabs. Wide screens use the left rail and hide the top bar.
Keep responsive rules at the stylesheet end, without a viewport-width listener.

`Nav` owns its persisted open or collapsed preference. Change rail width once, not with a tween that
reflows the workspace repeatedly. Retain the chevron transform animation and reduced-motion support.
Constrain reading columns except calendar grids. Group related settings in cards with hairline row
separators.

- Expose score reasons in a disclosure.
- Derive day counts and density from all normalized commitments. Retain source identity and
  read-only status without hiding external events.
- Use canonical snapshot references for Now, Next, and risks instead of duplicating item cards.
  Never label unchecked provider time free.
- Show known estimated demand and unknown-task counts in Rest of today. Candidate slots are
  unsaved, and partial assessment is not zero work. Show the earliest legal start for a
  recommendation.
- Estimate controls open existing details, preserve failed drafts, and close after saving.
  Onboarding and availability settings disclose the server timezone.
- Put Undo on mutation replies, not stacked toasts. Detail frames close on Escape or an outside
  click. They are not confirmation dialogs.
- Store light, dark, or system appearance in `localStorage`. Resolve system before applying CSS.

## Conversation and voice

User messages appear right, and Cooper replies appear left with the appropriate outcome tone.
Cooper is a cheerful, jolly otter: warm, lightly playful, concise, encouraging, and practical.
Never guilt the person, become chatty, adopt another role, pretend to have feelings or
capabilities, or claim a change without application evidence. One compact identity prompt serves
parsing and answers. Voice does not grant tools or mutation permission.

Mutation replies show title, parsed fields, and the actual committed time in COOPER, retaining
waiting, overlap, and provider warnings. Answers remain text-only. Conversation history is local
to the browser in `localStorage`, capped at sixty turns.

Suggested Ask prompts map to bounded product intents. Render backend message, facts, and warnings
from the shared snapshot. Do not invent a second browser recommendation.

## Public landing

Preserve chapter order, typography, artwork scale, inner feature designs, and existing motion. The
plans chapter sits between product proof and the final signup invitation, using warm paper surfaces
and forest-green actions. Changing a section canvas does not authorize redesigning its inner
feature composition.

### Scrolling and responsive layout

- Horizontal chapters begin at 900px, independent of height. Below that width, retain vertical flow.
- Vertical wheel input drives smooth horizontal Lenis travel, including over FAQ disclosures. Do
  not add nested-scroll bypass. Preserve existing RAF and entry effects.
- Hide section scrollbars without disabling overflow, clipping text, or losing keyboard and touch
  access.
- Horizontal arrow navigation must not intercept links, buttons, or FAQ summaries. Authenticated
  workspace scrolling is unchanged.
- Use zero-minimum fractional tracks, flexible columns, and content-height cards or stages rather
  than fixed desktop minimums. Do not shrink established heading and artwork sizes just to fit a
  short viewport or require zoom for a readable layout.
- Zoom uses the CSS viewport and existing 900px breakpoint, not a separate listener. Extreme short
  heights must retain overflow access.

### FAQs and plans

- Center the FAQ and pricing group with flex auto margins so its top remains reachable when taller
  than the viewport. Desktop subgrid rows align headings, introductions, and content edges. Plan
  cards share title, price, benefit, and action rows.
- Keep expanded answers in normal flow. Native `details` and `summary` use `name="cooper-faq"`,
  begin closed, and allow one answer open. Preserve the delegated closing fallback for browsers
  without named-group support, visible focus, and native keyboard behavior.
- Narrow layouts stack with fluid gutters. Plan cards stack below 560px.
- Free beta links to `/signup`. Plus is disabled and coming soon, not checkout. Prices, allowances,
  and paid workflows are proposed. State that no user API key is needed and model help stays off
  until Cooper-funded AI is enabled.

### Connection and authentication artwork

Connected-source art uses content-sized grid slots. Planned labels stay outside the calendar image,
live sources occupy their own column, and annotation and mascot share a non-overlapping flex row.
Each planned label owns its arrow and connector space. No fixed-coordinate SVG overlay. A named
inline-size container switches the diagram to two columns at 560px of its own width, without
changing chapter navigation.

Login and signup have separate visual compositions. Keep the login illustration centered with
proportional panel insets at desktop and compact sizes. Do not impose login sizing on the signup
collage.

## PWA and mobile

The service worker (`frontend/public/sw.js`) precaches the shell, never API responses.
Installability does not promise offline data editing or reliable closed-app reminders. The accepted
scope remains [one responsive web/PWA](decisions/2026-09-30-web-first-product-boundary.md), not
native clients or separate agent dashboards.

Use `viewport-fit=cover` and safe-area variables. Composer text stays at least 16px to avoid mobile
focus zoom. Do not scale the entire viewport to simulate responsive layout.

## Copy and accessibility

Use plain labels such as “Put these in my calendar” and “Do this first.” Errors state a next
action. Use real buttons, labeled inputs, visible focus, and `aria-pressed` toggles. Decorative
mascot images have empty alt text. Set image dimensions to prevent layout shifts and respect
`prefers-reduced-motion`.

Before visual acceptance, check rendered widths, real browser resize and zoom, the longest FAQ
answer, and keyboard and touch overflow. Passing DOM tests is not visual acceptance.

## Mascot assets

| Path                                   | Purpose                                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `assets-src/mascot/*.{webp,jpeg}`      | Source art                                                                                    |
| `tools/mascot_cutout.py`               | Removes edge-connected background, fades the rim, trims and centers, and caps output at 512px |
| `frontend/public/assets/mascot/*.webp` | Transparent runtime images                                                                    |

The cutout keeps light pixels enclosed by the outline and preserves alpha edges. Use the mascot to
communicate active work, empty state, ambiguity, or backend failure, not as extra decoration.

## Historical measurements

On 2026-10-01, local headless Chromium measured ten rail toggles at 1366×768. Removing the width
tween reduced scripting from 419ms to 233ms at normal CPU speed and 2045ms to 890ms at 4×
throttling. An isolated comparison recorded 68 main-content resize callbacks with tweening versus
11 without, including initial observation. These synthetic development-build results are not
real-device frame-rate or production guarantees.
