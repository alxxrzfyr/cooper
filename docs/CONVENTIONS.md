# Conventions

Style decisions made once so they are not re-litigated per file.

## Python

- Python 3.12. `uv` for dependency management, with versions pinned. No unpinned ranges.
- `ruff` for lint and format. `mypy` in strict mode over `cadence/`.
- Type hints everywhere, including test signatures. `Any` requires a comment explaining why.
- `core/` uses `@dataclass(frozen=True)` for value objects. Pydantic models live at boundaries:
  API request and response shapes, intents, and settings.
- Naming: modules and functions `snake_case`, classes `PascalCase`, module-level constants
  `UPPER_SNAKE`. Boolean names read as assertions, `is_app_owned` rather than `app_owned_flag`.
- Times: store UTC, name UTC columns and variables with a `_utc` suffix, name local wall-clock
  values with a `_local` suffix. A bare `datetime` variable name is a bug waiting to happen.
- Money and durations: integers only. Effort is `effort_minutes`, never a float of hours.

## Errors

- `core/errors.py` defines domain errors. Services raise them; `api/` maps them to HTTP codes in
  one place, not per route.
- Never swallow an exception to keep a flow alive. If a failure is acceptable, handle it
  explicitly and log why at `INFO`.
- Adapter failures are wrapped in domain errors so `services/` never catches a vendor exception
  type. That wrapping is what keeps providers swappable.
- Validation failure produces `Clarify` and zero writes. Never a partial application.

## Logging

- Structured, one event per line, no f-string interpolation into the message.
- Never log tokens, secrets, raw prompt text, or event descriptions. `ai_decision` stores a
  digest of input, not the input.
- Log every AI-originated mutation at `INFO` with its `batch_id`. That trail is the audit path
  full autonomy depends on.

## Files and functions

- One clear purpose per file. If a one-sentence description needs an "and", split it.
- Prefer a pure function in `core/` over a method on a service. Pure functions are the cheap part
  of this codebase to test and reason about.
- No file over roughly 300 lines without a reason. Long files are where invariants go to hide.

## TypeScript and React

- Vite, TypeScript strict mode, function components, hooks only.
- TanStack Query for server state. No global store: this app has little client state, and Redux
  would be ceremony.
- Types for API shapes live in `frontend/src/api/types.ts` and mirror the backend Pydantic
  models. When they diverge, the backend is correct.
- No component library. Plain CSS modules. The UI is four views and a handful of components.
- Accessibility is not optional: real `<button>` elements, labelled inputs, visible focus rings,
  and keyboard operation of the capture bar including its edit and undo controls.

## Tests

See `docs/TESTING.md`. Test names state the behavior, not the function under test:
`test_scheduler_never_places_outside_window`, not `test_place_blocks_3`.

## Commits

Conventional Commits. Types in use: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`.

Subject line under 70 characters, imperative mood. Body explains why, not what, since the diff
already says what. Reference the PRD phase and acceptance criterion when a commit completes one.

```
feat(scheduler): place shortlist inside declared windows

Implements PRD Phase 3 acceptance 1. Placement builds its candidate
interval set from expanded focus windows, so no code path can produce
a block outside them.
```

## Dependencies

Adding one requires a stated reason and a pinned version. The bar is high: this project has one
user and every dependency is a future upgrade obligation. Prefer the standard library. `zoneinfo`
over `pytz`, `sqlite3` through SQLAlchemy over an ORM abstraction on top of it.
