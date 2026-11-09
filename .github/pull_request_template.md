## Related issue

Closes #N. Use `N/A` only for mechanical maintenance that does not need tracking.

## What changed

<!-- Describe the user or operational outcome. -->

## Why

<!-- Link this to the Issue or product requirement. -->

## Implementation notes

<!-- Mention important boundaries, migrations, configuration, or follow-up work. -->

## Testing performed

<!-- Backend commands run at the root. npm commands run in frontend/. Record results or explain
     not run and not applicable. For docs-only work, check formatting, links, and claims.
     See docs/WORKFLOW.md for the full evidence gates. -->

- [ ] The linked Issue acceptance criteria are satisfied.
- [ ] `uv run pytest`
- [ ] `uv run ruff check . && uv run ruff format --check .`
- [ ] `npm test -- --no-file-parallelism`
- [ ] `npm run format:check`
- [ ] `npm run build`
- [ ] `git diff --check`
- [ ] Browser or manual check when the UI or a provider changed
- [ ] Connected-provider acceptance record updated when a provider changed (mocks do not count)

## Screenshots

<!-- Add screenshots for visible UI changes, or write “Not applicable.” -->

## Risks and deployment notes

<!-- State breaking changes, environment changes, migration and rollback steps, or “None.” -->
