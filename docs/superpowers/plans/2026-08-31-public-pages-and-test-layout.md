# Public Pages and Frontend Test Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Cooper a discoverable public page system with dedicated landing, login, signup, Terms, and Privacy pages while moving every frontend test into the existing `frontend/src/test/` folder.

**Architecture:** Keep the existing App auth boundary and add a small pathname-based public route switch with no new dependency. Production page components live in `frontend/src/landing/`; test files live in `frontend/src/test/`, preserving the existing Vitest setup file and local-mode behavior. Login and signup share one Google-only auth card, while legal pages share one static shell and state only facts already enforced by the app.

**Tech Stack:** React 19, TypeScript, Vite/Vitest, existing Firebase auth wrapper, existing theme tokens, mascot WebP assets.

**Spec:** Approved public-page structure and test-folder convention in the user conversation on 2026-08-31; the prior landing plan is `docs/superpowers/plans/2026-08-31-public-landing-auth.md`.

## Global Constraints

- Local mode must continue to open the existing workspace at `/` without network auth.
- Firebase login and signup remain Google-only and use the existing `signInWithGoogle()` boundary.
- Existing Cooper icon, wordmark tokens, mascot assets, and signed-in app behavior remain unchanged.
- Public deep links must work through Firebase Hosting’s existing SPA rewrite.
- Terms and Privacy must not promise unsupported deletion, sharing, or integration behavior.
- Move tests without changing their assertions or silently absorbing unrelated dirty worktree edits.

---

### Task 1: Move frontend tests into the established test directory

**Files:**

- Move: `frontend/src/App.test.tsx` → `frontend/src/test/App.test.tsx`
- Move: `frontend/src/Landing.test.tsx` → `frontend/src/test/Landing.test.tsx`
- Move: `frontend/src/api.test.ts` → `frontend/src/test/api.test.ts`
- Move: `frontend/src/auth-flow.test.tsx` → `frontend/src/test/auth-flow.test.tsx`
- Move: `frontend/src/firebase.test.ts` → `frontend/src/test/firebase.test.ts`
- Move: `frontend/src/main.test.tsx` → `frontend/src/test/main.test.tsx`
- Move: `frontend/src/notification.test.tsx` → `frontend/src/test/notification.test.tsx`
- Move: `frontend/src/runtime-config.test.ts` → `frontend/src/test/runtime-config.test.ts`
- Modify: moved test imports from `./` to `../` for source modules and mocks.

**Interfaces:**

- Consumes: `frontend/src/test/setup.ts` through the existing Vitest `setupFiles` setting.
- Produces: the same test suite and assertions, discovered by Vitest from inside `src`.

- [x] Move the eight test files with `git mv`.
- [x] Update only relative source imports and mocks required by the new directory.
- [x] Run `npm test -- --run` and confirm the suite remains green.

### Task 2: Split the public landing and auth surfaces by responsibility

**Files:**

- Create: `frontend/src/landing/LandingPage.tsx`
- Create: `frontend/src/landing/AuthCard.tsx`
- Create: `frontend/src/landing/AuthPage.tsx`
- Create: `frontend/src/landing/LegalPage.tsx`
- Create: `frontend/src/landing/TermsPage.tsx`
- Create: `frontend/src/landing/PrivacyPage.tsx`
- Create: `frontend/src/landing/PublicRoutes.tsx`
- Move/modify: `frontend/src/Landing.css` → `frontend/src/landing/landing.css`
- Modify: `frontend/src/App.tsx`
- Modify: source imports in moved landing tests.

**Interfaces:**

- `AuthCard` consumes `{ intent, busy, error, authEnabled, onSignIn }` and renders the shared Google action.
- `AuthPage` consumes `{ intent, busy, error, authEnabled, onSignIn }` and renders a full-page Meta/Google-style auth surface.
- `PublicRoutes` consumes `{ path, authState, busy, error, onSignIn }` and renders `/`, `/login`, `/signup`, `/terms`, or `/privacy` without adding a router package.
- `TermsPage` and `PrivacyPage` render only product facts already documented in `PRD.md` and `ARCHITECTURE.md`.

- [x] Add focused route, auth intent, legal-page, and Google-only behavior tests.
- [x] Move the existing horizontal story into `landing/LandingPage.tsx` and keep its five panels/mascots intact.
- [x] Extract one reusable `AuthCard`, then build full `/login` and `/signup` pages around it.
- [x] Add shared legal layout and the two legal documents with footer links back to the public pages.
- [x] Wire App so hosted signed-out users see public routes while local/signed-in users keep the workspace.
- [x] Preserve browser deep-link behavior and a graceful local-mode message on auth pages.

### Task 3: Polish, review, and verify the public experience

**Files:**

- Modify: `frontend/src/landing/landing.css`
- Modify: `frontend/index.html` only if public metadata needs a final correction.
- Test: `frontend/src/test/*`.

- [x] Render desktop legal, mobile legal, and login states; verify the dev-server deep links.
- [x] Render desktop horizontal, mobile vertical, login, signup, Terms, Privacy, light, and dark states.
- [x] Run a senior-code review for boundaries, routing, accessibility, and no-new-dependency compliance.
- [x] Run a QA review for deep links, auth states, keyboard access, responsive layout, and regressions.
- [x] Run frontend tests, backend tests, Prettier, Ruff, and production build.
- [x] Commit only the public-page/test-layout files and the plan; preserve unrelated dirty files.
