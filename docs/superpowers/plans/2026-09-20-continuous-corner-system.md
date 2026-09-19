# Continuous Corner System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make native G2-style superellipse corners and exact concentric nesting Cooper's default geometry across authenticated and public interfaces, then validate, commit, and push the complete approved UI work.

**Architecture:** CSS remains the single source of visual geometry. `frontend/src/theme.css` defines continuous and round shape primitives, applies the continuous curve by default inside `.app`, and preserves semantic circles and capsules; `frontend/src/landing/landing.css` reuses those primitives. Existing `border-radius` values remain the fallback for browsers without `corner-shape`.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Vite, Prettier, Git

**Spec:** `docs/superpowers/specs/2026-09-20-continuous-corner-system-design.md`

## Global Constraints

- Add no dependency, React wrapper, JavaScript measurement, SVG mask, or generated clipping path.
- Preserve product behavior, touch targets, focus order, colors, typography, and responsive boundaries.
- Continuous rounded rectangles use `corner-shape: squircle`; semantic circles and capsules use `corner-shape: round`.
- Nested radii follow `inner radius + gap = outer radius` where rounded surfaces are visibly nested.
- Keep ordinary `border-radius` declarations as the complete unsupported-browser fallback.
- Apply the system to authenticated and public `.app` contexts, including mobile and desktop.
- Do not alter mascot raster assets or introduce Liquid Glass material effects.
- Green remains reserved for done and red for gone; category colors remain purple, blue, orange, and teal.

---

### Task 1: Checkpoint the already-approved responsive UI work

**Files:**

- Commit existing modifications: `frontend/src/App.tsx`
- Commit existing modifications: `frontend/src/Calendar.tsx`
- Commit existing modifications: `frontend/src/Nav.tsx`
- Commit existing modifications: `frontend/src/landing/PublicRoutes.tsx`
- Commit existing modifications: `frontend/src/landing/landing.css`
- Commit existing modifications: `frontend/src/test/App.test.tsx`
- Commit existing modifications: `frontend/src/theme.css`

**Interfaces:**

- Consumes: the approved account loading, undo removal, collapsible rail, and responsive Calendar implementation already present in the worktree.
- Produces: a clean implementation baseline at a Conventional Commit before corner-system edits begin.

- [ ] **Step 1: Review the exact baseline diff**

```bash
git diff -- frontend/src/App.tsx frontend/src/Calendar.tsx frontend/src/Nav.tsx \
  frontend/src/landing/PublicRoutes.tsx frontend/src/landing/landing.css \
  frontend/src/test/App.test.tsx frontend/src/theme.css
```

Expected: only the previously approved account-state, loading, undo-removal, sidebar, and Calendar changes.

- [ ] **Step 2: Run the baseline frontend gate**

```bash
cd frontend
npm test -- --no-file-parallelism
npm run format:check
npm run build
cd ..
git diff --check
```

Expected: 183 tests pass, formatting passes, Vite production build succeeds, and `git diff --check` prints nothing.

- [ ] **Step 3: Commit the approved baseline**

```bash
git add frontend/src/App.tsx frontend/src/Calendar.tsx frontend/src/Nav.tsx \
  frontend/src/landing/PublicRoutes.tsx frontend/src/landing/landing.css \
  frontend/src/test/App.test.tsx frontend/src/theme.css
git commit -m "feat(ui): improve responsive app experience" \
  -m "Strengthen account loading, remove obsolete undo controls, add a fluid collapsible rail, and give Calendar a responsive full-workspace layout."
```

Expected: one Conventional Commit containing only the approved existing UI work.

### Task 2: Establish continuous-corner primitives and semantic geometry

**Files:**

- Modify: `frontend/src/theme.css:42-50`
- Modify: `frontend/src/theme.css:120-160`
- Modify: `frontend/src/theme.css` selectors using `var(--pill)` or `50%`
- Modify: `frontend/src/landing/landing.css` rounded public/auth selectors

**Interfaces:**

- Consumes: existing radius tokens.
- Produces: `--corner-continuous`, `--corner-round`, a default continuous app curve, and explicit round exceptions.

- [ ] **Step 1: Record the geometry inventory**

```bash
rg -n "border(-[a-z]+)*-radius|corner-shape" frontend/src/theme.css frontend/src/landing/landing.css
```

Expected: every radius and existing local squircle is visible for classification.

- [ ] **Step 2: Add shared shape and radius primitives**

Use in `:root` inside `frontend/src/theme.css`:

```css
--r-sm: 10px;
--r-md: 14px;
--r-lg: 20px;
--r-xl: 28px;
--pill: 999px;
--corner-continuous: squircle;
--corner-round: round;
```

Expected: one geometry vocabulary for app and public contexts.

- [ ] **Step 3: Make continuous corners the structural default**

Add beside the `.app` shell styles:

```css
.app *,
.app *::before,
.app *::after {
  corner-shape: var(--corner-continuous);
}
```

Expected: descendants with a non-zero radius become native superellipses; square elements remain square.

- [ ] **Step 4: Preserve semantic round shapes**

Group existing selectors for capsules, true circles, dots, spinners, avatars, circular date markers, and circular icon controls, then apply:

```css
corner-shape: var(--corner-round);
```

Expected: `var(--pill)` controls remain capsules, `50%` indicators remain circles, and rounded rectangles use squircles.

- [ ] **Step 5: Remove redundant local squircle declarations**

Delete local `corner-shape: squircle` declarations from `.modeswitch`, `.modeswitch__thumb`, and `.modeswitch__opt` once the structural default covers them. Retain explicit `round` where the mode control is a semantic capsule.

