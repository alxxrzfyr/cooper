# Cooper planning trust implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development
> (recommended) or executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair four misleading deterministic planning answers without adding
commercial features, changing persistence, or promising an unbuilt capacity model.

**Architecture:** Keep the canonical snapshot and the existing
`answer_planning_intent(intent, question, view)` renderer. Separate current from
upcoming commitments, unfinished work from calendar events, priority from
feasibility, and calendar occupancy from overall workload certainty. Every answer
remains read-only and model-free.

**Tech Stack:** Python, FastAPI, pytest, SQLAlchemy's existing test fixtures, Ruff;
existing React/Vitest app for regression and visible acceptance.

**Spec:** `docs/designs/cooper-product-rethink.md`, specifically “Reproduced planning
defects” and the first “Trust repair” workstream.

Status: IMPLEMENTED IN THE WORKING TREE, 2026-09-30; release gates remain pending.
This plan covers only the first repair
tranche. GCP cutover, commercial accounting, capacity/recovery and billing each need
their own implementation specification; their roadmap and gates are in the spec.

## Execution record

All four renderer repairs are implemented in `cooper/app.py`. Direct regressions
cover current/next, unscheduled work, priority/placement, unknown effort, merged
occupancy, tomorrow, unavailable sources, and read-only, model-free empty/nonempty
answers. Tests first reproduced the old defects. The new HTTP workload contract
test is present as source only, not reported passing.

Verified commands: `python -m pytest tests/test_api.py -k
TestPlanningAnswerSemantics -q` (18 passed); `python -m pytest tests
--ignore=tests/test_api.py --ignore=tests/test_google_ownership.py -q` (247 passed).
Commands used the installed `.venv` interpreter. The Google ownership tests use
the same blocked HTTP fixture and remain unverified. Ruff lint/format, Prettier,
the scoped design detector and `git diff --check` pass; the detector is not visual
acceptance.

Fixture deviation: direct tests import the actual app with throwaway SQLite and
empty integration keys, without entering `TestClient`. The HTTP fixture hangs in
AnyIO's blocking portal; the same hang was reproduced with an empty FastAPI app,
before Cooper or its lifespan was involved. Direct coverage is not HTTP acceptance.
Checkboxes below retain the original release checklist; unverified HTTP, visual
acceptance and delivery items are not closed.

The landing also has FAQs beside proposed Free/Plus choices, with a native
disclosure/CTA regression. After the third-chapter repair, all 215 frontend tests and the TypeScript/Vite production
build pass. Visual acceptance is blocked: Vite cannot bind `127.0.0.1:5173` (`EPERM`)
and the in-app browser is unavailable. No screenshot review pass is claimed.
Git metadata is read-only; no branch, commit, push or PR was created for this work.

Responsive polish retains horizontal chapters from the original 900px breakpoint,
regardless of window height. A temporary width/height fallback was removed at the
owner's correction. Section scrollbars are hidden without disabling overflow access.
FAQ/pricing typography and grids are fluid, and only one FAQ opens at a time, with a
summary-click compatibility fallback. Scroll-orientation tests cover narrow screens,
short desktop windows, resize cleanup and keyboard navigation. They do not prove
rendered geometry; fresh desktop/mobile visual acceptance remains pending.

The follow-up fixes center the FAQ/pricing group with safe flex auto margins and
align its headings, introductions and content starts through shared grid rows.
Pricing cards share their internal rows and expanded answers stay in normal flow.
Across chapters, flexible columns replace fixed minimum widths, cards use content
height, and artwork retains its composition with fluid sizes/positions. The original
900px direction breakpoint, single RAF, smoothing and entry effects remain intact.
Removing `allowNestedScroll` restores vertical-wheel-to-horizontal travel even over
an overflowing FAQ. A regression using real Lenis first failed with the old option
and then passed, including smooth forward travel and reverse input. These are DOM
and library checks, not browser zoom or rendered overlap acceptance. The browser
inventory is empty and a fresh Vite launch still fails with the same bind `EPERM`.

