# Recovery Preview/Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When local task blocks are missed, Cooper previews a re-plan (old → new times, kept and unplaced work), applies it only if nothing changed since the preview, and undoes the whole batch in one step with a defined conflict policy.

**Architecture:** A pure `planner.preview_recovery()` releases missed blocks and re-places them through the existing shared projection. `app.py` exposes a read-only preview and an apply writer that reuses the `apply_slots` pattern (fresh availability, `_locked_hours` lock, recompute in-session, one `Change`). Staleness is detected by a value fingerprint, so no table or column is added. Home shows the preview inline in At Risk; it is a reply-style panel, never a modal.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, pytest; React/TypeScript, vitest, Testing Library. No new dependency, table, column or background process.

**Spec:** `docs/superpowers/specs/2026-09-30-cooper-web-first-product-design.md` ("Recovery and weekly value require their own contracts", lines ~266–292) and `docs/designs/cooper-product-rethink.md` (guided recovery rules and the recovery/calendar race risk row).

**Depends on:** PR #14 (`feat/included-ai-accounting`), which contains `project_open_tasks`, capacity `missed_block_ids` and the `task_state()` `missed_block` state. This branch is stacked on #14, so execute here directly; GitHub retargets the PR to `main` when #14 merges.

## Global Constraints

- `app.py` is the only writer; `planner.py` stays pure (no storage, no ORM mutation of inputs).
- Selection: owner-owned, `source == "me"`, `kind == "task"`, `status == "open"`, `end_at <= at`. Pinned missed blocks are kept, not moved. Fixed local events and all remote commitments are immutable.
- Placement only uses configured availability; remote busy only subtracts. If availability is incomplete, preview proposes no moves and apply refuses: a failed calendar never invents free time.
- Apply rereads items, hours and fresh provider constraints, recomputes, and rejects any difference from the preview with 409. No partial apply.
- One `Change` records every previous slot; one undo restores the batch or refuses entirely on conflict.
- Times are UTC in the database; the API returns ISO strings with offsets.
- No AI: preview and apply are deterministic and never touch `AiRequest`.
- Gating: billing does not exist, so recovery ships ungated in the beta. Adding a Plus entitlement check later is one guard at the top of `apply_recovery`; existing manual per-item rescheduling and undo stay Free and unchanged.
- No confirmation modal. The preview is detail the user asked to see; Apply is the explicit action.

## File map

| File                                            | Change                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `cooper/planner.py`                             | `released` parameter on `project_open_tasks`/`place`; new `RecoveryPlan` dataclass and `preview_recovery()` |
| `cooper/app.py`                                 | `_recovery_fingerprint`, `recovery_preview`, `apply_recovery`, `recovery` branch in `undo_last`, two routes |
| `tests/test_cooper.py`                          | Pure preview tests                                                                                          |
| `tests/test_api.py`                             | HTTP preview/apply/stale/undo tests                                                                         |
| `frontend/src/types.ts`, `frontend/src/api.ts`  | `RecoveryPreview` type, two API calls                                                                       |
| `frontend/src/Home.tsx`, `frontend/src/App.tsx` | Inline preview in At Risk, wiring through `act()`                                                           |
| `frontend/src/test/App.test.tsx`                | UI tests                                                                                                    |

---

### Task 1: Pure recovery preview

**Files:**

- Modify: `cooper/planner.py` (`project_open_tasks` ~L265, `place` ~L496)
- Test: `tests/test_cooper.py`

**Interfaces:**

- Produces:
  - `project_open_tasks(..., released: frozenset[str] = frozenset()) -> list[Slot]`
  - `place(..., released: frozenset[str] = frozenset()) -> list[Slot]`
  - `@dataclass(frozen=True) class RecoveryPlan: moves: list[RecoveryMove]; kept: list[tuple[str, str]]; unplaced: list[tuple[str, str]]` where `kept`/`unplaced` are `(item_id, reason)`
  - `@dataclass(frozen=True) class RecoveryMove: item_id: str; title: str; old_start: dt.datetime; old_end: dt.datetime; start: dt.datetime; end: dt.datetime`
  - `preview_recovery(*, items, remote_busy, hours, at, days=7) -> RecoveryPlan`
  - Unplaced reasons: `"overdue"`, `"unknown_estimate"`, `"no_feasible_slot"`. Kept reason: `"pinned"`.

