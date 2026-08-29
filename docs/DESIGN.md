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

## Rules

**One screen.** Hero, list, composer. No navigation, because there is nowhere else to go.

**The composer is the app.** It sits at the bottom, always reachable, `⌘K` to focus. It is not a
chat transcript: you type, something changes, the screen reflects it. A scrolling conversation
would mean re-reading your own messages to find your own tasks.

**The mascot is the character, not the wallpaper.** It appears where it means something — working
at a laptop next to the current task, waving in the empty state, unplugged when the calendar is
disconnected. Never as filler.

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
