"""Turning a sentence into an action.

Two paths, tried in order:

1. Gemini, asked for strict JSON. One call, one retry, then it gives up.
2. A regex parser, which needs no key and no network.

The model only ever proposes an action. This module decides whether it is legal, and `app.py`
is the only thing that touches the database. That separation is the one piece of the old
architecture worth keeping: a wrong answer from the model can be rejected, never executed.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import re
import urllib.error
import urllib.request
from typing import Any, Literal
from zoneinfo import ZoneInfo

Verb = Literal["add", "complete", "drop", "pin", "schedule", "show", "undo", "ask"]
Category = Literal["academics", "work", "organizations", "personal"]

VERBS = ("add", "complete", "drop", "pin", "schedule", "show", "undo", "ask")
CATEGORIES = ("academics", "work", "organizations", "personal")

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models"
TIMEOUT = 20

SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["verb"],
    "properties": {
        "verb": {"type": "string", "enum": list(VERBS)},
        "title": {"type": "string"},
        "which": {"type": "string", "description": "words identifying an existing item"},
        "minutes": {"type": "integer"},
        "importance": {"type": "integer"},
        "due": {"type": "string", "description": "ISO date"},
        "start": {"type": "string", "description": "ISO datetime with offset"},
        "end": {"type": "string", "description": "ISO datetime with offset"},
        "kind": {"type": "string", "enum": ["task", "event"]},
        "category": {"type": "string", "enum": list(CATEGORIES)},
        "question": {"type": "string"},
    },
}

PROMPT = """You turn one sentence into one JSON action for a personal calendar app.

Verbs:
  add       create a task, or an event when a specific time is given
  complete  mark an existing item done
  drop      cancel an existing item
  pin       force an item to the top of today
  schedule  place unscheduled tasks into the user's working hours
  show      the user is just asking what to do
  undo      reverse the last change
  ask       you cannot tell what they mean, so ask a short question

Categories, for colour-coding the calendar:
  academics      classes, exams, readings, anything for a course
  work           a job, clients, deadlines, paid work
  organizations  clubs, committees, volunteering, community groups
  personal       everything else, including health, errands and family

Rules:
  Times are ISO with an offset. Dates are ISO.
  minutes is a whole number. importance is 1 to 5, 5 highest.
  Use "which" for words that identify an existing item, never invent an id.
  Always set category when adding. Prefer personal if genuinely unclear.
  If the sentence is ambiguous, use "ask" rather than guessing.

Today is {today} ({weekday}) in {tz}.
{recent}
Sentence: {sentence}"""

ANSWER_PROMPT = """You answer questions about one person's own tasks and calendar. Nothing else.

Their open items are listed below. Answer only from that list and from today's date. If the
question is not about their tasks, their time, or what to do next, say in one line that you only
cover their tasks, and stop.

How to write:
  Talk like a person, not a report. Short sentences.
  No semicolons. No em dashes. No colons that introduce a list.
  No headings, no bullet points, no markdown, no bold.
  Sixty words at the very most. Fewer is better.
  If the list does not answer the question, say so plainly instead of guessing.

Today is {today} ({weekday}) in {tz}.

Their items:
{items}

