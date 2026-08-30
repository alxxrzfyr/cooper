"""Cooper: the whole web app.

One file for every route, because there are only a dozen and spreading them across a layered
architecture is what made the previous attempt hard to follow.

The model proposes; this executes. `brain.py` returns a validated action and nothing else
touches the database, so a wrong answer from Gemini can be refused rather than applied.
"""

from __future__ import annotations

import contextlib
import dataclasses
import datetime as dt
import secrets
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from cooper import sources
from cooper.auth import AuthFailure, check_allowed_email, verify_firebase_token
from cooper.brain import (
    Action,
    Brain,
    guess_category,
    looks_like_a_question,
    sanitize_for_prompt,
    validate,
)
from cooper.config import Settings
from cooper.db import Change, Item, Store, aware, new_id, now
from cooper.google import Calendar, CalendarError, Gmail
from cooper.planner import Hours, Slot, place, rank
from cooper.watcher import EmailProposal, parse_confirmation

SECRET_HEADER = "X-Cooper-Key"
HOURS_SETTING = "hours"
GOOGLE_SETTING = "google"
GMAIL_SETTING = "gmail"


@dataclasses.dataclass(frozen=True, slots=True)
class SyncSummary:
    """What one Gmail pull changed locally, safe for the watcher and dashboard to consume."""

    created: int = 0
    updated: int = 0
    dropped: int = 0
    skipped: int = 0
    error: str | None = None


settings = Settings()  # type: ignore[call-arg]
store = Store(settings.database_url)
brain = Brain(
    api_key=settings.gemini_key(),
    model=settings.gemini_model,
    timezone=settings.timezone,
)
calendar = Calendar(
    client_id=settings.google_client_id,
    client_secret=settings.google_secret(),
    redirect_uri=settings.google_redirect_uri,
    encryption_key=settings.encryption(),
    calendar_id=settings.calendar_id,
)
calendar.load_token((store.get_setting(settings.owner_id, GOOGLE_SETTING) or {}).get("token"))
gmail = Gmail(calendar, lookback_days=settings.gmail_lookback_days)