The owner reported that the responsive pass made 110% laptop zoom feel like the
normal size. The subsequent correction removes the newly reduced heading rules,
restores larger artwork/card spacing, and removes the added short-height FAQ/pricing
compact mode. Flexible columns, content-height cards, shared alignment rows and the
wheel regression stay intact. This is a source correction, not a claim of laptop
visual acceptance; the established 100% visual scale remains the intended baseline.

Third-chapter follow-up: the owner's screenshot showed source labels moved away
from a fixed 760×430 connector SVG and the annotation overlapping Cooper. The
source diagram now uses content-sized grid slots and per-label arrow wrappers with
reserved space. Planned labels do not overlay the calendar image; live sources and
the annotation/mascot have separate slots. Its own container width controls the
two-column fallback, without changing horizontal navigation or adjacent chapters.
A DOM regression first failed against the old diagram, then passed with four
independent connector/label pairs and separate caption children. This verifies
ownership/structure, not rendered resize or zoom geometry; live browser acceptance
is still pending in the blocked environment.

The old single-line ellipsis rule is overridden only inside the third chapter so
long source labels wrap within their cards rather than disappearing when resized.

## Global constraints

- No new table, dependency, background process or persistence migration.
- `brain.py` never writes; `app.py` remains the sole mutation path.
- AI answers are read-only; deterministic planning answers never invoke a model.
- Google/iCloud remain read-only; local-only placement, exact duration and undo stay unchanged.
- Source failure never establishes safe free time.
- UTC storage, configured weekday/overnight availability, breaks and daily limits stay unchanged.
- An unscheduled task is not automatically due today; unknown effort stays unknown.
- Priority is not proof of feasible placement.
- Do not claim overall workload is manageable based only on calendar occupancy.
- No logging of prompts, titles, email bodies, message IDs or tokens.
- Preserve unrelated work. Do not commit to the currently open documentation PR.

## File map and interfaces

| File                | Responsibility in this tranche                                                |
| ------------------- | ----------------------------------------------------------------------------- |
| `cooper/app.py`     | Narrow edits to `answer_planning_intent`; no routing/writer refactor          |
| `tests/test_api.py` | Synthetic answer regressions and HTTP contract checks using existing fixtures |
| `PRD.md`            | Record repaired answer semantics after implementation                         |
| `ARCHITECTURE.md`   | Explain conservative answer boundaries after implementation                   |
| `README.md`         | Link accurate scope and validation evidence after implementation              |

Existing interface:

```python
def answer_planning_intent(
    intent: AskIntent, question: str, view: dict[str, Any]
) -> dict[str, Any]:
    # Returns {"message": str, "facts": list[str], "warnings": list[str]}.
    # Does not mutate view, call a provider/model, or write data.
    ...
```

Consumers use `view["planning"]` with `tasks`, `commitments`, `focus`, `complete`,
`source_health` and `metrics`. Preserve that schema and response shape. The ellipsis
above describes the existing interface, not an implementation step.

## Task 1: Distinguish current activity from upcoming commitments

**Files:** Modify `cooper/app.py`; test `tests/test_api.py`.

**Interfaces:** Consumes the existing planning snapshot; produces the same answer
shape with a truthful current/next label. Introduces a test-only
`planning_answer_view() -> dict[str, Any]` reused by the later tasks.

- [ ] Add this synthetic fixture helper in `tests/test_api.py` near the Ask tests:

```python
def planning_answer_view() -> dict[str, Any]:
    return {
        "timezone": "UTC",
        "today": "2026-09-30",
        "now": "2026-09-30T10:00:00+00:00",
        "planning": {
            "complete": True,
            "source_health": [],
            "commitments": [],
            "tasks": [],
            "focus": {"now_id": None, "next_id": None},
            "metrics": {"largest_free_block_minutes": 0},
        },
    }
```

- [ ] Add the actual failing label test. Use `client` to ensure importing `cooper.app`
      occurs with the existing isolated database fixture, not production configuration.