Question: {question}"""

# An answer is text, so nothing validates it the way the schema validates an action. Length is
# the one thing worth enforcing: a model that starts writing an essay is not answering.
ANSWER_LIMIT = 700


@dataclasses.dataclass(frozen=True, slots=True)
class Action:
    """What to do. Validated, so `app.py` can execute it without second-guessing."""

    verb: Verb
    title: str | None = None
    which: str | None = None
    minutes: int | None = None
    importance: int | None = None
    due: dt.date | None = None
    start: dt.datetime | None = None
    end: dt.datetime | None = None
    kind: str = "task"
    category: str | None = None
    question: str | None = None
    source: str = "rules"

    @property
    def is_question(self) -> bool:
        return self.verb == "ask"


class Brain:
    def __init__(self, *, api_key: str | None, model: str, timezone: str) -> None:
        self._key = api_key
        self._model = model
        self._tz = timezone

    @property
    def using_model(self) -> bool:
        return bool(self._key)

    def read(self, sentence: str, recent_titles: list[str], *, use_model: bool = True) -> Action:
        """Sentence to action. `use_model=False` is Manual mode: rules only, no network, no quota.

        Manual mode exists because the model has a daily limit and most sentences do not need it.
        The rules parser handles the shapes people actually type, so leaning on Gemini for every
        message spends a finite thing on a solved problem.
        """
        text = " ".join(sentence.split())
        if not text:
            return Action(verb="ask", question="What would you like to add?")

        if self._key and use_model:
            for attempt in (1, 2):
                try:
                    payload = self._call_gemini(text, recent_titles, repair=attempt == 2)
                    return _from_json(payload, tz=self._tz, source="gemini")
                except Exception:
                    continue

        return parse_with_rules(text, tz=self._tz)

    def answer(self, question: str, items: list[str]) -> str | None:
        """Answer a question about the given items, or None if the model cannot be reached.

        Only the caller's own words and its own item summaries go out. Never notes, never event
        descriptions, locations or attendees. Ask about anything else and the prompt tells the
        model to decline, which keeps this a calendar assistant rather than a chatbot.
        """
        text = " ".join(question.split())
        if not text or not self._key:
            return None

        today = dt.datetime.now(ZoneInfo(self._tz))
        prompt = ANSWER_PROMPT.format(
            today=today.date().isoformat(),
            weekday=today.strftime("%A"),
            tz=self._tz,
            items="\n".join(f"  {line}" for line in items) or "  (nothing open)",
            question=text,
        )

        try:
            reply = self._generate(prompt)
        except Exception:
            return None

        cleaned = " ".join(reply.split())
        if not cleaned:
            return None
        return cleaned[:ANSWER_LIMIT]

    def _call_gemini(
        self,
        sentence: str,
        recent: list[str],
        *,
        repair: bool,
    ) -> dict[str, Any]:
        today = dt.datetime.now(ZoneInfo(self._tz))
        prompt = PROMPT.format(
            today=today.date().isoformat(),
            weekday=today.strftime("%A"),
            tz=self._tz,
            recent=("Recent items: " + "; ".join(recent[:8]) if recent else ""),
            sentence=sentence,
        )
        if repair:
            prompt += "\nYour last answer was not valid JSON for the schema. Try again."

        text = self._generate(prompt, schema=SCHEMA)
        decoded = json.loads(text)
        if not isinstance(decoded, dict):
            raise ValueError("model did not return an object")
        return decoded

    def _generate(self, prompt: str, *, schema: dict[str, Any] | None = None) -> str:
        """One call to Gemini. JSON when a schema is given, plain text when not."""
        config: dict[str, Any] = {"temperature": 0}
        if schema is not None:
            config["responseMimeType"] = "application/json"
            config["responseSchema"] = schema

        body = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "generationConfig": config})
        request = urllib.request.Request(  # noqa: S310 - fixed https endpoint
            f"{GEMINI_URL}/{self._model}:generateContent",
            data=body.encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": self._key or ""},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310
            envelope = json.loads(response.read())
        return str(envelope["candidates"][0]["content"]["parts"][0]["text"])


def _from_json(payload: dict[str, Any], *, tz: str, source: str) -> Action:
    verb = payload.get("verb")
    if verb not in VERBS:
        raise ValueError(f"unknown verb {verb!r}")

    minutes = payload.get("minutes")
    if minutes is not None:
        minutes = int(minutes)
        if minutes <= 0:
            minutes = None

    importance = payload.get("importance")
    if importance is not None:
        importance = max(1, min(5, int(importance)))

    action = Action(
        verb=verb,  # type: ignore[arg-type]
        title=_clean(payload.get("title")),
        which=_clean(payload.get("which")),
        minutes=minutes,
        importance=importance,
        due=_date(payload.get("due")),
        start=_datetime(payload.get("start"), tz),
        end=_datetime(payload.get("end"), tz),
        kind="event" if payload.get("kind") == "event" else "task",
        category=_category(payload.get("category"), payload.get("title")),
        question=_clean(payload.get("question")),
        source=source,
    )
    return _sanity_check(action)


def _sanity_check(action: Action) -> Action:
    """Reject actions that cannot be executed, so nothing half-formed reaches the database."""
    if action.verb == "add" and not action.title:
        return Action(verb="ask", question="What should I call it?", source=action.source)
    if action.verb in ("complete", "drop", "pin") and not action.which:
        return Action(verb="ask", question="Which one did you mean?", source=action.source)
    if action.start and action.end and action.end <= action.start:
        return Action(
            verb="ask",
            question="When does that end?",
            source=action.source,
        )
    if action.start and not action.end:
        minutes = action.minutes or 60
        action = dataclasses.replace(action, end=action.start + dt.timedelta(minutes=minutes))
    if action.start:
        action = dataclasses.replace(action, kind="event")
    return action


def _category(value: Any, title: Any) -> str | None:
    """Trust the model only if it names a category we actually have."""
    if isinstance(value, str) and value.lower() in CATEGORIES:
        return value.lower()
    return guess_category(title) if isinstance(title, str) else None


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    text = " ".join(value.split()).strip(" .,;:!?")
    return text or None


def _date(value: Any) -> dt.date | None:
    if isinstance(value, str):
        try:
            return dt.date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _datetime(value: Any, tz: str) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        moment = dt.datetime.fromisoformat(value)
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=ZoneInfo(tz))


# --------------------------------------------------------------------- rules path

WEEKDAYS = {
    "monday": 0, "mon": 0, "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2, "thursday": 3, "thu": 3, "thurs": 3,
    "friday": 4, "fri": 4, "saturday": 5, "sat": 5, "sunday": 6, "sun": 6,
}  # fmt: skip

IMPORTANCE_WORDS = {
    "critical": 5, "urgent": 5, "asap": 5,
    "important": 4, "big": 4,
    "normal": 3,
    "minor": 2, "small": 2,
    "someday": 1, "whenever": 1, "later": 1,
}  # fmt: skip

# Ordered most specific first: a study group is academics before it is a group.
CATEGORY_WORDS: dict[str, tuple[str, ...]] = {
    "academics": (
        "class", "classes", "lecture", "lectures", "exam", "exams", "midterm", "midterms",
        "finals", "quiz", "homework", "assignment", "assignments", "thesis", "dissertation",
        "study", "studying", "revise", "revision", "essay", "lab", "seminar", "professor",
        "prof", "school", "university", "uni", "college", "tutorial", "coursework", "syllabus",
        "semester", "defense", "reading", "readings", "problem set", "pset",
    ),
    "organizations": (
        "org", "orgs", "club", "committee", "volunteer", "volunteering", "chapter", "society",
        "council", "fundraiser", "community", "outreach", "rehearsal", "meetup", "assembly",
        "membership", "officers", "alumni", "church", "ministry", "charity",
    ),
    "work": (
        "work", "meeting", "standup", "client", "clients", "deadline", "report", "invoice",
        "boss", "manager", "shift", "interview", "sprint", "deploy", "release", "budget",
        "presentation", "deck", "proposal", "stakeholder", "payroll", "onboarding", "retro",
        "sync", "quarterly", "kpi", "okr", "ticket", "email", "reply", "standup", "job",
    ),
}  # fmt: skip


def guess_category(text: str) -> str:
    """Which colour this belongs under. Personal is the honest default, not a guess."""
    lowered = text.lower()
    for category, words in CATEGORY_WORDS.items():
        for word in words:
            if re.search(rf"\b{re.escape(word)}\b", lowered):
                return category
    return "personal"


_MINUTES = re.compile(r"\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b")
_CLOCK = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b")
_DUE = re.compile(r"\b(?:due|by|before)\s+(?P<when>[a-z0-9 /-]+?)(?=,|$)")

_COMPLETE = re.compile(r"^(?:done|finished|completed|complete)\b[:\s]*(?P<rest>.*)$")
_DROP = re.compile(r"^(?:drop|cancel|remove|forget)\b[:\s]*(?P<rest>.*)$")
_PIN = re.compile(r"^(?:pin|focus on|first)\b[:\s]*(?P<rest>.*)$")
_UNDO = re.compile(r"^undo\b")
_SCHEDULE = re.compile(r"^(?:schedule|plan)\b(?:\s+(?:my\s+)?(?:day|tasks|shortlist))?\s*$")
_SHOW = re.compile(
    r"^(?:what(?:'s| is)?\s+(?:next|now|first)|what should i (?:do|work on)"
    r"|today|next|show me|shortlist)\b.*$"
)

# Anything shaped like a question is not something to create. Without this, "what should I focus
# on" became a task called "what is my plate", because the parser fell through to `add`.
# Anchored with a word boundary so "whatsapp the client back" stays an instruction.
_QUESTION = re.compile(
    r"^(?:what|when|where|which|who|why|how"
    r"|am i|are there|can i|did i|do i|does|is there|should i|will i)\b"
)


def looks_like_a_question(text: str) -> bool:
    """True for a sentence that asks rather than instructs.

    Used in two places: the rules parser refuses to create anything from one, and AI mode sends
    one to the answer path. Deliberately code rather than prompt, because "did my question turn
    into a task" is exactly the kind of mistake a model should not be allowed to make.
    """
    lowered = " ".join(text.lower().split())
    if not lowered:
        return False
    return lowered.endswith("?") or bool(_QUESTION.match(lowered))


def parse_with_rules(sentence: str, *, tz: str) -> Action:
    """The offline path. Handles the shapes people actually type."""
    text = " ".join(sentence.split())
    lowered = text.lower()
    zone = ZoneInfo(tz)
    today = dt.datetime.now(zone).date()

    if _UNDO.match(lowered):
        return Action(verb="undo")
    if _SCHEDULE.match(lowered):
        return Action(verb="schedule")
    if _SHOW.match(lowered):
        return Action(verb="show")
    if looks_like_a_question(lowered):
        # A question the rules cannot answer still must not become a task. Manual mode shows the
        # list, AI mode answers it properly.
        return Action(verb="show")

    for pattern, verb in ((_COMPLETE, "complete"), (_DROP, "drop"), (_PIN, "pin")):
        match = pattern.match(lowered)
        if match:
            which = _clean(match.group("rest"))
            if not which:
                return Action(verb="ask", question="Which one did you mean?")
            return Action(verb=verb, which=which)  # type: ignore[arg-type]

    minutes = None
    found = _MINUTES.search(lowered)
    if found:
        amount, unit = float(found.group(1)), found.group(2)
        minutes = int(round(amount * 60)) if unit.startswith("h") else int(round(amount))

    importance = None
    for word, level in IMPORTANCE_WORDS.items():
        if re.search(rf"\b{word}\b", lowered):
            importance = level
            break

    due = None
    due_match = _DUE.search(lowered)
    if due_match:
        due = _phrase_to_date(due_match.group("when"), today)

    clock = _clock_time(lowered)
    start = None
    if clock is not None:
        day = _phrase_to_date(lowered, today) or today
        start = dt.datetime.combine(day, clock, tzinfo=zone)

    title = _strip_metadata(text)
    if not title:
        return Action(verb="ask", question="What should I call it?")

    action = Action(
        verb="add",
        title=title,
        minutes=minutes,
        importance=importance,
        due=due,
        start=start,
        kind="event" if start else "task",
        # The whole sentence, not the trimmed title: the giveaway word is often the part
        # that gets stripped out, as in "study, 2h, due friday".
        category=guess_category(lowered),
    )
    return _sanity_check(action)


def _clock_time(text: str) -> dt.time | None:
    match = _CLOCK.search(text)
    if match is None:
        return None
    if match.group(3):
        hour = int(match.group(1)) % 12
        minute = int(match.group(2) or 0)
        if match.group(3) == "pm":
            hour += 12
        return dt.time(hour, minute)
    hour, minute = int(match.group(4)), int(match.group(5))
    return dt.time(hour, minute) if hour < 24 and minute < 60 else None


def _phrase_to_date(phrase: str, today: dt.date) -> dt.date | None:
    text = phrase.strip().lower()
    if "today" in text:
        return today
    if "tomorrow" in text:
        return today + dt.timedelta(days=1)
    if "next week" in text:
        return today + dt.timedelta(days=7)

    words = text.split()
    for index, word in enumerate(words):
        if word in WEEKDAYS:
            target = WEEKDAYS[word]
            ahead = (target - today.weekday()) % 7
            if ahead == 0 and index > 0 and words[index - 1] == "next":
                ahead = 7
            return today + dt.timedelta(days=ahead or 7)

    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d %B", "%B %d", "%d %b", "%b %d"):
        try:
            parsed = dt.datetime.strptime(text, pattern).date()
        except ValueError:
            continue
        return parsed.replace(year=today.year) if parsed.year == 1900 else parsed
    return None


def _strip_metadata(text: str) -> str | None:
    """The title is the sentence minus the bits we already turned into fields."""
    head = text.split(",")[0]
    head = _MINUTES.sub("", head)
    head = _CLOCK.sub("", head)
    lowered = head.lower()
    if _DUE.search(lowered):
        head = _DUE.sub("", lowered)
    for word in IMPORTANCE_WORDS:
        head = re.sub(rf"\b{word}\b", "", head, flags=re.IGNORECASE)
    for filler in ("on", "at", "next", "today", "tomorrow"):
        head = re.sub(rf"\b{filler}\b", "", head, flags=re.IGNORECASE)
    for name in WEEKDAYS:
        head = re.sub(rf"\b{name}\b", "", head, flags=re.IGNORECASE)
    return _clean(head)
