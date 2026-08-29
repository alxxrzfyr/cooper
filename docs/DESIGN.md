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

Two frosted bars with content between them, which is the Apple shape:

- **Top bar** — sticky, `backdrop-filter: blur(24px)` over a translucent background. Brand on the
  left, one contextual action on the right, the otter as an avatar.
- **Bottom tab bar** — fixed, same material. Today, Calendar, Setup. The Calendar tab carries a
  badge when work is booked.
- **Composer** — fixed above the tab bar, same material again, `⌘K` to focus.

Content uses inset grouped lists: a rounded card with hairline dividers between rows, the way iOS
settings look. Large title at the top of each tab.

## Rules

**The composer is not a chat log.** You type, something changes, the screen reflects it. A
scrolling transcript would mean re-reading your own messages to find your own tasks.

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
