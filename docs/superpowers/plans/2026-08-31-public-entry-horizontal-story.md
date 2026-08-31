# Public Entry and Horizontal Story Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/` the public Cooper landing page, give the private workspace an explicit `/app` route, and prove the desktop landing story cannot introduce vertical document scrolling while mobile remains naturally scrollable.

**Architecture:** Keep `PublicRoutes` as the public surface and make `App` own a small, stateful pathname bridge for auth redirects. Workspace data loading remains gated by the explicit workspace route. Scope the desktop overflow lock to the landing surface only so auth and legal pages can still scroll when needed.

**Tech Stack:** React, TypeScript, CSS, Vitest/Testing Library, Vite, Chromium smoke checks.

**Spec:** `docs/superpowers/specs/2026-08-31-public-entry-horizontal-story-design.md`

## Global Constraints

- Do not stage or modify unrelated mascot, app, or source-asset changes already present in the worktree.
- Do not add dependencies, tables, OAuth scopes, or network behavior to manual mode.
- Preserve existing public page content, Cooper branding, and Firebase fallback behavior.
- Use conventional commit format after verification.

## Tasks

- [x] **1. Lock the route contract with tests**
  - Update the App/auth fixtures to render workspace assertions at `/app`.
  - Add a regression test proving local `/` renders the public landing and does not call the protected API.
  - Add coverage for `/app` rendering the local workspace and for public auth routes redirecting a signed-in user to `/app` without hijacking legal routes.
  - Run the focused frontend tests and confirm the new assertions fail before the implementation changes.

- [x] **2. Implement explicit workspace routing and auth navigation**
  - Add a pathname state/popstate bridge in `App` so auth callbacks can replace the public auth entry route with `/app` without a full-page reload.
  - Treat only `/app` as the workspace route; keep `/`, `/landing`, `/login`, `/signup`, `/terms`, `/privacy`, and unknown paths public.
  - Keep local `/app` fully functional without Firebase; keep signed-out `/app` on the public fallback instead of loading protected data.
  - Add a landing-only app class so the desktop overflow lock cannot affect legal or account pages.

- [x] **3. Finish responsive viewport behavior**
  - Apply a desktop-only fixed viewport/overflow lock to the landing surface and retain horizontal track scrolling, snap points, controls, and keyboard behavior.
  - Explicitly restore normal document flow and vertical chapter stacking below the mobile breakpoint.
  - Ensure the existing mobile copy-before-art order and mascot sizing remain intact.

- [x] **4. Verify the real artifact**
  - Run all frontend tests, formatter check, production build, backend tests/lint, and `git diff --check`.
  - Run Chromium at desktop and mobile sizes; inspect screenshots and DOM scroll dimensions.
  - Review the diff for route regressions and ensure unrelated dirty files are not staged.

- [x] **5. Commit the completed change**
  - Create one meaningful conventional commit: `feat(web): make landing the public entry point`.
  - Show the resulting status and recent commit history in the handoff.
