# Cooper hybrid calendar surface

## Intent

Restore the calendar's generous, glanceable spacing while keeping the Cooper shell fluid when the
navigation rail collapses. The calendar should feel closer to the roomy Google Calendar month view
and the quieter hierarchy of Notion Calendar without copying either product's chrome.

## Surface direction

- The calendar heading and navigation remain the primary reading path.
- The seven-column grid is the main workspace and keeps its existing readable minimum width and
  event density; cells must not be compressed to solve viewport pressure.
- The legend is supporting information and stays visually quiet at the bottom of the same canvas.
- The existing continuous-corner system remains the geometry default.
- Category colour continues to identify event type; no new category or state colour is introduced.

## Responsive behavior

- Wide layouts use the available content width and expand when the rail collapses.
- The toolbar keeps comfortable vertical padding and reflows as a single control group at narrow
  widths.
- Month view keeps all six weeks visible within its calendar surface without adding a second
  vertical scroll container or clipping the final row.
- Day and Week retain their existing timeline scrolling because those views represent unbounded
  hourly content.
- Mobile keeps the same hierarchy: heading, range controls, date navigation, grid, then legend.

## Scope and boundaries

This pass is limited to `frontend/src/Calendar.tsx` and the calendar-specific rules in
`frontend/src/theme.css`, plus this design documentation and its implementation plan. It does not
change provider data, event parsing, calendar modes, or backend behavior.

## Acceptance criteria

1. Month view has visibly generous toolbar and footer spacing comparable to the reference concepts.
2. The full final week and legend remain visible at the supported desktop viewport without clipping.
3. The grid's existing width and minimum cell density are preserved.
4. Collapsing the sidebar expands the calendar workspace without overlap or horizontal layout drift.
5. Narrow screens retain readable controls and do not introduce an additional calendar scroll area.
6. Existing Calendar, app, formatting, and build tests remain green.
