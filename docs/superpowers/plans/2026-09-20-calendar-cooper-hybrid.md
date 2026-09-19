# Cooper Hybrid Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a spacious, Cooper-branded calendar surface inspired by Google Calendar and Notion Calendar while keeping the existing grid width, event density, and responsive shell behavior.

**Architecture:** Keep `Calendar.tsx` as the calendar's semantic structure and state owner. Refine the existing calendar-specific CSS in `theme.css` so the heading, toolbar, grid, and legend form one clear workspace; use the existing rail/tab layout to let the canvas expand when navigation collapses. Do not add data models, providers, or a second scroll system.

**Tech Stack:** React 19, TypeScript, CSS custom properties, Vitest, Vite, Prettier.

**Spec:** `docs/superpowers/specs/2026-09-20-calendar-cooper-hybrid-design.md`

## Global Constraints

- Preserve the existing seven-column calendar grid and its readable minimum width (`720px` month, `760px` mobile week, `820px` desktop week).
- Do not compress month cells below the current desktop `96px` or mobile `94px` minimums.
- Month view must not gain a second vertical scroll container or clip the final week and legend.
- Day and Week retain their existing timeline scrolling.
- Preserve category semantics: purple, blue, orange, and teal only; green remains done and red remains gone.
- Keep the continuous-corner system from `docs/DESIGN.md` as the default geometry.
- Do not change provider data, event parsing, backend behavior, or calendar mode semantics.
- Keep desktop rail and narrow tabbar structures separate; responsive rules belong at the end of `theme.css`.

### Task 1: Establish the calendar layout baseline

**Files:**

- Read: `frontend/src/Calendar.tsx`
- Read: `frontend/src/theme.css:4218-4610`
- Read: `frontend/src/App.tsx` for the authenticated shell grid areas

**Interfaces:**

- Consumes: existing `Calendar` markup, `.calendar-page`, `.calendar-canvas`, `.calendar-view`, `.calbar`, `.calfoot`, and shell grid areas.
- Produces: a written baseline checklist for toolbar height, canvas bounds, month grid minimums, footer height, and collapsed-rail width behavior before edits.

- [x] **Step 1: Inspect the rendered calendar at the reference viewport sizes.**

Run the existing frontend dev server and inspect Month view at a wide viewport with the rail expanded and collapsed, then at a narrow viewport. Record whether the final week, event pills, and legend are visible without a nested vertical scroll.

- [x] **Step 2: Capture the current CSS constraints.**

Confirm the baseline values in `theme.css`: `.calendar-page` spacing, `.calendar-canvas` flex behavior, `.calbar` padding, `.monthgrid` minimum width/row tracks, `.monthcell` minimum height, and `.calfoot` padding.

- [x] **Step 3: Stop before editing if the existing markup cannot express the approved hierarchy.**

The approved design expects the existing heading → controls → grid → legend order. If that order is already present, continue with CSS-only refinement; do not introduce a wrapper or a new calendar component.

### Task 2: Restore spacious calendar chrome without changing grid density

**Files:**

- Modify: `frontend/src/theme.css:4218-4455`
- Test: `frontend/src/test/App.test.tsx` only if a stable calendar shell selector or responsive behavior assertion is required by the existing suite

**Interfaces:**

- Consumes: baseline measurements from Task 1 and the existing calendar tokens.
- Produces: a calendar canvas whose toolbar and footer have comfortable vertical rhythm while the month grid retains its current minimum width and row heights.

- [x] **Step 1: Restore generous toolbar spacing.**

Use the shared spacing rhythm around `.app:not(.app--public) .calendar-canvas .calbar`; keep the segmented control and navigation aligned without shrinking their existing touch targets. Avoid solving height pressure by reducing `.monthcell` or event pill dimensions.

- [x] **Step 2: Refine the canvas hierarchy.**

Keep the canvas as one continuous rounded surface. Use the existing hairline separator between controls, grid, and legend; remove only spacing that creates accidental visual gaps, not the generous breathing room between primary groups.