- [x] **Step 1: Write the failing tests** (append to `tests/test_cooper.py`; reuse the file's existing `Item`/`Hours` builders if present, otherwise construct as below)

```python
def _task(item_id, *, start, minutes=45, pinned=0, due=None, status="open", source="me"):
    return Item(
        id=item_id,
        owner_id="local",
        source=source,
        kind="task",
        title=item_id,
        minutes=minutes,
        importance=3,
        status=status,
        pinned=pinned,
        due=due,
        start_at=start,
        end_at=(start + dt.timedelta(minutes=minutes or 30)) if start else None,
        created_at=start or AT,
    )


AT = dt.datetime(2026, 10, 5, 2, 0, tzinfo=dt.UTC)  # Monday 10:00 Asia/Singapore


def test_recovery_moves_missed_blocks_and_keeps_pinned_and_future() -> None:
    missed = _task("missed", start=AT - dt.timedelta(hours=1))
    pinned = _task("pinned", start=AT - dt.timedelta(hours=1), pinned=1)
    future = _task("future", start=AT + dt.timedelta(hours=2))
    plan = planner.preview_recovery(
        items=[missed, pinned, future], remote_busy=[], hours=DEFAULT_HOURS, at=AT
    )
    assert [move.item_id for move in plan.moves] == ["missed"]
    assert plan.moves[0].start >= AT
    assert plan.moves[0].old_end == missed.end_at
    assert plan.kept == [("pinned", "pinned")]
    assert missed.start_at == AT - dt.timedelta(hours=1)  # inputs are not mutated


def test_recovery_never_overlaps_remote_busy_or_future_blocks() -> None:
    missed = _task("missed", start=AT - dt.timedelta(hours=1), minutes=60)
    future = _task("future", start=AT + dt.timedelta(minutes=30), minutes=60)
    busy = [(AT + dt.timedelta(hours=2), AT + dt.timedelta(hours=4))]
    plan = planner.preview_recovery(
        items=[missed, future], remote_busy=busy, hours=DEFAULT_HOURS, at=AT
    )
    move = plan.moves[0]
    for start, end in [*busy, (future.start_at, future.end_at)]:
        assert move.end <= start or move.start >= end


def test_recovery_reports_unplaced_reasons() -> None:
    overdue = _task("overdue", start=AT - dt.timedelta(hours=2), due=AT - dt.timedelta(hours=1))
    unknown = _task("unknown", start=AT - dt.timedelta(hours=2), minutes=None)
    huge = _task("huge", start=AT - dt.timedelta(hours=2), minutes=60 * 20)
    plan = planner.preview_recovery(
        items=[overdue, unknown, huge], remote_busy=[], hours=DEFAULT_HOURS, at=AT, days=1
    )
    assert plan.moves == []
    assert dict(plan.unplaced) == {
        "overdue": "overdue",
        "unknown": "unknown_estimate",
        "huge": "no_feasible_slot",
    }


def test_recovery_ignores_events_done_and_provider_items() -> None:
    done = _task("done", start=AT - dt.timedelta(hours=1), status="done")
    remote = _task("remote", start=AT - dt.timedelta(hours=1), source="google")
    plan = planner.preview_recovery(
        items=[done, remote], remote_busy=[], hours=DEFAULT_HOURS, at=AT
    )
    assert plan == planner.RecoveryPlan(moves=[], kept=[], unplaced=[])
```

`DEFAULT_HOURS`: use the default `Hours` the file already builds for placement tests (weekdays, Asia/Singapore). If none exists, build `planner.Hours` with the same defaults `app._ensure_hours` writes.

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_cooper.py -k recovery -q`
Expected: FAIL, `AttributeError: module 'cooper.planner' has no attribute 'preview_recovery'`.

- [x] **Step 3: Implement**

In `place`, change the skip and the scheduled-usage loop so released items count as unscheduled and free their old time:

```python
    for item in scheduled or []:
        if item.id in released or item.status != "open" or item.kind != "task" or not item.scheduled:
            continue
    ...
    for entry in ranked:
        item = entry.item
        if (item.scheduled and item.id not in released) or item.minutes is None or item.minutes <= 0:
            continue
```

In `project_open_tasks`, add `released: frozenset[str] = frozenset()`, drop released items from `busy`, and pass `released=released` to `place`:

```python
    busy = [
        *remote_busy,
        *(
            (aware(item.start_at), aware(item.end_at))
            for item in items
            if item.start_at and item.end_at and item.id not in released
        ),
    ]
```

Add below `project_open_tasks`:

```python
@dataclass(frozen=True)
class RecoveryMove:
    item_id: str
    title: str
    old_start: dt.datetime
    old_end: dt.datetime
    start: dt.datetime
    end: dt.datetime


@dataclass(frozen=True)
class RecoveryPlan:
    moves: list[RecoveryMove]
    kept: list[tuple[str, str]]
    unplaced: list[tuple[str, str]]


def preview_recovery(
    *,
    items: Sequence[Item],
    remote_busy: Sequence[tuple[dt.datetime, dt.datetime]],
    hours: Hours,
    at: dt.datetime,
    days: int = 7,
) -> RecoveryPlan:
    """Re-place missed local blocks without mutating inputs; pinned blocks stay put."""
    missed = [
        item
        for item in items
        if (item.source or "me") == "me"
        and item.kind == "task"
        and item.status == "open"
        and item.start_at
        and item.end_at
        and aware(item.end_at) <= at
    ]
    kept = [(item.id, "pinned") for item in missed if item.pinned]
    released = frozenset(item.id for item in missed if not item.pinned)
    if not released:
        return RecoveryPlan(moves=[], kept=kept, unplaced=[])
    slots = {
        slot.item_id: slot
        for slot in project_open_tasks(
            items=items,
            remote_busy=remote_busy,
            hours=hours,
            at=at,
            days=days,
            item_ids=sorted(released),
            released=released,
        )
    }
    moves, unplaced = [], []
    for item in sorted((i for i in missed if i.id in released), key=lambda i: aware(i.start_at)):
        slot = slots.get(item.id)
        if slot is not None:
            moves.append(
                RecoveryMove(
                    item.id,
                    item.title,
                    aware(item.start_at),
                    aware(item.end_at),
                    slot.start,
                    slot.end,
                )
            )
        elif item.due and aware(item.due) < at:
            unplaced.append((item.id, "overdue"))
        elif not item.minutes:
            unplaced.append((item.id, "unknown_estimate"))
        else:
            unplaced.append((item.id, "no_feasible_slot"))
    return RecoveryPlan(moves=moves, kept=kept, unplaced=unplaced)
```

Note: `project_open_tasks` with `item_ids` only ranks the selected items, but `scheduled=local` still reserves every other open block, so future blocks are never displaced.

- [x] **Step 4: Run to verify pass, plus the existing placement suite**

Run: `uv run pytest tests/test_cooper.py -q`
Expected: all PASS (the `released` default keeps existing behavior).

- [x] **Step 5: Commit** — `feat(planner): preview recovery for missed local blocks`

---

### Task 2: Read-only preview endpoint with fingerprint

**Files:**

- Modify: `cooper/app.py` (near `apply_slots` ~L2936; routes near `/api/schedule` ~L3264)
- Test: `tests/test_api.py`

**Interfaces:**

- Consumes: `planner.preview_recovery`, `RecoveryPlan`, `_external_availability(owner_id, days=8)`, `current_hours(owner_id)`, `store.open_items(session, owner_id)`.
- Produces:
  - `_recovery_fingerprint(items, hours, busy, plan) -> str` (hex SHA-256)
  - `recovery_preview(owner_id) -> dict` with keys `fingerprint`, `complete: bool`, `moves: [{item_id,title,old_start,old_end,start,end}]`, `kept: [{item_id,title,reason}]`, `unplaced: [{item_id,title,reason}]`
  - `POST /api/recovery/preview` → that dict (no write, no `Change`).

- [x] **Step 1: Write the failing tests** (append to `tests/test_api.py`)

```python
RECOVERY_AT = dt.datetime(2026, 10, 5, 2, 0, tzinfo=dt.UTC)  # Monday 10:00 SGT


def _recovery_setup(module, monkeypatch, *, busy=None, complete=True):
    monkeypatch.setattr(module, "now", lambda: RECOVERY_AT)
    monkeypatch.setattr(
        module,
        "_external_availability",
        lambda _owner, **_kw: {"complete": complete, "busy": list(busy or []), "health": []},
    )
    with module.store.session() as session:
        session.add(
            module.Item(
                id="missed-1",
                owner_id="local",
                source="me",
                kind="task",
                title="Draft memo",
                minutes=45,
                importance=3,
                category="work",
                status="open",
                start_at=RECOVERY_AT - dt.timedelta(minutes=90),
                end_at=RECOVERY_AT - dt.timedelta(minutes=45),
                created_at=RECOVERY_AT,
            )
        )


def test_recovery_preview_is_read_only(client: TestClient, monkeypatch) -> None:
    import cooper.app as module

    _recovery_setup(module, monkeypatch)
    body = client.post("/api/recovery/preview", headers=HEADERS).json()
    assert body["complete"] is True
    assert [move["item_id"] for move in body["moves"]] == ["missed-1"]
    assert len(body["fingerprint"]) == 64
    with module.store.session() as session:
        assert module.store.last_change(session, "local") is None
        item = module.store.get_item(session, "local", "missed-1")
        assert module.aware(item.end_at) == RECOVERY_AT - dt.timedelta(minutes=45)


def test_recovery_preview_proposes_nothing_when_a_calendar_failed(client, monkeypatch) -> None:
    import cooper.app as module

    _recovery_setup(module, monkeypatch, complete=False)
    body = client.post("/api/recovery/preview", headers=HEADERS).json()
    assert body["complete"] is False and body["moves"] == []
```

Check the real return shape of `_external_availability` in `app.py` (~L2473) and match the stub's keys to it before running.

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_api.py -k recovery_preview -q`
Expected: FAIL with 404/405 on `/api/recovery/preview`.

- [x] **Step 3: Implement**

```python
def _recovery_fingerprint(
    items: list[Item],
    hours: Hours,
    busy: list[tuple[dt.datetime, dt.datetime]],
    plan: planner.RecoveryPlan,
) -> str:
    """Hash every input that can change the plan, plus the plan itself."""

    def iso(value: dt.datetime | None) -> str | None:
        return aware(value).isoformat() if value else None

    payload = {
        "items": sorted(
            [
                item.id,
                iso(item.start_at),
                iso(item.end_at),
                item.minutes,
                item.status,
                int(item.pinned or 0),
                iso(item.due),
            ]
            for item in items
            if (item.source or "me") == "me"
        ),
        "hours": dataclasses.asdict(hours),
        "busy": sorted([iso(start), iso(end)] for start, end in busy),
        "moves": [[m.item_id, iso(m.start), iso(m.end)] for m in plan.moves],
        "unplaced": plan.unplaced,
        "kept": plan.kept,
    }
    encoded = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def _recovery_in_session(session, owner_id: str, hours: Hours, availability: dict[str, Any]):
    items = store.open_items(session, owner_id)
    busy = availability["busy"] if availability["complete"] else []
    plan = (
        planner.preview_recovery(items=items, remote_busy=busy, hours=hours, at=now())
        if availability["complete"]
        else planner.RecoveryPlan(moves=[], kept=[], unplaced=[])
    )
    return items, plan, _recovery_fingerprint(items, hours, busy, plan)


def _recovery_dict(items, plan, fingerprint, complete: bool) -> dict[str, Any]:
    titles = {item.id: item.title for item in items}
    return {
        "fingerprint": fingerprint,
        "complete": complete,
        "moves": [
            {
                "item_id": m.item_id,
                "title": m.title,
                "old_start": m.old_start.isoformat(),
                "old_end": m.old_end.isoformat(),
                "start": m.start.isoformat(),
                "end": m.end.isoformat(),
            }
            for m in plan.moves
        ],
        "kept": [{"item_id": i, "title": titles.get(i, ""), "reason": r} for i, r in plan.kept],
        "unplaced": [
            {"item_id": i, "title": titles.get(i, ""), "reason": r} for i, r in plan.unplaced
        ],
    }


def recovery_preview(owner_id: str) -> dict[str, Any]:
    availability = _external_availability(owner_id, days=8)
    _ensure_hours(owner_id)
    with store.session() as session:
        items, plan, fingerprint = _recovery_in_session(
            session, owner_id, current_hours(owner_id), availability
        )
        return _recovery_dict(items, plan, fingerprint, availability["complete"])


@app.post("/api/recovery/preview")
def do_recovery_preview(request: Request) -> dict[str, Any]:
    return recovery_preview(request_owner(request).uid)
```

Add `import dataclasses, hashlib, json` if missing; use the existing `Hours` import. If `Hours` is not a dataclass, serialize its fields explicitly instead of `dataclasses.asdict`.

- [x] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_api.py -k recovery -q`
Expected: PASS.

- [x] **Step 5: Commit** — `feat(api): add read-only recovery preview`

---

### Task 3: Atomic apply with stale rejection

**Files:**

- Modify: `cooper/app.py`
- Test: `tests/test_api.py`

**Interfaces:**

- Consumes: `_recovery_in_session`, `_locked_hours(session, owner_id)`, `store.record`, `_verified_write_response(result, view, operation=..., item_ids=...)`, `today_view`.
- Produces:
  - `apply_recovery(owner_id: str, fingerprint: str) -> dict` returning `{"kind": "rescheduled", "message": ..., "item_ids": [...]}`
  - `class RecoveryApplyIn(BaseModel): fingerprint: str = Field(min_length=64, max_length=64)`
  - `POST /api/recovery/apply` → verified `Reply` with `receipt` and `view`. 409 `"Your plan changed since this preview. Review the updated preview."` on mismatch; 409 `"A connected calendar couldn’t be checked, so Cooper won’t move anything."` when availability is incomplete; 422 `"Nothing to recover."` when there are no moves.
  - `Change.before = {"recovery": {"before": [{"id","start_at","end_at"}], "after": [{"id","start_at","end_at"}]}}`, label `f"Recovered {n} missed blocks"`.

- [x] **Step 1: Write the failing tests**

```python
def test_recovery_apply_moves_the_batch_with_one_change(client, monkeypatch) -> None:
    import cooper.app as module

    _recovery_setup(module, monkeypatch)
    preview = client.post("/api/recovery/preview", headers=HEADERS).json()
    response = client.post(
        "/api/recovery/apply", headers=HEADERS, json={"fingerprint": preview["fingerprint"]}
    )
    assert response.status_code == 200
    assert response.json()["kind"] == "rescheduled"
    with module.store.session() as session:
        item = module.store.get_item(session, "local", "missed-1")
        assert module.aware(item.start_at).isoformat() == preview["moves"][0]["start"]
        assert module.store.last_change(session, "local").label == "Recovered 1 missed blocks"


def test_recovery_apply_rejects_a_calendar_change_since_preview(client, monkeypatch) -> None:
    import cooper.app as module

    _recovery_setup(module, monkeypatch)
    preview = client.post("/api/recovery/preview", headers=HEADERS).json()
    move = preview["moves"][0]
    new_event = (dt.datetime.fromisoformat(move["start"]), dt.datetime.fromisoformat(move["end"]))
    monkeypatch.setattr(
        module,
        "_external_availability",
        lambda _owner, **_kw: {"complete": True, "busy": [new_event], "health": []},
    )
    response = client.post(
        "/api/recovery/apply", headers=HEADERS, json={"fingerprint": preview["fingerprint"]}
    )
    assert response.status_code == 409
    with module.store.session() as session:
        assert module.store.last_change(session, "local") is None
        item = module.store.get_item(session, "local", "missed-1")
        assert module.aware(item.end_at) == RECOVERY_AT - dt.timedelta(minutes=45)


def test_recovery_apply_rejects_a_local_edit_since_preview(client, monkeypatch) -> None:
    import cooper.app as module

    _recovery_setup(module, monkeypatch)
    preview = client.post("/api/recovery/preview", headers=HEADERS).json()
    client.patch("/api/items/missed-1", headers=HEADERS, json={"minutes": 90})
    response = client.post(
        "/api/recovery/apply", headers=HEADERS, json={"fingerprint": preview["fingerprint"]}
    )
    assert response.status_code == 409


def test_recovery_apply_refuses_when_a_calendar_failed(client, monkeypatch) -> None:
    import cooper.app as module

    _recovery_setup(module, monkeypatch)
    preview = client.post("/api/recovery/preview", headers=HEADERS).json()
    monkeypatch.setattr(
        module,
        "_external_availability",
        lambda _owner, **_kw: {"complete": False, "busy": [], "health": []},
    )
    response = client.post(
        "/api/recovery/apply", headers=HEADERS, json={"fingerprint": preview["fingerprint"]}
    )
    assert response.status_code == 409
```

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_api.py -k recovery_apply -q`
Expected: FAIL with 404/405.

- [x] **Step 3: Implement**

```python
class RecoveryApplyIn(BaseModel):
    fingerprint: str = Field(min_length=64, max_length=64)


def apply_recovery(owner_id: str, fingerprint: str) -> dict[str, Any]:
    availability = _external_availability(owner_id, days=8)
    if not availability["complete"]:
        raise HTTPException(
            409, "A connected calendar couldn’t be checked, so Cooper won’t move anything."
        )
    _ensure_hours(owner_id)
    with store.session() as session:
        hours = _locked_hours(session, owner_id)  # serializes writers before rereading
        items, plan, current = _recovery_in_session(session, owner_id, hours, availability)
        if not hmac.compare_digest(current, fingerprint):
            raise HTTPException(
                409, "Your plan changed since this preview. Review the updated preview."
            )
        if not plan.moves:
            raise HTTPException(422, "Nothing to recover.")
        before, after = [], []
        for move in plan.moves:
            item = store.get_item(session, owner_id, move.item_id)
            before.append(
                {
                    "id": item.id,
                    "start_at": move.old_start.isoformat(),
                    "end_at": move.old_end.isoformat(),
                }
            )
            item.start_at, item.end_at = move.start, move.end
            after.append(
                {"id": item.id, "start_at": move.start.isoformat(), "end_at": move.end.isoformat()}
            )
        store.record(
            session,
            owner_id,
            label=f"Recovered {len(plan.moves)} missed blocks",
            item=None,
            before={"recovery": {"before": before, "after": after}},
        )
    ids = [move.item_id for move in plan.moves]
    return {
        "kind": "rescheduled",
        "message": f"Recovered {len(ids)} missed blocks.",
        "item_ids": ids,
    }


@app.post("/api/recovery/apply")
def do_recovery_apply(body: RecoveryApplyIn, request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    result = apply_recovery(owner_id, body.fingerprint)
    item_ids = result.pop("item_ids")
    return _verified_write_response(
        result, today_view(owner_id), operation="reschedule", item_ids=item_ids
    )
```

Check `_verified_write_response`'s real signature (~L1988) and the `move_item` route (~L3202) and call it the same way. Add `import hmac` if missing. Raising `HTTPException` inside `store.session()` must roll back; confirm `Store.session` rolls back on exception (the move 422 test at ~L310 relies on this).

- [x] **Step 4: Run to verify pass**

Run: `uv run pytest tests/test_api.py -k recovery -q`
Expected: PASS.

- [x] **Step 5: Commit** — `feat(api): apply recovery atomically and reject stale previews`

---

### Task 4: Conflict-safe batch undo

**Policy (all-or-nothing):** Undo restores every moved item's old slot only if every item still exists, is open, and still has exactly the slot recovery wrote. Otherwise it changes nothing, leaves the `Change` not undone, and names the items that changed so the user can fix them manually. Only `start_at`/`end_at` are restored, so later title/estimate edits survive.

**Files:**

- Modify: `cooper/app.py` (`undo_last` ~L2967)
- Test: `tests/test_api.py`

**Interfaces:**

- Consumes: `Change.before["recovery"]` from Task 3.
- Produces: `undo_last` returns `{"kind": "undone", ...}` on success or `{"kind": "note", "message": "Can’t undo recovery: <titles> changed since. Nothing was changed."}` on conflict.

- [x] **Step 1: Write the failing tests**

```python
def _applied_recovery(client, module, monkeypatch):
    _recovery_setup(module, monkeypatch)
    preview = client.post("/api/recovery/preview", headers=HEADERS).json()
    client.post(
        "/api/recovery/apply", headers=HEADERS, json={"fingerprint": preview["fingerprint"]}
    )


def test_recovery_undo_restores_every_old_slot(client, monkeypatch) -> None:
    import cooper.app as module

    _applied_recovery(client, module, monkeypatch)
    body = client.post("/api/undo", headers=HEADERS).json()
    assert body["kind"] == "undone"
    with module.store.session() as session:
        item = module.store.get_item(session, "local", "missed-1")
        assert module.aware(item.end_at) == RECOVERY_AT - dt.timedelta(minutes=45)


def test_recovery_undo_refuses_when_an_item_diverged(client, monkeypatch) -> None:
    import cooper.app as module

    _applied_recovery(client, module, monkeypatch)
    with module.store.session() as session:  # an unrecorded write, e.g. another writer
        item = module.store.get_item(session, "local", "missed-1")
        moved_to = module.aware(item.start_at) + dt.timedelta(hours=1)
        item.start_at, item.end_at = moved_to, moved_to + dt.timedelta(minutes=45)
    body = client.post("/api/undo", headers=HEADERS).json()
    assert body["kind"] == "note" and "Draft memo" in body["message"]
    with module.store.session() as session:
        assert (
            module.aware(module.store.get_item(session, "local", "missed-1").start_at) == moved_to
        )
        assert module.store.last_change(session, "local").label.startswith("Recovered")
```

- [x] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_api.py -k recovery_undo -q`
Expected: first test FAIL (undo falls through and changes nothing but reports undone), second FAIL on `kind`.

- [x] **Step 3: Implement** — add before the `change.undone = 1` line, as a new branch after `"batch"`:

```python
        elif "recovery" in before:
            recovery = before["recovery"]
            current = {row["id"]: store.get_item(session, owner_id, row["id"])
                       for row in recovery.get("after", [])}
            diverged = [
                (item.title if item else row["id"])
                for row in recovery.get("after", [])
                if (item := current[row["id"]]) is None
                or item.status != "open"
                or _iso(item.start_at) != row["start_at"]
                or _iso(item.end_at) != row["end_at"]
            ]
            if diverged:
                return {
                    "kind": "note",
                    "message": f"Can’t undo recovery: {', '.join(diverged)} changed since. "
                    "Nothing was changed.",
                }
            for row in recovery.get("before", []):
                item = current[row["id"]]
                item.start_at = _parse(row["start_at"])
                item.end_at = _parse(row["end_at"])
```

Add a small helper next to `_restore` if none exists: `def _iso(value): return aware(value).isoformat() if value else None`. The early `return` exits the `with` block without flushing changes because nothing was modified.

- [x] **Step 4: Run to verify pass, plus the existing undo tests**

Run: `uv run pytest tests/test_api.py -k "undo or recovery" -q`
Expected: PASS.

- [x] **Step 5: Commit** — `feat(api): conflict-safe batch undo for recovery`

---

### Task 5: Home recovery preview

**Files:**

- Modify: `frontend/src/types.ts`, `frontend/src/api.ts` (~L110), `frontend/src/Home.tsx` (props ~L306, At Risk ~L572), `frontend/src/App.tsx` (~L1105)
- Test: `frontend/src/test/App.test.tsx`

**Interfaces:**

- Produces:

```ts
// types.ts
export interface RecoveryRow { item_id: string; title: string; reason: string }
export interface RecoveryMove {
  item_id: string; title: string; old_start: string; old_end: string; start: string; end: string;
}
export interface RecoveryPreview {
  fingerprint: string; complete: boolean;
  moves: RecoveryMove[]; kept: RecoveryRow[]; unplaced: RecoveryRow[];
}
// api.ts
recoveryPreview: () => call<RecoveryPreview>("/api/recovery/preview", post()),
applyRecovery: (fingerprint: string) => call<Reply>("/api/recovery/apply", post({ fingerprint })),
// Home props
onPreviewRecovery: () => Promise<RecoveryPreview | null>;
onApplyRecovery: (fingerprint: string) => Promise<boolean>;
```

UI rules:

- Show a `Review recovery` button in the At Risk section only when `planning.capacity.missed_block_ids.length > 0`.
- Clicking it loads the preview into an inline `<section aria-label="Recovery preview">` inside At Risk. Each move reads `Title: <old time> → <new time>` in `planning.timezone`. Kept rows read `Title stays (pinned)`. Unplaced rows read `Title isn’t placed: overdue | needs an estimate | no free time in the next 7 days`.
- `Apply recovery` is disabled when `moves` is empty or `complete` is false. When incomplete, show `A connected calendar couldn’t be checked, so nothing will move.`
- `Dismiss` closes the preview with no request.
- After apply: on `true`, close the preview. On `false` (409 is already announced by `act`), reload the preview and show `Your plan changed. Here’s the updated preview.`
- Don't use green or red here; those are reserved for done and gone. Use existing neutral classes.

- [x] **Step 1: Write the failing tests** (use the existing `stub`, `view`, `reply` helpers)

```tsx
const previewBody = {
  fingerprint: "a".repeat(64),
  complete: true,
  moves: [
    {
      item_id: "t1",
      title: "Draft memo",
      old_start: "2026-10-05T01:00:00+00:00",
      old_end: "2026-10-05T01:45:00+00:00",
      start: "2026-10-05T03:00:00+00:00",
      end: "2026-10-05T03:45:00+00:00",
    },
  ],
  kept: [],
  unplaced: [],
};

it("previews and applies recovery from At Risk", async () => {
  const calls = stub({
    "/api/today": view({/* capacity.missed_block_ids: ["t1"] plus a missed_block risk for t1 */}),
    "/api/recovery/preview": previewBody,
    "/api/recovery/apply": reply({ kind: "rescheduled", message: "Recovered 1 missed blocks." }),
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Review recovery" }));
  const panel = await screen.findByRole("region", { name: "Recovery preview" });
  expect(within(panel).getByText(/Draft memo/)).toBeInTheDocument();
  await userEvent.click(within(panel).getByRole("button", { name: "Apply recovery" }));
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "Recovery preview" })).toBeNull(),
  );
  expect(calls.some((c) => c.url.endsWith("/api/recovery/apply"))).toBe(true);
});

