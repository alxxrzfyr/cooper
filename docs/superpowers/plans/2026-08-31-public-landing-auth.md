# Public Landing and Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give hosted, signed-out users a polished Cooper landing page with clear Firebase account creation and login actions while preserving local mode and the existing signed-in workspace.

**Architecture:** Keep the existing `App` auth boundary and add a focused `Landing` component for the Firebase signed-out state. The landing track is a native horizontal scroll-snap region on wide screens and a normal vertical flow below 900px; both auth intents call the existing Google redirect function. No backend, route, dependency, or database changes are needed.

**Tech Stack:** React, TypeScript, existing Firebase auth wrapper, CSS variables from `theme.css`, mascot WebP assets.

**Spec:** Approved in chat on 2026-08-31.

## Global Constraints

- Local mode must continue to bypass public auth and load the existing workspace.
- Firebase Google sign-in is the only auth provider; first sign-in creates an account.
- The app’s existing wordmark, mascot identity, colors, and light/dark tokens remain unchanged.
- Desktop landing content scrolls horizontally with keyboard-accessible anchors; mobile content scrolls vertically.
- No fake screenshot rectangles, external images, new dependencies, or public data writes.
- Preserve all existing user-generated mascot and UI edits in the working tree.

---

### Task 1: Landing component contract

**Files:**

- Create: `frontend/src/Landing.test.tsx`
- Create: `frontend/src/Landing.tsx`

**Interfaces:**

- Consumes: `busy`, `error`, and `onSignIn` props from `App`.
- Produces: a public landing surface with `Create account`, `Log in`, and `Continue with Google` controls.

- [x] Write the failing component tests.
- [x] Run `npm test -- --run src/Landing.test.tsx` and confirm the module is missing.
- [x] Implement the component and mascot-led content sections.
- [x] Run the focused tests and confirm they pass.

### Task 2: Landing visual system

**Files:**

- Create: `frontend/src/Landing.css`

**Interfaces:**

- Consumes: existing theme variables and semantic mascot assets.
- Produces: wide horizontal scroll-snap layout with explicit mobile vertical fallback, focus states, reduced-motion behavior, and hidden public app chrome.

- [x] Add the desktop track, wheel-to-horizontal behavior, anchor navigation, and mobile fallback.
- [x] Add light/dark-safe surfaces, responsive typography, and auth card states.
- [x] Render the page at desktop and mobile widths and fix clipping or overlap.

### Task 3: Auth boundary wiring

**Files:**

- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/Landing.css`

**Interfaces:**

- Consumes: existing `firebaseConfigured`, `authState`, `busy`, `failure`, and `signInWithGoogle` values.
- Produces: hosted signed-out users see only the landing surface; local and signed-in users keep the existing `Nav` and workspace.

- [x] Render `Landing` for Firebase signed-out state and preserve existing test selectors where possible.
- [x] Hide product navigation chrome visually while the public surface is active.
- [x] Keep sign-in errors inline and leave backend/API behavior unchanged.

### Task 4: Verification and commit

**Files:**

- No additional source files.

- [x] Run frontend tests, formatting, and build.
- [x] Run a browser smoke check in hosted-signed-out test mode and local mode.
- [x] Confirm only landing files/App and the plan are staged; preserve unrelated dirty files.
- [x] Commit with a conventional message explaining why the public entry surface exists.