- [x] **Step 3: Keep the month grid dimensions unchanged.**

Retain the `720px` minimum month width, `40px` weekday header, `96px` desktop rows, and `94px` narrow rows. The fix must come from surrounding layout allocation and clear overflow rules, not cell compression.

- [x] **Step 4: Keep the legend subordinate.**

Preserve the legend and explanatory hint at the bottom of the same canvas. On narrow screens keep the existing horizontal legend behavior; do not turn the legend into a second card or a competing navigation surface.

- [x] **Step 5: Run formatting and the layout detector.**

```bash
cd frontend
node_modules/.bin/prettier --write src/theme.css
node /home/home/.gemini/config/skills/impeccable/scripts/detect.mjs --json --scope layout src/theme.css
```

Expected: Prettier reports the file unchanged after the write and the detector returns no unexplained findings for the changed calendar rules.

### Task 3: Verify responsive expansion and mobile hierarchy

**Files:**

- Modify: `frontend/src/theme.css` only if Task 2 exposes a breakpoint-specific conflict
- Read: `frontend/src/Nav.tsx`, `frontend/src/App.tsx`, and `frontend/src/Calendar.tsx`

**Interfaces:**

- Consumes: Task 2's calendar canvas rules and existing desktop rail/mobile tabbar contracts.
- Produces: stable calendar geometry when the sidebar collapses and readable control order at narrow widths.

- [x] **Step 1: Verify expanded and collapsed desktop rail states.**

Confirm the calendar canvas width increases when the rail collapses, with no overlap, clipped right edge, or stale fixed width. Confirm the calendar remains aligned to the authenticated shell's `main` grid area.

- [x] **Step 2: Verify narrow-screen order and touch targets.**

Confirm the visual order remains heading, range controls, date navigation, grid, and legend. Keep the existing 42px segmented buttons and 42px navigation buttons at narrow widths.

- [x] **Step 3: Verify content extremes.**

Use a month containing events on the first and last visible weeks, long event titles, and an empty category. Confirm the final row remains visible and long titles truncate within their pills rather than changing grid width.

### Task 4: Full verification and release handoff

**Files:**

- Read: `docs/superpowers/specs/2026-09-20-calendar-cooper-hybrid-design.md`
- Read: `docs/DESIGN.md`
- Modify: `docs/DESIGN.md` only if the shipped calendar rules materially change the documented surface contract

**Interfaces:**

- Consumes: completed calendar CSS and any narrowly scoped markup changes from Tasks 2–3.
- Produces: verified, reviewable calendar behavior ready for a Conventional Commit and push.

- [x] **Step 1: Run frontend tests.**

```bash
cd frontend
npm test -- --no-file-parallelism
```

Expected: all existing frontend test files and tests pass.

- [x] **Step 2: Run formatting and production build.**

```bash
npm run format:check
npm run build
```

Expected: Prettier reports all matched files clean and Vite completes the TypeScript/build pipeline.

- [x] **Step 3: Run repository checks.**

```bash
cd ..
git diff --check
uv run ruff check .
uv run ruff format --check .
```

Expected: no whitespace errors and no Python lint/format regressions.

- [x] **Step 4: Inspect the final diff and visual result.**

Review only the intended calendar files and documentation. Recheck desktop expanded/collapsed rail, mobile calendar, final-week visibility, event truncation, and light/dark themes.

- [ ] **Step 5: Commit and push.**

```bash
git add frontend/src/Calendar.tsx frontend/src/theme.css docs/DESIGN.md
git commit -m "feat(calendar): refine spacious hybrid workspace" -m "Restore the roomy calendar hierarchy inspired by Google and Notion while preserving Cooper's grid density and responsive shell behavior."
git push origin main
```

Verify the pushed tip with:

```bash
local_tip=$(git rev-parse HEAD)
remote_tip=$(git ls-remote origin refs/heads/main | awk '{print $1}')
test "$local_tip" = "$remote_tip"
```