```python
@pytest.mark.parametrize(
    ("focus_key", "start", "end", "expected"),
    [
        ("now_id", "09:30", "10:30", "current"),
        ("next_id", "11:00", "12:00", "next"),
    ],
)
def test_work_next_distinguishes_current_and_future(
    client: TestClient, focus_key: str, start: str, end: str, expected: str
) -> None:
    import cooper.app as module

    view = planning_answer_view()
    view["planning"]["commitments"] = [
        {
            "id": "meeting-1",
            "title": "Synthetic meeting",
            "start_at": f"2026-09-30T{start}:00+00:00",
            "end_at": f"2026-09-30T{end}:00+00:00",
        }
    ]
    view["planning"]["focus"][focus_key] = "meeting-1"
    result = module.answer_planning_intent("work_next", "What next?", view)
    assert f"Your {expected} commitment" in result["message"]
    assert result["facts"]
```

- [ ] Run `UV_CACHE_DIR=/tmp/cooper-product-review-uv uv run pytest tests/test_api.py
-k work_next_distinguishes_current_and_future -q`. Expect the current case to fail
      before editing production logic; the future case should already pass.
- [ ] Replace only the commitment message assignment inside `work_next`:

```python
label = "current" if commitment["id"] == planning["focus"]["now_id"] else "next"
message = f"Your {label} commitment is {fact}."
```

- [ ] Add the empty-plan case and a task-in-Now case using the same helper. Assert
      no fabricated commitment; preserve the existing task recommendation response.
- [ ] Run the focused tests and `UV_CACHE_DIR=/tmp/cooper-product-review-uv uv run
pytest tests/test_api.py -k 'question or planning or work_next' -q`.
- [ ] Review the diff for reads only. If Git writes are available on a dedicated
      approved implementation branch, commit only this task with
      `fix(planning): distinguish current and upcoming commitments` and a body explaining
      that an in-progress event was incorrectly presented as future work. Do not attempt
      writes to read-only Git metadata or silently include other work.

## Task 2: Include unscheduled work without inventing a today deadline

**Files:** Modify `cooper/app.py`; test `tests/test_api.py`.

**Interfaces:** Uses `planning_answer_view()` from Task 1 and existing task fields
`id`, `title`, `start_at`, `minutes`, `state`, `due`. Produces the unchanged response
shape; calendar facts and unscheduled task facts remain distinguishable.

- [ ] Add a regression for an empty calendar with work due in a later week:

```python
def test_remaining_today_discloses_unscheduled_work_without_assigning_it_today(
    client: TestClient,
) -> None:
    import cooper.app as module

    view = planning_answer_view()
    view["planning"]["tasks"] = [
        {
            "id": "task-1",
            "title": "Draft report",
            "start_at": None,
            "minutes": 90,
            "state": "unscheduled",
            "due": "2026-10-09T18:00:00+00:00",
        }
    ]
    result = module.answer_planning_intent("remaining_today", "What is left?", view)
    assert "Draft report" in result["message"]
    assert "not all due today" in result["message"]
    assert any("Unscheduled" in fact for fact in result["facts"])
```

- [ ] Run the focused test; expect missing title/unscheduled distinction to fail.
- [ ] Retain the existing calendar answer, then append this scoped branch:

```python
pending = [task for task in tasks if task.get("start_at") is None]
if pending:
    pending_facts = [
        f"Unscheduled · {task['title']} · "
        + (f"{task['minutes']} minutes" if task.get("minutes") is not None else "effort unknown")
        for task in pending
    ]
    message += " Unscheduled work (not all due today): " + "; ".join(pending_facts) + "."
    facts.extend(pending_facts)
```

- [ ] Add cases for `minutes=None`, no due date, completed tasks excluded by the
      canonical snapshot, a blocked task, and a scheduled local task represented as both
      task and commitment. For the latter, set `start_at` and assert no duplicate
      “Unscheduled” fact. Do not independently reconstruct open-item filtering.
