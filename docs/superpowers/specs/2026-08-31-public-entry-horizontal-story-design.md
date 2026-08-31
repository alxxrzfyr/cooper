# Public Entry and Horizontal Story Design

## Goal

Make Cooper's public landing page the default web entry point while keeping the private workspace explicit and predictable. A first visit should explain Cooper before asking someone to connect an account or open the app.

## Route contract

| Path       | Surface                | Access                                |
| ---------- | ---------------------- | ------------------------------------- |
| `/`        | Landing story          | Public                                |
| `/landing` | Landing story          | Public                                |
| `/login`   | Sign-in entry          | Public                                |
| `/signup`  | Account creation entry | Public                                |
| `/terms`   | Terms                  | Public                                |
| `/privacy` | Privacy                | Public                                |
| `/app`     | Cooper workspace       | Local mode or signed-in Firebase user |

Unknown paths keep the public landing fallback. A signed-in visitor arriving from the landing, login, or sign-up route is moved to `/app`; legal pages remain directly addressable.

## Story behavior

On laptop and desktop, the landing story owns the viewport (`100dvh`) and advances horizontally through snap-aligned chapters. The document itself must not gain a vertical scrollbar. Pointer dragging, wheel-to-horizontal conversion, keyboard arrows, pager controls, and a visible progress indicator remain available.

On mobile, the same chapters become a normal vertical document. Copy and the primary action appear before the mascot artwork so the first interaction is reachable without hunting. No desktop fixed-position or overflow lock applies at the mobile breakpoint.

## Visual contract

- Keep Cooper's existing mascot, green wordmark, blue action color, and typography tokens.
- Use a quiet, fixed-height header; oversized mascot/product artwork; short outcome-led copy; one unmistakable primary action per chapter; and generous whitespace.
- Preserve the existing five-chapter content and its accessibility labels. This is a route and viewport behavior change, not a new marketing surface.
- Public pages must remain legible in both light and dark themes. Green remains reserved for completed state; public actions use the existing blue action treatment.

## Accessibility

- The horizontal track remains keyboard focusable and exposes next/previous controls with disabled states at the ends.
- Each chapter has a labelled heading and `scroll-snap-align`; progress text communicates the active chapter without relying on color alone.
- Mobile and reduced-motion users receive the same content without forced horizontal interaction.

## Verification

- Unit tests assert that local `/` renders the landing and local `/app` renders the workspace.
- Auth tests assert signed-in public auth routes settle on `/app` while legal routes remain public.
- A production build and full test suite pass.
- Chromium smoke checks confirm no desktop document scroll, horizontal chapter navigation, and normal mobile vertical scrolling at representative viewport sizes.

## Constraints

No new dependency, database table, OAuth scope, or background process. Manual mode remains offline and local mode remains usable without Firebase configuration.
