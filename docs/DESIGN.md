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

Four sections — **Chat**, **Plan**, **Calendar**, **Settings** — inside a shell that reshapes itself by CSS
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

**The raw mascot art arrives on white paper, with a warm ground shadow under the feet**, roughly
`rgb(218, 204, 190)`. Dropped straight onto a neutral surface, that beige ellipse floats and
Cooper looks pasted on. Two earlier fixes were both wrong: cropping him inside a tinted circle
turned him into a contact photo in a chip, and fading the bottom of the image with a CSS mask
dissolved his feet along with the ground.

The fix is to cut the art out once, in Python, rather than hide the problem in CSS:

```
assets-src/mascot/*.{webp,jpeg}         raw, straight from the image model
tools/mascot_cutout.py                  flood fill from the frame edge, de-halo, trim, square
frontend/public/assets/mascot/*.webp     built, transparent, square, what the app loads
```

The flood fill only walks through light, unsaturated pixels, starting from the edge of the frame.
Cooper is drawn with a closed dark outline, so the fill cannot leak into his cream belly or muzzle
even though they are nearly paper-coloured — a plain colour threshold eats them, which is the trap.
The ground shadow goes because it is connected to the paper. White objects that are *enclosed* by
ink, like the laptop screen and the calendar cells, correctly survive.

Two more things the script does, both of which the interface depends on: it fades the two-pixel
antialiased rim so no white halo is left around the outline, and it squares every frame with equal
margins. The raw art ranges from 128×172 to 1408×768, and unequal aspect ratios made Cooper change
size from screen to screen inside a square box.

So `.mascot` has nothing to do but pick a size. No container, no mask, no crop. Do not add one.
And do not edit the pixels by colour alone: removing warm tones globally eats the shading and the
outlines, and the result looks damaged.

**Raw art is bigger than the art on screen, and that is on purpose.** The first set was 128–194px,
which the browser had to upscale for a 124px box on a 2× display, so the linework looked soft. New
art is generated at 1024px and built down to a 512px cap. Anything still soft in the interface is
old art that has not been regenerated yet.

**An image with baked-in colour cannot serve two themes.** The supplied wordmark was a webp with
dark ink baked in and vanished on black. It is gone entirely: Cooper's face plus his name in real
text is the identity now, in the top bar and in the rail, and text inherits the theme colour.

**Every number explains itself.** The score is a tappable disclosure showing its four terms. A
ranking you cannot interrogate is a ranking you stop trusting.

**Say what happened, offer to undo it.** One reply strip, one line, with undo attached. No
toasts stacking, no confirmation before the fact.

**One exception, and it is deliberate: the frame.** Tapping a day in the month grid, or any task
anywhere, opens a frame over a blurred app. This is not a dialog asking permission, it is the
detail view, opened because you asked for it, closed by Escape or by tapping outside. It replaced
two worse things: a panel under the month grid that shoved the calendar around as you tapped, and
a score breakdown that expanded inside a list row. Nothing that interrupts you may be a frame.

**Light and dark are both first class, and light is the default.** A calendar is a document, and
documents are light unless you ask otherwise. The tokens hang off `:root[data-theme="dark"]`, never
off `prefers-color-scheme`, so the theme is something you chose rather than something your laptop
decided. `appearance.ts` resolves the three options — light, dark, system — down to the two the CSS
knows about, and stores the answer in localStorage: it has to be readable before the first paint,
which rules out the database. Both themes are checked before shipping.

## Colour means two things, and they never overlap

**Category, on the calendar.** Academics is purple, work is blue, organizations is orange, and
personal is teal. Four hues, chosen so that a week is readable before you read any of it.

**Outcome, in the chat and on buttons.** Green is something gained or finished, red is something
removed or refused, blue is an answer rather than an action, and amber wants a look. These are
`--tone-good`, `--tone-bad`, `--tone-answer` and `--tone-attention`.

Personal used to be green. It is teal now, because green had to mean "done" everywhere without
ambiguity, and a green calendar block beside a green chat bubble made both meaningless. The
category palette is chosen around the semantic one, not the other way round.

## Copy

Plain and specific. "Put these in my calendar", not "Schedule". "Do this first", not "Priority:
high". Errors say what to do next: "Cooper is not running. Start it with…".

## Accessibility

Real buttons, labelled inputs, visible focus rings, `aria-pressed` on toggles. Decorative
mascots carry empty alt text. Motion respects `prefers-reduced-motion`. Every image has explicit
width and height so nothing shifts while loading.