- [ ] Verify `test_remaining_today_includes_external_calendar_commitments` still
      passes, along with the new focused cases. The existing source warnings must remain.
- [ ] Commit the isolated task, when authorized/possible, as
      `fix(planning): disclose unscheduled work in remaining answers`, explaining that
      absence of calendar events did not establish absence of unfinished work.

## Task 3: Separate task priority from feasible placement

**Files:** Modify `cooper/app.py`; test `tests/test_api.py`.

**Interfaces:** Uses the existing ranked first task and `_recommendation_reason`;
does not add a feasibility claim or change ranking. Returns the same answer shape.

- [ ] Add a regression for unavailable source data:

```python
def test_focus_priority_does_not_imply_feasibility_when_source_is_unavailable(
    client: TestClient,
) -> None:
    import cooper.app as module

    view = planning_answer_view()
    view["planning"]["complete"] = False
    view["planning"]["source_health"] = [{"source": "google", "status": "unavailable"}]
    view["planning"]["tasks"] = [
        {
            "id": "task-1",
            "title": "Draft report",
            "start_at": None,
            "minutes": 90,
            "state": "blocked",
            "importance": 4,
        }
    ]
    result = module.answer_planning_intent("focus_week", "What should I focus on?", view)
    assert "highest-priority" in result["message"]
    assert "can't confirm" in result["message"]
    assert result["warnings"]
```

- [ ] Run the focused regression and confirm failure before implementation.
- [ ] Replace the existing imperative “Focus on ... first” message with:

```python
message = f"Your highest-priority open task is {task['title']}{reason}."
if not planning["complete"]:
    message += " I can't confirm safe placement while a connected calendar is unavailable."
else:
    message += " This is a priority ranking, not a confirmed time slot."
```

- [ ] Add a complete-source test asserting “not a confirmed time slot” and an
      empty-task test preserving the existing no-open-tasks answer. Keep the existing
      focus-question test's model-call prohibition intact.
- [ ] Run `UV_CACHE_DIR=/tmp/cooper-product-review-uv uv run pytest tests/test_api.py
-k focus -q`. Confirm ranking reasons and source warnings remain factual.
- [ ] Commit, when authorized/possible, as
      `fix(planning): distinguish priority advice from feasible placement`, explaining
      why availability must not be inferred from rank.

## Task 4: Stop inferring workload certainty from calendar occupancy

**Files:** Modify `cooper/app.py`; test `tests/test_api.py`; synchronize `PRD.md`,
`ARCHITECTURE.md` and `README.md` after the repaired behavior is verified.

**Interfaces:** Reuses existing day selection, commitment count, overlap count and
occupied-minute helpers. Does not expose a new capacity field or compute an
unvalidated demand model. A later capacity specification replaces this conservative
limitation; it is not part of this tranche.

- [ ] Add the reproduced eight-hour-work regression:

```python
def test_overload_does_not_reassure_from_an_empty_calendar(
    client: TestClient,
) -> None:
    import cooper.app as module

    view = planning_answer_view()
    view["planning"]["tasks"] = [
        {
            "id": "task-1",
            "title": "Draft report",
            "start_at": None,
            "minutes": 480,
            "state": "unscheduled",
        }
    ]
    result = module.answer_planning_intent("overload_check", "Am I overloaded today?", view)
    assert "not overloaded" not in result["message"].lower()
    assert "480" in result["message"]
    assert "capacity" in result["message"]
```

- [ ] Run it and confirm the existing “not overloaded” reassurance causes failure.
- [ ] Replace only the complete-source branch of the overload answer. Remove its
      fixed seven-hour `overloaded` predicate; keep the incomplete-source branch intact.