it("dismisses recovery without a request", async () => {
  const calls = stub({
    "/api/today": view({/* missed block as above */}),
    "/api/recovery/preview": previewBody,
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Review recovery" }));
  await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
  expect(calls.some((c) => c.url.endsWith("/api/recovery/apply"))).toBe(false);
});

it("disables apply when a calendar could not be checked", async () => {
  stub({
    "/api/today": view({/* missed block */}),
    "/api/recovery/preview": { ...previewBody, complete: false, moves: [] },
  });
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Review recovery" }));
  expect(await screen.findByRole("button", { name: "Apply recovery" })).toBeDisabled();
  expect(screen.getByText(/couldn’t be checked/)).toBeInTheDocument();
});
```

Match the `stub` call-record shape (`c.url` vs another field) and the `view()` capacity/risk builder arguments to the helpers at App.test.tsx ~L217–300. A 409 stub is only needed if `stub` supports status codes; otherwise cover the stale path in a Home-level test that passes `onApplyRecovery={async () => false}`.

- [x] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest --run src/test/App.test.tsx -t recovery`
Expected: FAIL, the `Review recovery` button isn't found.

- [x] **Step 3: Implement**

App wiring next to `onMove`:

```tsx
onPreviewRecovery={async () => {
  try {
    return await api.recoveryPreview();
  } catch (error) {
    if (error instanceof ApiError) announce("note", error.message);
    return null;
  }
}}
onApplyRecovery={(fingerprint) => act(() => api.applyRecovery(fingerprint))}
```

Home: add `const [recovery, setRecovery] = useState<RecoveryPreview | null>(null)` and `const [recoveryNote, setRecoveryNote] = useState<string | null>(null)`. Render the button, then the panel from the UI rules above, inside the existing At Risk `.inset`. Apply handler:

```tsx
async function applyRecovery(fingerprint: string) {
  if (await onApplyRecovery(fingerprint)) {
    setRecovery(null);
    setRecoveryNote(null);
    return;
  }
  setRecovery(await onPreviewRecovery());
  setRecoveryNote("Your plan changed. Here’s the updated preview.");
}
```

Format times with the same time formatter Home already uses for commitments, in `zone`. Render the At Risk section when `riskTargets.length > 0 || missed_block_ids.length > 0`.

- [x] **Step 4: Run the full frontend suite, format and build**

Run: `cd frontend && npm test -- --run && npm run format:check && npm run build`
Expected: PASS.

- [x] **Step 5: Commit** — `feat(web): preview and apply recovery from At Risk`

---

### Task 6: Acceptance, docs and PR

- [x] Run `uv run pytest`, `uv run ruff check . && uv run ruff format --check .`, frontend tests, format and build, and `git diff --check`.
- [ ] Run the app locally with a missed block. Check the At Risk button, the preview's old → new times in the right timezone, Dismiss, Apply, undo via Ask ("undo"), and the no-connected-calendar path. Record owner confirmation.
- [x] Update `docs/designs/cooper-product-rethink.md` (Guided recovery row), `PRD.md`/`ARCHITECTURE.md` ("recovery remains future" lines) and the spec's L279 note to say it's implemented, ungated in the beta, with the all-or-nothing undo policy.
- [x] Implement on this stacked branch (PR #15) with Conventional Commits; fill in the PR template.

## Self-review

- Spec coverage: missed-block selection (T1), pinned preserved (T1), fixed/remote immutable (T1, via `project_open_tasks` busy/scheduled), old/new times and unplaced before apply (T2, T5), reread of items/hours/providers at apply (T3), stale rejection (T3), no partial plan (T3: whole fingerprint), one transaction and one undo (T3, T4), defined undo conflict policy (T4), dismiss with no mutation (T5), Free manual rescheduling untouched (Global Constraints), recovery vs new calendar event race (T3 test).
- Open owner decision: Plus gating. Ungated in the beta by default; one guard in `apply_recovery` when billing exists.
- Known limitation: the fingerprint includes the plan, so a preview can go stale if the lead-time boundary passes a candidate slot between preview and apply. Apply then returns 409 and the UI shows the refreshed preview, which is the safe outcome.

## Execution record

2026-10-01: Tasks 1–5 implemented on the stacked branch (PR #15). Tasks 2–4 landed as
one backend commit. Deviations from the plan:

- The UI lives in a new `frontend/src/RecoveryPanel.tsx` rendered inside At Risk, which
  keeps `Home.tsx` from growing further.
- `Review recovery` appears when `planning.risks` contains a `missed_block`, not from
  `capacity.missed_block_ids`, because capacity is optional in the snapshot.
- Change labels are singular or plural (`Recovered 1 missed block`).
- The apply body forbids extra fields and requires a lowercase 64-hex fingerprint.

Evidence: backend 501 pytest pass, including 11 recovery HTTP tests and 4 pure preview
tests; Ruff check and format clean; frontend 245 tests pass, including 4 recovery UI
tests; `npm run format:check` and build pass. Browser acceptance is open until the
owner confirms it, because the agent environment cannot launch dev servers.
