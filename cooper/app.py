"""Cooper: the whole web app.

One file for every route, because there are only a dozen and spreading them across a layered
architecture is what made the previous attempt hard to follow.

The model proposes; this executes. `brain.py` returns a validated action and nothing else
touches the database, so a wrong answer from Gemini can be refused rather than applied.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import secrets
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from cooper import sources
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
from cooper.google import Calendar, CalendarError
from cooper.planner import Hours, Slot, place, rank

SECRET_HEADER = "X-Cooper-Key"
HOURS_SETTING = "hours"
GOOGLE_SETTING = "google"

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
calendar.load_token((store.get_setting(GOOGLE_SETTING) or {}).get("token"))

app = FastAPI(title="Cooper", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.origin],
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[SECRET_HEADER, "Content-Type"],
)


@app.middleware("http")
async def guard(request: Request, call_next: Any) -> Any:
    """The whole security model: localhost, one origin, one shared key.

    There is no login because there is one user on one machine. That assumption is only safe
    while the app stays on 127.0.0.1, which is why the key is required rather than optional.

    The refusal is returned rather than raised: exception handlers do not run for middleware,
    so raising here would surface as a 500 instead of a clean 403.
    """
    if request.method == "OPTIONS" or request.url.path in ("/health", "/api/google/callback"):
        return await call_next(request)
    supplied = request.headers.get(SECRET_HEADER, "")
    if not secrets.compare_digest(supplied, settings.key()):
        return JSONResponse({"detail": "Wrong or missing key."}, status_code=403)
    return await call_next(request)


# ------------------------------------------------------------------------ shapes


class Say(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    # Manual is the default on purpose: the model has a daily quota, and the rules parser handles
    # the ordinary shapes without spending any of it. AI mode is opt-in, per message.
    mode: Literal["manual", "ai"] = "manual"


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


# ------------------------------------------------------------------------ helpers


def current_hours() -> Hours:
    saved = store.get_setting(HOURS_SETTING)
    if saved:
        return Hours.from_setting({**saved, "timezone": settings.timezone})
    return Hours(timezone=settings.timezone)


def find(session: Any, words: str) -> Item | None:
    """Match an item by words the user typed. Exact, then contained, then nothing.

    Returning None rather than a best guess is deliberate: acting on the wrong task is worse
    than asking.
    """
    needle = words.strip().lower()
    if not needle:
        return None
    items = store.open_items(session)

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
            # Google has no idea about our categories, so the title is all there is to go on.
            "category": guess_category(entry.title),
            # `mine` marks events Cooper created, so the agenda does not show them twice.
            "mine": entry.mine,
        }
        for entry in sorted(entries, key=lambda entry: entry.start)
    ]


def busy_windows(*, days: int = 14) -> list[tuple[dt.datetime, dt.datetime]]:
    """Times already committed, from every source. The gathering itself lives in sources.py.

    Kept as a one-line wrapper so the schedulers below read the same as before and there is one
    obvious place — sources.py — where a new commitment source is added.
    """
    return sources.busy_windows(store, calendar, at=now(), days=days)


def today_view() -> dict[str, Any]:
    at = now()
    hours = current_hours()
    zone = ZoneInfo(settings.timezone)

    with store.session() as session:
        items = store.open_items(session)
        ranked = rank(items, at=at)
        scheduled = [
            item.to_dict()
            for item in sorted(
                (item for item in items if item.start_at),
                key=lambda entry: aware(entry.start_at) or at,
            )
        ]
        change = store.last_change(session)
        undo_label = change.label if change else None

    return {
        "now": at.isoformat(),
        "today": at.astimezone(zone).date().isoformat(),
        "timezone": settings.timezone,
        # Everything still open, ranked, whether or not it has a time yet. A task is added
        # straight onto the calendar now, so filtering booked work out of here emptied the plan
        # the moment anything was added. "scheduled" is the calendar's feed, not a second list.
        "shortlist": [
            {**entry.item.to_dict(), "score": entry.score, "why": entry.why} for entry in ranked
        ],
        "scheduled": scheduled,
        "hours": hours.as_setting(),
        "events": google_events(),
        "undo": undo_label,
        "using_model": brain.using_model,
        "calendar": {
            "configured": calendar.configured,
            "connected": calendar.connected,
            "email": (store.get_setting(GOOGLE_SETTING) or {}).get("email"),
        },
    }


# ------------------------------------------------------------------------- routes


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
    with store.session() as session:
        open_items = store.open_items(session)
        recent = [item.title for item in reversed(open_items)][:8]
        summaries = [_summarise(item) for item in open_items] if ai else []

    action = brain.read(body.text, recent, use_model=ai)

    # In AI mode, a sentence shaped like a question — "what should I do", "is there room
    # tomorrow" — gets a real answer instead of "here is what is next" or a generic question
    # back. Nothing here writes to the database: an answer is text.
    #
    # Everything else that came back as "ask" already carries the right reply in
    # `action.question`: the prompt now tells the model to use "ask" both for a genuinely
    # ambiguous instruction ("Which one did you mean?") and for a sentence that is not a task at
    # all ("I only turn sentences into calendar tasks and events, not write poems"). Routing
    # every "ask" through `answer()` used to replace both of those specific, correct replies with
    # one generic decline, which is what made a real multi-task request look like a refusal.
    if ai and (action.verb == "show" or looks_like_a_question(body.text)):
        answered = brain.answer(body.text, summaries)
        if answered:
            return {
                "kind": "answered",
                "message": answered,
                "source": "gemini",
                "view": today_view(),
            }

    result = run(action)
    return {**result, "source": action.source, "view": today_view()}


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
        store.record(session, label=f"Added “{item.title}”", item=item, before=None)
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
                stored = session.get(Item, payload["id"])
                if stored:
                    stored.google_event_id = event_id
        except CalendarError as error:
            return {
                "kind": "added",
                "message": f"Added, but Google said: {error}",
                "item": payload,
            }

    # A task with no time of its own goes straight onto the calendar. Leaving it in the shortlist
    # until you remembered to say "plan my day" was the single most confusing thing about this
    # app: you added something, looked at the calendar, and it was not there.
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

    # An event already knows when it is, so say so rather than leaving you to go and look.
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
        item = session.get(Item, item_id)
        if item is None or item.start_at is not None:
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
                stored = session.get(Item, item_id)
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
        # One change for the whole batch: before={} for every one of them means undo deletes
        # each by id, the same as before={} means "undo removes this" for a single add.
        store.record(
            session,
            label=f"Added {len(created)} tasks",
            item=None,
            before={"batch": created},
        )
        payloads = {item_id: session.get(Item, item_id).to_dict() for item_id in created}  # type: ignore[union-attr]

    booked: list[dict[str, Any]] = []
    for item_id in created:
        result = place_one(item_id, earliest=floor)
        payload = result if result is not None else payloads[item_id]
        booked.append(payload)
        if payload["start_at"]:
            # The next step cannot start before this one's slot ends. If this step did not fit
            # anywhere, the floor does not move — the step after it is still tried from now.
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


def change_existing(action: Action) -> dict[str, Any]:
    with store.session() as session:
        item = find(session, action.which or "")
        if item is None:
            return {
                "kind": "question",
                "message": f"I could not find “{action.which}”. Which one did you mean?",
            }

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

        store.record(session, label=label, item=item, before=before)
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
        ranked = rank(store.open_items(session), at=at)
        slots = place(ranked, busy=busy, hours=hours, at=at, days=7)
        if not slots:
            return []
        for slot in slots:
            item = session.get(Item, slot.item_id)
            if item is None:
                continue
            item.start_at = slot.start
            item.end_at = slot.end
        store.record(
            session,
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
                    item = session.get(Item, slot.item_id)
                    if item:
                        item.google_event_id = event_id
            except CalendarError:
                # Leave it scheduled locally. The calendar can catch up next time.
                continue
    return slots


def undo_last() -> dict[str, Any]:
    with store.session() as session:
        change = store.last_change(session)
        if change is None:
            return {"kind": "note", "message": "Nothing to undo."}

        before = change.before or {}
        if change.item_id and not before:
            # The change created the item, so undoing means removing it.
            item = session.get(Item, change.item_id)
            if item is not None:
                event_id = item.google_event_id
                session.delete(item)
                if event_id:
                    with contextlib.suppress(CalendarError):
                        calendar.remove_block(event_id)
        elif change.item_id:
            item = session.get(Item, change.item_id)
            if item is not None:
                _restore(item, before)
        elif "scheduled" in before:
            for item_id in before["scheduled"]:
                item = session.get(Item, item_id)
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
                item = session.get(Item, snapshot.get("id"))
                if item is not None:
                    _restore(item, snapshot)
        elif "batch" in before:
            # A batch create: every step was a new item, so undo removes all of them, the same
            # as undoing a single add removes the one item it created.
            for item_id in before["batch"]:
                item = session.get(Item, item_id)
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


# ------------------------------------------------------------- direct item routes


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
        # An empty category means "work it out from the title", the way the sentence path does,
        # rather than forcing the person to categorise their own errand.
        category=body.category or guess_category(body.title),
        due=body.due,
        # A time from the form is a wall-clock time in the user's own zone. The sentence path
        # tags naive times with the configured zone; the form must do the same, or a 3pm event
        # gets stored as 3pm UTC and shows up in the evening. An offset the client did send is
        # trusted as given.
        start=_local(body.start),
        end=_local(body.end),
        source="form",
    )
    # Present or future only: a deadline or a start in the past is not something to schedule
    # around, and almost always a misclick. The form's date input sets the same floor with
    # `min`, but a request can arrive without one, so the rule lives here where it is enforced.
    zone = ZoneInfo(settings.timezone)
    today = now().astimezone(zone).date()
    if body.due is not None and body.due < today:
        raise HTTPException(status_code=422, detail="A deadline can't be in the past.")
    if action.start is not None and action.start < now():
        raise HTTPException(status_code=422, detail="That time has already passed.")
    # The same validation the model's output goes through: an event that ends before it starts
    # becomes a question, a start with no end gets one, and so on.
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
        items = store.open_items(session)
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
            item = session.get(Item, item_id)
            if item is None or item.status != "open":
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
        store.record(session, label=label, item=None, before={"bulk": before})

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
        item = session.get(Item, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="No such item.")
        before = item.to_dict()
        if body.title is not None:
            item.title = body.title.strip() or item.title
        if body.minutes is not None:
            item.minutes = body.minutes
        if body.importance is not None:
            item.importance = body.importance
        if body.notes is not None:
            item.notes = body.notes
        store.record(session, label=f"Edited “{item.title}”", item=item, before=before)
        payload = item.to_dict()
    return {"item": payload, "view": today_view()}


@app.post("/api/items/{item_id}/{verb}")
def act(item_id: str, verb: str) -> dict[str, Any]:
    if verb not in ("complete", "drop", "pin"):
        raise HTTPException(status_code=404, detail="Unknown action.")
    with store.session() as session:
        item = session.get(Item, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="No such item.")
        title = item.title
    result = change_existing(Action(verb=verb, which=title))  # type: ignore[arg-type]
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
            session.scalars(select(Change).order_by(Change.at.desc(), Change.id.desc()).limit(20))
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


# ------------------------------------------------------------------ google oauth


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
        # Without this any page could finish an authorization on your behalf.
        return _page("Wrong origin", "That callback did not come from Cooper.")

    app.state.oauth_state = None
    try:
        token, email = calendar.exchange(code)
        store.set_setting(GOOGLE_SETTING, {"token": calendar.seal_token(token), "email": email})
        calendar.load_token(calendar.seal_token(token))
    except CalendarError as failure:
        return _page("Could not connect", str(failure))
    return _page("Calendar connected", f"Cooper can now use {email or 'your calendar'}.")


@app.post("/api/google/disconnect")
def disconnect() -> dict[str, Any]:
    store.set_setting(GOOGLE_SETTING, {})
    calendar.load_token(None)
    return {"view": today_view()}


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