app = FastAPI(title="Cooper", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.origin],
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[SECRET_HEADER, "Authorization", "Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def request_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Return useful locations without reflecting request values into an error response.

    In particular, Pydantic's normal error shape includes the rejected input. That would reflect
    a browser-provided Gemini key when it exceeds its length bound, so values are intentionally
    left out of every validation error Cooper returns.
    """
    detail = [
        {
            "type": error.get("type", "value_error"),
            "loc": error.get("loc", ()),
            "msg": "Invalid request.",
        }
        for error in exc.errors()
    ]
    return JSONResponse({"detail": detail}, status_code=422)


@app.middleware("http")
async def guard(request: Request, call_next: Any) -> Any:
    """Authenticate requests before any route code runs."""
    if request.method == "OPTIONS" or request.url.path == "/health":
        return await call_next(request)

    if request.url.path == "/api/google/callback":
        if settings.auth_mode == "local":
            return await call_next(request)
        return JSONResponse({"detail": "Invalid authentication token"}, status_code=401)

    if settings.auth_mode == "local":
        supplied = request.headers.get(SECRET_HEADER, "")
        if not secrets.compare_digest(supplied, settings.key()):
            return JSONResponse({"detail": "Wrong or missing key."}, status_code=403)
        return await call_next(request)

    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.casefold() != "bearer" or not token.strip():
        return JSONResponse({"detail": "Invalid authentication token"}, status_code=401)

    try:
        identity = verify_firebase_token(
            token.strip(),
            project_id=settings.firebase_project_id or "",
        )
        check_allowed_email(identity, frozenset(settings.allowed_emails))
    except AuthFailure as error:
        return JSONResponse({"detail": error.detail}, status_code=error.status_code)

    request.state.identity = identity
    return await call_next(request)


class Say(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    # Manual mode is local and remains the default.
    mode: Literal["manual", "ai"] = "manual"
    # This key is request-scoped and is never persisted, logged, or returned.
    gemini_api_key: str | None = Field(default=None, max_length=256)


class HoursIn(BaseModel):
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=1, le=24)
    weekdays: list[int]
    max_per_day: int = Field(ge=1, le=10)


class ItemIn(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    minutes: int | None = Field(default=None, ge=1, le=1440)
    importance: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = None


class NewItem(BaseModel):
    """Manual mode, as a form rather than a sentence.

    Every field is here as a value, so nothing is parsed and the model is never called. This is
    the whole point of requirement 6: Manual stopped meaning "type a sentence and have simple
    rules read it", which was the typing without the smartness.

    A due date arrives as a plain ISO date. A `start` datetime turns the item into an event; a
    task leaves it empty and gets booked into working hours like any other.
    """

    title: str = Field(min_length=1, max_length=300)
    kind: Literal["task", "event"] = "task"
    minutes: int | None = Field(default=None, ge=1, le=1440)
    importance: int = Field(default=3, ge=1, le=5)
    category: Literal["academics", "work", "organizations", "personal"] | None = None
    due: dt.date | None = None
    start: dt.datetime | None = None
    end: dt.datetime | None = None


class BulkIn(BaseModel):
    """A bulk complete or drop, confirmed against the exact ids shown to the user.

    The list is chosen in a first request (a match) and acted on in a second (this), so the user
    always sees what will happen before it does. Undo is enough for one item and not for twenty.
    """

    verb: Literal["complete", "drop"]
    ids: list[str] = Field(min_length=1, max_length=100)


def current_hours() -> Hours:
    saved = store.get_setting(settings.owner_id, HOURS_SETTING)
    if saved:
        return Hours.from_setting({**saved, "timezone": settings.timezone})
    return Hours(timezone=settings.timezone)


def _is_local_item(item: Item) -> bool:
    """Return whether Cooper owns an item and may change it."""
    return item.source == "me" and item.owner_id == settings.owner_id


def _require_local_item(item: Item) -> None:
    """Reject attempts to mutate an item managed by an external source."""
    if not _is_local_item(item):
        raise HTTPException(status_code=409, detail="Only items created in Cooper can be changed.")


def find(session: Any, words: str) -> Item | None:
    """Match an item by words the user typed. Exact, then contained, then nothing.

    Returning None rather than a best guess is deliberate: acting on the wrong task is worse
    than asking.
    """
    needle = words.strip().lower()
    if not needle:
        return None
    # External commitments remain visible but are changed only by their source sync.
    items = [item for item in store.open_items(session, settings.owner_id) if _is_local_item(item)]

    for item in items:
        if item.id == words or item.title.lower() == needle:
            return item

    hits = [item for item in items if needle in item.title.lower()]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        raise HTTPException(
            status_code=409,
            detail=f"“{words}” matches {len(hits)} items: "
            + ", ".join(item.title for item in hits[:4]),
        )

    words_in_needle = [word for word in needle.split() if len(word) > 3]
    loose = [
        item
        for item in items
        if words_in_needle and all(word in item.title.lower() for word in words_in_needle)
    ]
    return loose[0] if len(loose) == 1 else None


def google_events(*, days: int = 14) -> list[dict[str, Any]]:
    """Your real calendar, reduced to times and titles. Empty when Google is off."""
    if not calendar.connected:
        return []
    try:
        entries = calendar.busy(days=days)
    except CalendarError:
        # A calendar problem must never break the page. It just means less on screen.
        return []
    return [
        {
            "title": entry.title,
            "start_at": entry.start.isoformat(),
            "end_at": entry.end.isoformat(),
            "category": guess_category(entry.title),
            "mine": entry.mine,
            "source": "google",
        }
        for entry in sorted(entries, key=lambda entry: entry.start)
    ]


def busy_windows(*, days: int = 14) -> list[tuple[dt.datetime, dt.datetime]]:
    """Times already committed, from every source. The gathering itself lives in sources.py.

    Kept as a one-line wrapper so the schedulers below read the same as before and there is one
    obvious place — sources.py — where a new commitment source is added.
    """
    return sources.busy_windows(store, calendar, settings.owner_id, at=now(), days=days)


def sync_gmail_once() -> SyncSummary:
    """Read and reconcile recent confirmation proposals without touching a remote calendar.

    Gmail message ids and bodies remain inside the transport/parser boundary.  This function only
    receives the small proposal shape and is the one database writer for Gmail-backed Items.
    """
    checked_at = now()
    try:
        messages = gmail.list_messages(
            after=(
                checked_at
                - dt.timedelta(days=settings.gmail_lookback_days)
                + dt.timedelta(seconds=1)
            ),
            max_results=100,
        )
    except CalendarError:
        summary = SyncSummary(error="Gmail could not be reached.")
        _record_gmail_health(checked_at, summary)
        return summary

    proposals: list[EmailProposal] = []
    skipped = 0
    # Apply messages oldest first so later cancellations win.
    for message in sorted(messages, key=lambda entry: getattr(entry, "internal_at", checked_at)):
        try:
            proposal = parse_confirmation(message, timezone=settings.timezone, now=checked_at)
        except (TypeError, ValueError):
            proposal = None
        if proposal is None:
            skipped += 1
        else:
            proposals.append(proposal)

    summary = _reconcile_gmail_proposals(proposals, skipped=skipped)
    _record_gmail_health(checked_at, summary)
    return summary


def _reconcile_gmail_proposals(proposals: list[EmailProposal], *, skipped: int = 0) -> SyncSummary:
    """Apply Gmail proposals in one local transaction; imported changes are never undoable."""
    created = updated = dropped = 0
    with store.session() as session:
        for proposal in proposals:
            # Do not let validation invent an end time for an email proposal.
            if not proposal.cancelled and (
                proposal.start is None
                or proposal.end is None
                or proposal.start.tzinfo is None
                or proposal.end.tzinfo is None
                or proposal.end <= proposal.start
            ):
                skipped += 1
                continue
            action = validate(
                Action(
                    verb="add",
                    title=proposal.title,
                    kind="event",
                    start=proposal.start,
                    end=proposal.end,
                    category=guess_category(proposal.title),
                    source="gmail",
                )
            )
            if action.is_question:
                skipped += 1
                continue

            row = session.scalars(
                select(Item).where(
                    Item.owner_id == settings.owner_id,
                    Item.source == "gmail",
                    Item.source_ref == proposal.source_ref,
                )
            ).first()
            if proposal.cancelled:
                if row is None or row.status == "dropped":
                    skipped += 1
                    continue
                row.status = "dropped"
                dropped += 1
                continue

            if action.start is None or action.end is None:
                skipped += 1
                continue
            if row is None:
                session.add(
                    Item(
                        id=new_id(),
                        owner_id=settings.owner_id,
                        source="gmail",
                        source_ref=proposal.source_ref,
                        kind="event",
                        title=action.title or proposal.title,
                        importance=3,
                        category=action.category or "personal",
                        start_at=action.start,
                        end_at=action.end,
                        created_at=now(),
                    )
                )
                created += 1
                continue

            changed = (
                row.title != action.title
                or aware(row.start_at) != action.start.astimezone(dt.UTC)
                or aware(row.end_at) != action.end.astimezone(dt.UTC)
                or row.category != action.category
                or row.status != "open"
            )
            if not changed:
                skipped += 1
                continue
            row.title = action.title or proposal.title
            row.start_at = action.start
            row.end_at = action.end
            row.category = action.category or "personal"
            row.status = "open"
            updated += 1

    return SyncSummary(created=created, updated=updated, dropped=dropped, skipped=skipped)


def _record_gmail_health(checked_at: dt.datetime, summary: SyncSummary) -> None:
    """Keep watcher health and safe counters, never Gmail bodies or message ids."""
    store.set_setting(
        settings.owner_id,
        GMAIL_SETTING,
        {
            "last_checked": checked_at.isoformat(),
            "last_error": summary.error,
            "counts": {
                "created": summary.created,
                "updated": summary.updated,
                "dropped": summary.dropped,
                "skipped": summary.skipped,
            },
        },
    )


def today_view(*, using_model: bool | None = None) -> dict[str, Any]:
    at = now()
    hours = current_hours()
    zone = ZoneInfo(settings.timezone)

    with store.session() as session:
        items = store.open_items(session, settings.owner_id)
        ranked = rank(items, at=at)
        scheduled = [
            item.to_dict()
            for item in sorted(
                (item for item in items if item.start_at),
                key=lambda entry: aware(entry.start_at) or at,
            )
        ]
        change = store.last_change(session, settings.owner_id)
        undo_label = change.label if change else None
    gmail_health = store.get_setting(settings.owner_id, GMAIL_SETTING) or {}
    gmail_counts = gmail_health.get("counts") or {}

    return {
        "now": at.isoformat(),
        "today": at.astimezone(zone).date().isoformat(),
        "timezone": settings.timezone,
        "shortlist": [
            {**entry.item.to_dict(), "score": entry.score, "why": entry.why} for entry in ranked
        ],
        "scheduled": scheduled,
        "hours": hours.as_setting(),
        "events": google_events(),
        "undo": undo_label,
        "using_model": brain.using_model if using_model is None else using_model,
        "calendar": {
            "configured": calendar.configured,
            "connected": calendar.connected,
            "email": (store.get_setting(settings.owner_id, GOOGLE_SETTING) or {}).get("email"),
        },
        "gmail": {
            "configured": gmail.configured,
            "connected": gmail.connected,
            "last_checked": gmail_health.get("last_checked"),
            "last_error": gmail_health.get("last_error"),
            "imported": gmail_counts.get("created", 0),
            "skipped": gmail_counts.get("skipped", 0),
        },
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/today")
def get_today() -> dict[str, Any]:
    return today_view()


@app.post("/api/say")
def say(body: Say) -> dict[str, Any]:
    """The main entry point: one sentence in, one change out."""
    ai = body.mode == "ai"
    browser_key = body.gemini_api_key.strip() if ai and body.gemini_api_key else ""
    request_brain = brain.with_api_key(browser_key) if browser_key else brain
    with store.session() as session:
        open_items = store.open_items(session, settings.owner_id)
        open_items = [item for item in open_items if _is_local_item(item)]
        recent = [item.title for item in reversed(open_items)][:8]
        summaries = [_summarise(item) for item in open_items] if ai else []

    action = request_brain.read(body.text, recent, use_model=ai)

    # Questions are answered as text and never reach the mutation path.
    if ai and (action.verb == "show" or looks_like_a_question(body.text)):
        answered = request_brain.answer(body.text, summaries)
        if answered:
            return {
                "kind": "answered",
                "message": answered,
                "source": "gemini",
                "view": today_view(using_model=request_brain.using_model),
            }

    result = run(action)
    return {
        **result,
        "source": action.source,
        "view": today_view(using_model=request_brain.using_model),
    }


def _summarise(item: Item) -> str:
    """One line per item for the answer prompt.

    Deliberately only the facts needed to reason about time and order. No notes, no event
    description, no location, no attendees — rule five of the PRD.

    A title is whatever the user typed to create the item, so it goes through the same guard as
    anything else reaching a prompt as data: `sanitize_for_prompt` flattens the punctuation and
    line breaks an injected instruction would need, before this line is ever built.
    """
    zone = ZoneInfo(settings.timezone)
    bits = [sanitize_for_prompt(item.title), item.category]
    if item.minutes:
        bits.append(f"{item.minutes} min")
    if item.importance != 3:
        bits.append(f"importance {item.importance}")
    if item.due:
        bits.append(f"due {item.due.astimezone(zone).date().isoformat()}")
    if item.start_at:
        bits.append(f"at {item.start_at.astimezone(zone).strftime('%a %d %b %H:%M')}")
    return " · ".join(bits)


def run(action: Action) -> dict[str, Any]:
    if action.is_question:
        return {"kind": "question", "message": action.question or "Could you rephrase that?"}

    if action.verb == "show":
        return {"kind": "shown", "message": "Here is what is next."}

    if action.verb == "undo":
        return undo_last()

    if action.verb == "schedule":
        placed = schedule_now()
        if not placed:
            return {
                "kind": "note",
                "message": "Nothing to place. Tasks need a time estimate to be scheduled.",
            }
        return {
            "kind": "scheduled",
            "message": f"Placed {len(placed)} into your hours.",
            "chip": [f"{slot.title} · {slot.start.strftime('%a %H:%M')}" for slot in placed],
        }

    if action.verb == "add":
        return add(action)

    if action.verb == "batch":
        return add_batch(action)

    return change_existing(action)


def add(action: Action) -> dict[str, Any]:
    with store.session() as session:
        item = Item(
            id=new_id(),
            owner_id=settings.owner_id,
            source="me",
            kind=action.kind,
            title=action.title or "Untitled",
            minutes=action.minutes,
            importance=action.importance or 3,
            category=action.category or "personal",
            due=_as_due(action.due),
            start_at=action.start,
            end_at=action.end,
            created_at=now(),
        )
        session.add(item)
        session.flush()
        store.record(
            session,
            settings.owner_id,
            label=f"Added “{item.title}”",
            item=item,
            before=None,
        )
        payload = item.to_dict()

    if action.kind == "event" and action.start and action.end and calendar.connected:
        try:
            event_id = calendar.add_block(
                item_id=payload["id"],
                title=payload["title"],
                start=action.start,
                end=action.end,
            )
            with store.session() as session:
                stored = store.get_item(session, settings.owner_id, payload["id"])
                if stored:
                    stored.google_event_id = event_id
        except CalendarError as error:
            return {
                "kind": "added",
                "message": f"Added, but Google said: {error}",
                "item": payload,
            }

    # Sized tasks are placed immediately when they have no fixed start.
    if action.kind == "task" and not action.start:
        booked = place_one(payload["id"])
        if booked is not None:
            payload = booked
            when = to_local(booked["start_at"])
            return {
                "kind": "added",
                "message": f"Added “{payload['title']}”, {when}.",
                "item": payload,
            }
        return {
            "kind": "added",
            "message": f"Added “{payload['title']}”. No room in your hours this week.",
            "item": payload,
        }

    if payload["start_at"]:
        return {
            "kind": "added",
            "message": f"Added “{payload['title']}”, {to_local(payload['start_at'])}.",
            "item": payload,
        }

    return {"kind": "added", "message": f"Added “{payload['title']}”.", "item": payload}


def place_one(item_id: str, *, earliest: dt.datetime | None = None) -> dict[str, Any] | None:
    """Book one task into the first gap in your hours, no earlier than `earliest`.

    Returns the stored item, or None if it would not fit inside the week.

    Uses the same `place` as a whole scheduling run, so there is still exactly one piece of code
    that decides when something may happen, and it still only ever looks at working hours.

    `earliest` is how a batch sequences its steps without a dependency graph: each step after the
    first is floored to the previous step's booked end, so "research, then slides" cannot come
    back with slides before research even when research lands the busier of the two days.
    """
    at = now()
    if earliest is not None and earliest > at:
        at = earliest
    hours = current_hours()
    busy = busy_windows()

    with store.session() as session:
        item = store.get_item(session, settings.owner_id, item_id)
        if item is None or not _is_local_item(item) or item.start_at is not None:
            return None

        slots = place(rank([item], at=at), busy=busy, hours=hours, at=at, days=7)
        if not slots:
            return None

        slot = slots[0]
        item.start_at = slot.start
        item.end_at = slot.end
        session.flush()
        payload = item.to_dict()

    if calendar.connected:
        with contextlib.suppress(CalendarError):
            event_id = calendar.add_block(
                item_id=slot.item_id,
                title=slot.title,
                start=slot.start,
                end=slot.end,
            )
            with store.session() as session:
                stored = store.get_item(session, settings.owner_id, item_id)
                if stored:
                    stored.google_event_id = event_id
                    payload = stored.to_dict()

    return payload


def to_local(iso: str) -> str:
    """ "Sun 10:00", in your timezone, from the ISO string an item carries."""
    moment = dt.datetime.fromisoformat(iso).astimezone(ZoneInfo(settings.timezone))
    return moment.strftime("%a %H:%M")


def add_batch(action: Action) -> dict[str, Any]:
    """Several related tasks from one sentence, created and booked in the order given.

    Mirrors `bulk()`: several items change, but it is recorded as one `Change`, so a single undo
    removes the whole batch rather than leaving three of four steps behind. There is no second
    write path — each step is created through the same `Item` construction `add()` uses, and
    booked through the same `place_one` a lone task goes through.

    Sequencing is time, not a stored relationship. The PRD rules out "dependencies between
    tasks" as a project-management feature this app must never become, so "before X then Y" is
    expressed by flooring Y's earliest start at X's booked end, the same way working hours floor
    every task's earliest start at the moment you asked. Nothing new is stored to make that true.
    """
    steps = action.steps or ()
    created: list[dict[str, Any]] = []
    floor: dt.datetime | None = None

    with store.session() as session:
        for step in steps:
            item = Item(
                id=new_id(),
                owner_id=settings.owner_id,
                source="me",
                kind="task",
                title=step.title or "Untitled",
                minutes=step.minutes,
                importance=step.importance or 3,
                category=step.category or "personal",
                due=_as_due(step.due),
                created_at=now(),
            )
            session.add(item)
            created.append(item.id)
        session.flush()
        # One change row lets undo remove the whole batch.
        store.record(
            session,
            settings.owner_id,
            label=f"Added {len(created)} tasks",
            item=None,
            before={"batch": created},
        )
        payloads = {}
        for item_id in created:
            item = store.get_item(session, settings.owner_id, item_id)
            if item is not None:
                payloads[item_id] = item.to_dict()

    booked: list[dict[str, Any]] = []
    for item_id in created:
        result = place_one(item_id, earliest=floor)
        payload = result if result is not None else payloads[item_id]
        booked.append(payload)
        if payload["start_at"]:
            # Sequence the next step after the slot just placed.
            floor = dt.datetime.fromisoformat(payload["end_at"])

    unplaced = sum(1 for payload in booked if not payload["start_at"])
    first = booked[0]
    message = f"Added {len(booked)} tasks, starting with “{first['title']}”"
    message += f", {to_local(first['start_at'])}." if first["start_at"] else "."
    if unplaced:
        message += f" {unplaced} could not fit in your hours this week."

    return {
        "kind": "added",
        "message": message,
        "item": first,
        "chip": [
            f"{payload['title']} · {to_local(payload['start_at'])}"
            if payload["start_at"]
            else f"{payload['title']} · no room this week"
            for payload in booked
        ],
    }


def change_existing(action: Action, *, item_id: str | None = None) -> dict[str, Any]:
    with store.session() as session:
        item = (
            store.get_item(session, settings.owner_id, item_id)
            if item_id is not None
            else find(session, action.which or "")
        )
        if item is None or item.status != "open":
            return {
                "kind": "question",
                "message": f"I could not find “{action.which}”. Which one did you mean?",
            }
        _require_local_item(item)

        before = item.to_dict()
        # Each verb gets its own kind rather than a shared "changed", because the interface
        # colours them differently: finishing something is green, dropping it is red.
        if action.verb == "complete":
            item.status = "done"
            item.done_at = now()
            label = f"Completed “{item.title}”"
            kind = "completed"
        elif action.verb == "drop":
            item.status = "dropped"
            label = f"Dropped “{item.title}”"
            kind = "dropped"
        else:
            item.pinned = 0 if item.pinned else 1
            label = f"{'Pinned' if item.pinned else 'Unpinned'} “{item.title}”"
            kind = "pinned"

        store.record(session, settings.owner_id, label=label, item=item, before=before)
        payload = item.to_dict()
        event_id = item.google_event_id if item.status != "open" else None

    if event_id:
        with contextlib.suppress(CalendarError):
            calendar.remove_block(event_id)

    return {"kind": kind, "message": label + ".", "item": payload}


def schedule_now() -> list[Slot]:
    at = now()
    hours = current_hours()
    busy = busy_windows()

    with store.session() as session:
        ranked = rank(
            [item for item in store.open_items(session, settings.owner_id) if _is_local_item(item)],
            at=at,
        )
        slots = place(ranked, busy=busy, hours=hours, at=at, days=7)
        if not slots:
            return []
        for slot in slots:
            item = store.get_item(session, settings.owner_id, slot.item_id)
            if item is None:
                continue
            item.start_at = slot.start
            item.end_at = slot.end
        store.record(
            session,
            settings.owner_id,
            label=f"Scheduled {len(slots)} task{'s' if len(slots) != 1 else ''}",
            item=None,
            before={"scheduled": [slot.item_id for slot in slots]},
        )

    if calendar.connected:
        for slot in slots:
            try:
                event_id = calendar.add_block(
                    item_id=slot.item_id,
                    title=slot.title,
                    start=slot.start,
                    end=slot.end,
                )
                with store.session() as session:
                    item = store.get_item(session, settings.owner_id, slot.item_id)
                    if item:
                        item.google_event_id = event_id
            except CalendarError:
                # Leave it scheduled locally. The calendar can catch up next time.
                continue
    return slots


def undo_last() -> dict[str, Any]:
    with store.session() as session:
        change = store.last_change(session, settings.owner_id)
        if change is None:
            return {"kind": "note", "message": "Nothing to undo."}

        before = change.before or {}
        if change.item_id and not before:
            # The change created the item, so undoing means removing it.
            item = store.get_item(session, settings.owner_id, change.item_id)
            if item is not None:
                event_id = item.google_event_id
                session.delete(item)
                if event_id:
                    with contextlib.suppress(CalendarError):
                        calendar.remove_block(event_id)
        elif change.item_id:
            item = store.get_item(session, settings.owner_id, change.item_id)
            if item is not None:
                _restore(item, before)
        elif "scheduled" in before:
            for item_id in before["scheduled"]:
                item = store.get_item(session, settings.owner_id, item_id)
                if item is None:
                    continue
                if item.google_event_id:
                    with contextlib.suppress(CalendarError):
                        calendar.remove_block(item.google_event_id)
                item.start_at = None
                item.end_at = None
                item.google_event_id = None
        elif "bulk" in before:
            # A bulk complete or drop, restored item by item to exactly what each was before.
            for snapshot in before["bulk"]:
                item_id = snapshot.get("id")
                if not isinstance(item_id, str):
                    continue
                item = store.get_item(session, settings.owner_id, item_id)
                if item is not None:
                    _restore(item, snapshot)
        elif "batch" in before:
            # A batch create: every step was a new item, so undo removes all of them, the same
            # as undoing a single add removes the one item it created.
            for item_id in before["batch"]:
                item = store.get_item(session, settings.owner_id, item_id)
                if item is None:
                    continue
                event_id = item.google_event_id
                session.delete(item)
                if event_id:
                    with contextlib.suppress(CalendarError):
                        calendar.remove_block(event_id)

        change.undone = 1
        label = change.label

    return {"kind": "undone", "message": f"Undid: {label}."}


def _restore(item: Item, before: dict[str, Any]) -> None:
    item.title = before.get("title", item.title)
    item.minutes = before.get("minutes")
    item.importance = before.get("importance", 3)
    item.status = before.get("status", "open")
    item.pinned = 1 if before.get("pinned") else 0
    item.done_at = None
    item.start_at = _parse(before.get("start_at"))
    item.end_at = _parse(before.get("end_at"))


def _parse(value: Any) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return dt.datetime.fromisoformat(value)
    except ValueError:
        return None


def _as_due(day: dt.date | None) -> dt.datetime | None:
    """A due date means end of that day, in your timezone."""
    if day is None:
        return None
    zone = ZoneInfo(settings.timezone)
    return dt.datetime.combine(day, dt.time(23, 59), tzinfo=zone)


def _local(moment: dt.datetime | None) -> dt.datetime | None:
    """Tag a naive datetime as the configured zone; leave an aware one as it was sent.

    The form's date and time inputs are wall-clock in the user's own zone. Pydantic parses them
    to a naive datetime, and storing that as-is means UTC — a 3pm event lands at 3pm UTC, in the
    evening. This mirrors what brain._datetime does for the sentence path, so both entry points
    agree.
    """
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=ZoneInfo(settings.timezone))


@app.post("/api/items")
def create(body: NewItem) -> dict[str, Any]:
    """Manual mode's form: fields in, item out, no parsing and no model.

    It builds an Action by hand and hands it to the same `add` the sentence path uses, so a
    typed task is booked into working hours exactly like a parsed one, goes through the same
    undo hook, and reaches Google the same way. There is deliberately no second write path.
    """
    action = Action(
        verb="add",
        title=body.title.strip(),
        kind="event" if body.start else body.kind,
        minutes=body.minutes,
        importance=body.importance,
        # Match sentence capture: an omitted category is inferred from the title.
        category=body.category or guess_category(body.title),
        due=body.due,
        # Form times are wall-clock values in the configured zone unless an offset is supplied.
        start=_local(body.start),
        end=_local(body.end),
        source="form",
    )
    # Reject past dates here even when a client omits the input constraint.
    zone = ZoneInfo(settings.timezone)
    today = now().astimezone(zone).date()
    if body.due is not None and body.due < today:
        raise HTTPException(status_code=422, detail="A deadline can't be in the past.")
    if action.start is not None and action.start < now():
        raise HTTPException(status_code=422, detail="That time has already passed.")
    # Form actions use the same validation as model output.
    action = validate(action)
    if action.is_question:
        raise HTTPException(status_code=422, detail=action.question or "That does not add up.")
    result = add(action)
    return {**result, "source": "form", "view": today_view()}


class BulkMatch(BaseModel):
    words: str = Field(min_length=1, max_length=200)


@app.post("/api/bulk/match")
def bulk_match(body: BulkMatch) -> dict[str, Any]:
    """Find every open item a phrase matches, so the user sees the list before acting.

    A bulk verb is destructive at a scale undo cannot fix, so it is a two-step reply the way an
    ambiguous single reference is a question: first the list, then the confirmation. This is the
    list. It never writes anything.

    Matching is deliberately looser than `find()`, which asks when a phrase is ambiguous — here
    hitting several items is the intent, not a problem.
    """
    needle = " ".join(body.words.lower().split())
    with store.session() as session:
        items = [
            item for item in store.open_items(session, settings.owner_id) if _is_local_item(item)
        ]
        hits = [item for item in items if needle in item.title.lower()]
        payload = [item.to_dict() for item in hits]
    return {"matched": payload, "count": len(payload)}


@app.post("/api/bulk")
def bulk(body: BulkIn) -> dict[str, Any]:
    """Complete or drop several items at once, by the exact ids the user just saw.

    Recorded as one change so a single undo reverses the whole batch, which is the correction a
    bulk verb needs. Ids are matched exactly, never re-parsed, so the confirmation acts on
    precisely what was shown and nothing that arrived since.
    """
    done_google: list[str] = []
    touched: list[str] = []
    with store.session() as session:
        before: list[dict[str, Any]] = []
        for item_id in body.ids:
            item = store.get_item(session, settings.owner_id, item_id)
            if item is None or item.status != "open" or not _is_local_item(item):
                continue
            before.append(item.to_dict())
            if body.verb == "complete":
                item.status = "done"
                item.done_at = now()
            else:
                item.status = "dropped"
            if item.google_event_id:
                done_google.append(item.google_event_id)
            touched.append(item.title)

        if not touched:
            return {"kind": "note", "message": "Nothing matched to change.", "view": today_view()}

        verb_past = "Completed" if body.verb == "complete" else "Dropped"
        label = f"{verb_past} {len(touched)} item{'s' if len(touched) != 1 else ''}"
        # One change row for the batch: undo puts the whole set back in a single step.
        store.record(session, settings.owner_id, label=label, item=None, before={"bulk": before})

    for event_id in done_google:
        with contextlib.suppress(CalendarError):
            calendar.remove_block(event_id)

    kind = "completed" if body.verb == "complete" else "dropped"
    return {
        "kind": kind,
        "message": label + ".",
        "chip": touched[:10],
        "view": today_view(),
    }


@app.patch("/api/items/{item_id}")
def edit(item_id: str, body: ItemIn) -> dict[str, Any]:
    with store.session() as session:
        item = store.get_item(session, settings.owner_id, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="No such item.")
        _require_local_item(item)
        before = item.to_dict()
        if body.title is not None:
            item.title = body.title.strip() or item.title
        if body.minutes is not None:
            item.minutes = body.minutes
        if body.importance is not None:
            item.importance = body.importance
        if body.notes is not None:
            item.notes = body.notes
        store.record(
            session,
            settings.owner_id,
            label=f"Edited “{item.title}”",
            item=item,
            before=before,
        )
        payload = item.to_dict()
    return {"item": payload, "view": today_view()}


@app.post("/api/items/{item_id}/{verb}")
def act(item_id: str, verb: str) -> dict[str, Any]:
    if verb not in ("complete", "drop", "pin"):
        raise HTTPException(status_code=404, detail="Unknown action.")
    with store.session() as session:
        item = store.get_item(session, settings.owner_id, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="No such item.")
        _require_local_item(item)
        title = item.title
    result = change_existing(Action(verb=verb, which=title), item_id=item_id)  # type: ignore[arg-type]
    return {**result, "view": today_view()}


@app.post("/api/schedule")
def do_schedule() -> dict[str, Any]:
    slots = schedule_now()
    return {
        "placed": [
            {
                "item_id": slot.item_id,
                "title": slot.title,
                "start": slot.start.isoformat(),
                "end": slot.end.isoformat(),
                "minutes": slot.minutes,
            }
            for slot in slots
        ],
        "view": today_view(),
    }


@app.post("/api/undo")
def do_undo() -> dict[str, Any]:
    return {**undo_last(), "view": today_view()}


@app.put("/api/hours")
def set_hours(body: HoursIn) -> dict[str, Any]:
    if body.end_hour <= body.start_hour:
        raise HTTPException(status_code=422, detail="Your day has to end after it starts.")
    if not body.weekdays:
        raise HTTPException(status_code=422, detail="Pick at least one day.")
    if any(day < 0 or day > 6 for day in body.weekdays):
        raise HTTPException(status_code=422, detail="Days must be 0 (Monday) to 6 (Sunday).")
    store.set_setting(
        settings.owner_id,
        HOURS_SETTING,
        {
            "start_hour": body.start_hour,
            "end_hour": body.end_hour,
            "weekdays": sorted(set(body.weekdays)),
            "max_per_day": body.max_per_day,
        },
    )
    return {"view": today_view()}


@app.get("/api/changes")
def changes() -> dict[str, Any]:
    with store.session() as session:
        rows = list(
            session.scalars(
                select(Change)
                .where(Change.owner_id == settings.owner_id)
                .order_by(Change.at.desc(), Change.id.desc())
                .limit(20)
            )
        )
        return {
            "changes": [
                {
                    "id": row.id,
                    "at": (aware(row.at) or now()).isoformat(),
                    "label": row.label,
                    "undone": bool(row.undone),
                }
                for row in rows
            ]
        }


@app.post("/api/google/connect")
def connect() -> dict[str, str]:
    state = secrets.token_urlsafe(16)
    app.state.oauth_state = state
    try:
        return {"url": calendar.consent_url(state)}
    except CalendarError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/api/google/callback")
def callback(code: str | None = None, state: str | None = None, error: str | None = None):
    expected = getattr(app.state, "oauth_state", None)
    if error:
        return _page("Not connected", f"Google said: {error}")
    if not code:
        return _page("Nothing to do", "Google sent no authorization code.")
    if not expected or state != expected:
        return _page("Wrong origin", "That callback did not come from Cooper.")

    app.state.oauth_state = None
    try:
        token, email = calendar.exchange(code)
        sealed = calendar.seal_token(token)
        store.set_setting(settings.owner_id, GOOGLE_SETTING, {"token": sealed, "email": email})
        calendar.load_token(sealed)
    except CalendarError as failure:
        return _page("Could not connect", str(failure))
    return _page("Calendar connected", f"Cooper can now use {email or 'your calendar'}.")


@app.post("/api/google/disconnect")
def disconnect() -> dict[str, Any]:
    try:
        calendar.revoke()
    except CalendarError:
        pass
    finally:
        store.set_setting(settings.owner_id, GOOGLE_SETTING, {})
        calendar.load_token(None)
    return {"view": today_view()}


@app.post("/api/google/sync")
def sync_google() -> dict[str, Any]:
    summary = sync_gmail_once()
    return {"summary": dataclasses.asdict(summary), "view": today_view()}


def _page(title: str, message: str) -> HTMLResponse:
    return HTMLResponse(
        f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Cooper</title><style>
body{{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Rounded',system-ui,sans-serif;
background:#F5F5F7;color:#1D1D1F;display:grid;place-items:center;height:100vh;margin:0}}
main{{max-width:30rem;background:#fff;padding:2rem;border-radius:20px;
box-shadow:0 12px 40px rgba(0,0,0,.08);text-align:center}}
h1{{font-size:1.35rem;margin:0 0 .5rem}}p{{color:#6E6E73;margin:0;line-height:1.5}}
</style></head><body><main><h1>{title}</h1><p>{message}</p></main></body></html>"""
    )