- [ ] **Step 6: Format the stylesheets**

```bash
cd frontend
npx prettier --write src/theme.css src/landing/landing.css
```

Expected: both stylesheets format without unrelated source changes.

### Task 3: Make visible nesting concentric and document the default

**Files:**

- Modify: `frontend/src/theme.css`
- Modify: `frontend/src/landing/landing.css`
- Modify: `docs/DESIGN.md:1-35`

**Interfaces:**

- Consumes: Task 2 shape primitives.
- Produces: concentric nested surfaces and the durable project rule.

- [ ] **Step 1: Audit exposed nested surfaces**

Inspect the rail brand and items, composer and send control, segmented controls, Calendar canvas and cells, frames, settings groups, auth cards, landing cards, mobile navigation, and loading skeletons. Calculate each visible pair with:

```text
inner radius = outer radius - actual padding between their edges
```

Expected: adjusted values use an existing token or a local `calc()` tied to parent radius and padding.

- [ ] **Step 2: Replace raw rounded-rectangle values where tokens express the same intent**

Use `var(--r-sm)`, `var(--r-md)`, `var(--r-lg)`, or `var(--r-xl)` for rounded rectangles. Keep asymmetric speech-bubble radii, zero-radius grid edges, `50%` circles, and `var(--pill)` capsules explicit.

Expected: geometry changes only for consistency and concentricity; spacing and behavior remain unchanged.

- [ ] **Step 3: Document the shape taxonomy**

Replace the radius paragraph in `docs/DESIGN.md` with:

```markdown
Rounded rectangles use native continuous corners: keep `border-radius` as the fallback and apply
`corner-shape: squircle`. Use the shared 10, 14, 20, and 28px radius scale. Nested rounded
rectangles are concentric: inner radius plus the gap between surfaces equals outer radius. Capsules
use a radius equal to half their height and `corner-shape: round`; circles remain round. Do not turn
semantic capsules or circles into squircles.
```

- [ ] **Step 4: Run static design validation**

```bash
node /home/home/.agents/skills/impeccable/scripts/detect.mjs \
  frontend/src/theme.css frontend/src/landing/landing.css
```

Expected: exit code 0 with no blocking findings.

### Task 4: Verify responsive rendering and fallback behavior

**Files:**

- Verify: `frontend/src/theme.css`
- Verify: `frontend/src/landing/landing.css`

**Interfaces:**

- Consumes: Tasks 2 and 3.
- Produces: browser evidence that defaults, exceptions, nesting, and fallback work.

- [ ] **Step 1: Start or reuse the local application**

```bash
uv run uvicorn cooper.app:app --host 127.0.0.1
cd frontend && npm run dev
```

Expected: `/health` and Vite respond locally without binding `0.0.0.0`.

- [ ] **Step 2: Inspect authenticated desktop and mobile surfaces**

Capture Home, Cooper, Calendar Month, Form, Settings, an open frame, expanded rail, collapsed rail, and mobile navigation at approximately `1920x960` and `390x844`.

Expected: rounded rectangles are continuous, circles and capsules remain round, focus outlines are not clipped, and nested curves share a center.

- [ ] **Step 3: Inspect public and account surfaces**

Capture landing, sign-in/register, loading, unavailable-account, and error states in light and dark appearances.

Expected: public/auth surfaces share the geometry without layout or messaging changes.

- [ ] **Step 4: Verify progressive fallback**

Temporarily inject:

```css
.app *,
.app *::before,
.app *::after {
  corner-shape: round !important;
}
```

Expected: the `border-radius` fallback remains complete and usable; no mask is required.

- [ ] **Step 5: Fix findings once and confirm once**

Expected: one bounded correction batch, followed by one final desktop/mobile/light/dark confirmation.

### Task 5: Run release gates, commit the corner system, and push

**Files:**

- Commit: `frontend/src/theme.css`
- Commit: `frontend/src/landing/landing.css`
- Commit: `docs/DESIGN.md`
- Commit: `docs/superpowers/plans/2026-09-20-continuous-corner-system.md`

**Interfaces:**

- Consumes: visually confirmed implementation.
- Produces: verified Conventional Commits on `main` and an exact remote-tip match.

- [ ] **Step 1: Run the complete repository gate**

```bash
uv run pytest
uv run ruff check .
uv run ruff format --check .
cd frontend
npm test -- --no-file-parallelism
npm run format:check
npm run build
cd ..
git diff --check
```

Expected: Python and frontend tests, lint, formatting, build, and whitespace checks pass.

- [ ] **Step 2: Review the exact final diff**

```bash
git status --short
git diff -- frontend/src/theme.css frontend/src/landing/landing.css docs/DESIGN.md \
  docs/superpowers/plans/2026-09-20-continuous-corner-system.md
```

Expected: only approved corner-system implementation, documentation, and plan remain uncommitted.

- [ ] **Step 3: Commit the corner system**

```bash
git add frontend/src/theme.css frontend/src/landing/landing.css docs/DESIGN.md \
  docs/superpowers/plans/2026-09-20-continuous-corner-system.md
git commit -m "feat(ui): adopt continuous corner geometry" \
  -m "Make native superellipse corners the default, preserve semantic circles and capsules, and align nested surfaces concentrically across app and public contexts."
```

- [ ] **Step 4: Verify and push the exact tip**

```bash
git status --short
git log -3 --oneline
git push origin main
git ls-remote origin refs/heads/main
git rev-parse HEAD
```

Expected: clean worktree, successful push, and remote `main` equal to local `HEAD`.