```python
pending = [task for task in tasks if task.get("start_at") is None]
estimated = sum(task.get("minutes") or 0 for task in pending)
unknown = sum(task.get("minutes") is None for task in pending)
message = (
    f"Calendar {label}: {len(day_commitments)} commitments occupy {occupied} minutes, "
    f"with {conflicts} overlapping pair{'s' if conflicts != 1 else ''}. "
    f"You also have {estimated} estimated minutes of unscheduled work and "
    f"{unknown} task{'s' if unknown != 1 else ''} with unknown effort. "
    "That work is not necessarily due on this day. "
    "Calendar occupancy alone cannot confirm workload fits your configured capacity."
)
```

- [ ] Add tests for unknown effort, zero tasks, tomorrow selection, overlapping
      commitments and unavailable-source warnings. Do not count summed overlapping
      durations as unique occupied time; the existing helper already merges them.
- [ ] Add an HTTP contract test using `client`, monkeypatching `module.today_view`
      to the synthetic view and `module.brain._generate` to `pytest.fail`. Submit:

```python
reply = client.post(
    "/api/say",
    headers=HEADERS,
    json={"text": "Am I overloaded today?", "mode": "ai", "intent": "overload_check"},
)
assert reply.status_code == 200
assert reply.json()["kind"] == "answered"
assert reply.json()["source"] == "cooper"
assert "not overloaded" not in reply.json()["message"].lower()
```

- [ ] Verify no `Change` or item mutation results from this HTTP request, using the
      existing isolated store and SQLAlchemy test patterns. No provider call should run
      because `today_view` is replaced only in this fixture.
- [ ] Update the three context docs to explain the repaired wording, especially
      that overall capacity remains a separate feature. Do not mark the broader product
      proposal implemented or change manual provider-acceptance dates.
- [ ] Commit, when authorized/possible, as
      `fix(planning): avoid calendar-only workload assurances`, explaining why actual
      capacity cannot be inferred from a fixed seven-hour meeting threshold.

## Verification and visible acceptance

- [ ] Run the focused regression tests first, then the complete backend suite:

```bash
UV_CACHE_DIR=/tmp/cooper-product-review-uv uv run pytest
UV_CACHE_DIR=/tmp/cooper-product-review-uv uv run ruff check .
UV_CACHE_DIR=/tmp/cooper-product-review-uv uv run ruff format --check .
```

- [ ] Run frontend regression, formatting and compile/build checks:

```bash
npm test -- --no-file-parallelism
npm run format:check
npm run build
```

Run these npm commands from `frontend/`. There is no `npm run lint` script; do not
report ESLint as passing. The build runs TypeScript checking.

- [ ] Run Prettier explicitly on modified nested Markdown, because the root npm
      formatting glob does not cover all `docs/` subdirectories. Run `git diff --check`.
- [ ] Run the local API at `127.0.0.1` and frontend development server. In Ask, check
      the four synthetic scenarios with privacy-safe local test items. Confirm messages
      and fact lists render cleanly on desktop and mobile; check long-title wrapping.
- [ ] Confirm a no-model/no-provider session still supports manual add, exact local
      scheduling and undo. Test source-unavailable wording through mocks separately
      from any real connected-account testing.
- [ ] Stop and diagnose an unexplained failure rather than weakening tests. If a
      provider path changes during implementation, require fresh manual acceptance
      before a release; this planned renderer-only change does not itself establish it.
- [ ] Before any branch/commit/push, verify worktree ownership and Git write access.
      If `.git` remains read-only, hand off verified files without claiming a commit or PR.

## GSTACK REVIEW REPORT

Scope self-check: each reproduced defect has a direct regression and a narrow
implementation. No provider transport, schema, model configuration or hosting
changed. The extra landing chapter presents beta-accurate FAQs and clearly proposed
subscriptions. Full feasibility, billing and funded AI remain separate work. No
independent review occurred.

The owner approved proceeding with the refinement direction on 2026-09-30.
Remaining release constraints are HTTP/visual acceptance, an isolated implementation
branch and Git write access. Fresh automated verification is recorded above.
Budget, billing jurisdiction and commercial schema choices are not dependencies for
these four repairs. The broader proposal remains a separate design decision.
