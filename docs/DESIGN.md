# The look

Apple structure, Google colour, rounded throughout. Reference point: Tarsi by Bryl Lim — a
Philippine finance app where you type "Starbucks 250" and it just records it. Same shape of idea,
same kind of interface, and its mascot is the product rather than decoration.

## Tokens

Defined once in `frontend/src/theme.css`. Change them there and nowhere else.

```
                light        dark
background      #F5F5F7      #000000
card            #FFFFFF      #1C1C1E
raised          #FFFFFF      #2C2C2E
text            #1D1D1F      #F5F5F7
muted           #6E6E73      #98989D
accent          #0A84FF      #0A84FF
```

Also green `#30B15C`, amber `#FF9F0A`, red `#FF3B30`, used only for state.

Radii 10 / 14 / 20 / 28 and pills. Type is `ui-rounded` with SF Pro Rounded and Nunito behind
it. Depth is soft shadows and a blurred translucent composer, never borders.

The accent is one line. Swapping to green `#30B15C` or indigo `#5E5CE6` is a single edit.

## Structure

Three sections — **Chat**, **Plan**, **Setup** — inside a shell that reshapes itself by CSS
alone, with no width listener and nothing to keep in sync:

- **Narrow** — frosted top bar, scrolling content, frosted composer, frosted bottom tab bar.
- **Wide (900px and up)** — the same tabs become a left rail and the top bar disappears.

Both navigations are always in the markup; the breakpoint decides which is visible. Those rules
live at the *end* of the stylesheet on purpose: they override component defaults, and with equal
specificity source order is what decides. Putting the breakpoint earlier meant a later
`.tabbar { display: flex }` quietly won and the tab bar stayed on desktop.

Content uses inset grouped lists: a rounded card with hairline dividers between rows, the way iOS
settings look.

## It is a conversation

Chat is the home, because talking to it *is* the idea. Your words on the right in accent blue,
the otter's on the left with its face, and a typing indicator while it thinks.

When the otter changes something the reply carries an **understood card** — title plus the fields
it extracted. That card is how a wrong parse becomes obvious at a glance, which is what earns the
right to have no confirmation step. Asking "what should I do first" is answered *in the
conversation* rather than pointing at another tab.

History lives in `localStorage`, capped at sixty turns. No table, no endpoint.

## PWA

Installable and it opens offline. `manifest.webmanifest` with maskable icons, and a hand-written
service worker in `public/sw.js` — two rules and about forty lines, which is less machinery than a
plugin.

The shell is precached. **API responses never are:** a stale task list is worse than an honest
error, and the app already says plainly when it cannot reach the backend.

`viewport-fit=cover` plus `env(safe-area-inset-*)` so the frosted bars sit correctly under a notch
and a home indicator. The composer input is 16px, which is what stops iOS zooming on focus.

**The mascot is the character, not the wallpaper.** It appears where it means something — working
at a laptop beside the current task, waving in the empty state, puzzled when a reference is
ambiguous, tired when the backend is down. Never as filler.

## Assets: the two traps

Both of these made the interface look wrong on first attempt, and both are worth knowing before
touching an image.

**The mascot art has an opaque warm ground shadow baked under the feet**, roughly
`rgb(218, 204, 190)`. Dropped straight onto a neutral surface, that beige ellipse floats and the
otter looks pasted on. So a mascot is *always* inside a shaped container — `.mascot--round` or
`.mascot--squircle` with `object-fit: cover` and the focus high in the frame, which crops the
ground away. Never render one without a container.

Do not try to fix this by editing the pixels. Removing the warm tones programmatically eats the
shading and the outlines, and the result looks damaged. Containment is the fix.

**The supplied wordmark is a webp with dark ink baked in**, averaging `rgb(113, 123, 118)`, so it
almost vanished on black. The brand is now inline SVG plus real text in `Brand.tsx`, which
inherits the theme colour. The leaf has its own variable, `--leaf`, because the supplied green is
too dark to read on black.

The lesson generalises: an image with baked-in colour cannot serve two themes. Draw it or give it
a container.

**Every number explains itself.** The score is a tappable disclosure showing its four terms. A
ranking you cannot interrogate is a ranking you stop trusting.

**Say what happened, offer to undo it.** One reply strip, one line, with undo attached. No
toasts stacking, no modals, no confirmation before the fact.

**Light and dark are both first class.** Written with `prefers-color-scheme`, and both are
checked before shipping.

## Copy

Plain and specific. "Put these in my calendar", not "Schedule". "Do this first", not "Priority:
high". Errors say what to do next: "Cadence is not running. Start it with…".

## Accessibility

Real buttons, labelled inputs, visible focus rings, `aria-pressed` on toggles. Decorative
mascots carry empty alt text. Motion respects `prefers-reduced-motion`. Every image has explicit
width and height so nothing shifts while loading.
