# Interface design

The interface uses a small token set, rounded surfaces, soft elevation, and light or dark themes.
Tokens live in `frontend/src/theme.css`.

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

Keep responsive rules at the end of the stylesheet. Their source order lets them override
component defaults without a width listener.

Use grouped cards with hairline row separators for settings and related values. Keep the content
column constrained for reading, except for calendar grids that need the available width.

## Conversation

Chat is the input surface for sentence and question requests. User messages appear on the right;
Cooper replies appear on the left with the reply tone and, when relevant, the mascot.

Mutation replies include the parsed title and fields so the result can be checked in place. An
answer remains text and cannot mutate data. A success reply names COOPER and reflects the refreshed
committed state, including its actual time. Waiting, overlap, and provider-health warnings stay in
the reply instead of being hidden by optimistic copy. Conversation history stays in `localStorage`,
capped at sixty turns.

Suggested Ask prompts are typed product questions, not generic chatbot starters. Their labels map
to bounded planning intents and render the backend's message, facts, and warnings from the same
snapshot used by Calendar. Do not compose a second recommendation in the browser.

## Offline behavior

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
