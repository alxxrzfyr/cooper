# Continuous corner system

Date: 2026-09-20
Status: Proposed for implementation

## Purpose

Make continuous, Apple-style geometry the default visual language across Cooper without copying
Liquid Glass materials or changing product behavior. Rounded rectangular surfaces should use a
true superellipse curve, nested surfaces should be concentric, and semantic capsules and circles
should remain geometrically correct.

This serves the existing interface and responsive-layout requirements in `PRD.md`. It introduces
no new product capability, dependency, data path, or background work.

## Research basis

Apple's current design system uses three shape families: fixed rounded rectangles, capsules, and
concentric shapes. Nested corners are calculated from their container so their centers align. In
practice, the inner radius equals the outer radius minus the intervening padding. Capsules use a
radius equal to half their height, while circles remain circles.

The web implementation will use the standardized CSS `corner-shape: squircle`, which is equivalent
to `superellipse(2)` in CSS Borders Level 4. Its exponent-four superellipse transitions into its
straight sides with continuous tangent and curvature. Chrome has shipped this primitive, and
WebKit reports support. Browsers that do not recognize `corner-shape` will ignore it and retain the
existing `border-radius` geometry.

Primary references:

- [Apple: Get to know the new design system](https://developer.apple.com/videos/play/wwdc2025/356/)
- [Apple: Build a SwiftUI app with the new design](https://developer.apple.com/videos/play/wwdc2025/323/)
- [CSS Borders and Box Decorations Level 4](https://www.w3.org/TR/css-borders-4/)
- [Chrome 139 corner-shape release notes](https://developer.chrome.com/release-notes/139)
- [WebKit CSS feature status](https://webkit.org/css-status/)

## Design principles

### Continuous rectangles are the default

Every Cooper element that is visually a rounded rectangle uses a squircle corner curve. This
includes cards, panels, fields, menus, rows with exposed corners, calendar surfaces, frames,
composer surfaces, navigation selections, notices, onboarding surfaces, and public/auth content.

The default is structural rather than opt-in. New rounded rectangular elements should inherit the
continuous-corner treatment without requiring a new component or utility class.

### Capsules and circles remain round

Apple's system does not turn every shape into a squircle. Elements whose meaning depends on their
geometry are explicit exceptions:

- Capsules: tags, compact badges, segmented-control tracks or thumbs where the radius is half the
  control height, and prominent pill actions.
- Circles: icon buttons designed as circles, status dots, radio-like indicators, avatars, spinner
  rings, and circular today/date markers.
- Deliberately square or edge-attached regions: calendar grid cells, separators, full-width bars,
  and sheet edges that meet the viewport.

These exceptions use `corner-shape: round` or retain a zero radius. The visual audit must verify
that a global default has not changed them into rounded squares.

### Nested surfaces are concentric

For nested rounded rectangles:

```text
inner radius + gap between surfaces = outer radius
```

The implementation should calculate or choose radii from actual component padding, rather than
applying the largest token everywhere. When a component's padding changes responsively, its inner
radius must continue to feel centered within the outer curve.

## Shape tokens

The existing radius scale becomes a named continuous-corner scale:

| Token | Radius | Intended use |
| --- | ---: | --- |
| `--r-sm` | 10px | Compact controls and small nested surfaces |
| `--r-md` | 14px | Fields, navigation selections, regular controls |
| `--r-lg` | 20px | Cards and primary workspace surfaces |
| `--r-xl` | 28px | Large containers, frames, and hero surfaces |
| `--pill` | 999px | Capsules only |

`--corner-continuous` stores `squircle`, and `--corner-round` stores `round`. The radius still
controls the size of the corner; the corner-shape token controls its curvature.

These values preserve Cooper's existing soft scale while making the large 20px-to-28px nesting
relationship exact at an eight-pixel gap. A component that requires an intermediate concentric
radius should derive it locally with `calc()` from its container radius and padding rather than
introducing another global token.

## CSS architecture

The implementation stays in the existing stylesheets.

1. Add the two corner-shape primitives beside the radius tokens in `frontend/src/theme.css`.
2. Establish the continuous curve as the default inside both authenticated and public `.app`
   contexts, including pseudo-elements. Since `corner-shape` only affects boxes with a non-zero
   radius, square layout primitives remain unchanged.
3. Add explicit round overrides to the existing selectors for semantic capsules and circles.
4. Replace isolated raw rounded-rectangle radii with the nearest token where doing so preserves the
   component's size and concentric relationship.
5. Apply the same taxonomy in `frontend/src/landing/landing.css`; do not create a second radius
   system for public pages.
6. Update `docs/DESIGN.md` so the three shape families and concentric formula become the rule for
   future UI work.

No JavaScript shape measurement, SVG mask, clipping library, generated path, or new dependency is
needed. Native browser corner rendering preserves borders, shadows, overflow clipping, focus
outlines, hit testing, and responsive dimensions.

## Browser behavior

The base `border-radius` declarations remain valid and continue to provide a complete fallback.
Supported browsers add the superellipse curvature through `corner-shape`. Unsupported browsers
display Cooper's current circular rounded corners, with no loss of content or interaction.

The implementation must not hide content behind a mask or require feature detection in React.
CSS progressive enhancement is sufficient.

## Scope

Included:

- Authenticated desktop and mobile shells
- Expanded and collapsed desktop rails
- Home, Cooper, Calendar, Form, Settings, onboarding, notices, and frames
- Composer and bottom navigation
- Public landing, authentication, legal, and account-state surfaces
- Light and dark appearances
- Loading, empty, error, hover, active, and focus states

Excluded:

- Liquid Glass blur, refraction, tint, or lensing effects
- Typography, color, spacing, or content changes unrelated to concentricity
- Backend, database, provider, or authentication behavior
- Mascot artwork and raster asset clipping
- New dependencies or reusable React wrapper components

## Accessibility and interaction

Corner changes must not reduce touch-target sizes, alter focus order, or clip three-pixel focus
outlines. Existing contrast and reduced-motion behavior remain unchanged. Overflow clipping is only
retained where it already serves content containment; it must not be added merely to reveal the new
shape.

## Validation

### Automated

- Run the full frontend test suite.
- Run Prettier's format check.
- Run the production build.
- Run `git diff --check`.
- Run the Impeccable detector against both frontend stylesheets.

### Visual

Inspect the running application in light and dark appearances at desktop and mobile sizes:

- Public landing and auth surfaces
- Home cards and rows
- Cooper bubbles, mode control, and composer
- Calendar Day, Week, and Month
- Form fields and segmented controls
- Settings groups and account states
- Frames, notices, loading states, and empty states
- Expanded and collapsed desktop rails
- Mobile top bar and bottom navigation

For each surface, verify:

- Rounded rectangles have continuous corners.
- Circles remain circular and capsules remain capsules.
- Nested surfaces share a visual corner center.
- Borders, shadows, focus outlines, and clipped content follow the same curve.
- The fallback remains usable when `corner-shape` is disabled.

## Acceptance criteria

The work is complete when continuous superellipse corners are the default across Cooper's app and
public contexts; semantic circles and capsules remain correct; nested surfaces are concentric;
unsupported browsers retain the existing rounded-corner fallback; no behavior changes; automated
checks pass; and the required responsive visual states have been inspected.
