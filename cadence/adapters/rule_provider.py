"""Rule-based intent parsing.

The degraded-mode provider. Handles the common sentence shapes with the standard library
only: no network, no model, no dependency. When the Gemini quota is exhausted this keeps
capture working, which is the difference between "less smart" and "broken".

It parses confidently only when the shape is unmistakable. Anything else returns Clarify,
because a wrong parse that silently mutates state is worse than a question.
"""

from __future__ import annotations

import datetime as dt
import re
from zoneinfo import ZoneInfo

from cadence.core.errors import DomainValidationError
from cadence.core.intents import (
    Clarify,
    CompleteTask,
    CreateEvent,
    CreateTask,
    DropTask,
    Intent,
    IntentContext,
    PinTask,
    Query,
    Undo,
)
from cadence.core.tasks import TaskDraft

WEEKDAYS = {
    "monday": 0,
    "mon": 0,
    "tuesday": 1,
    "tue": 1,
    "tues": 1,
    "wednesday": 2,
    "wed": 2,
    "thursday": 3,
    "thu": 3,
    "thurs": 3,
    "friday": 4,
    "fri": 4,
    "saturday": 5,
    "sat": 5,
    "sunday": 6,
    "sun": 6,
}

IMPORTANCE_WORDS = {
    "critical": 5,
    "urgent": 5,
    "important": 4,
    "normal": 3,
    "minor": 2,
    "someday": 1,
    "whenever": 1,
}

_EFFORT = re.compile(r"\b(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b")
_TIME = re.compile(r"\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b")
_DEADLINE = re.compile(r"\b(?:due|by|before)\s+(?P<when>[a-z0-9 /-]+?)(?=,|$)")
_DEFAULT_EVENT_MINUTES = 60

_COMPLETE = re.compile(r"^(?:done|finished|completed|complete|mark done)\b[:\s]*(?P<rest>.*)$")
_DROP = re.compile(r"^(?:drop|cancel|abandon|forget)\b[:\s]*(?P<rest>.*)$")
_PIN = re.compile(r"^(?:pin|focus on)\b[:\s]*(?P<rest>.*)$")
_UNDO = re.compile(r"^undo\b\s*(?P<rest>.*)$")
_QUERY_TODAY = re.compile(
    r"^(?:what(?:'s| is)? (?:next|now)|what should i (?:do|work on)|today|next)\b.*$"
)
_QUERY_BACKLOG = re.compile(r"^(?:backlog|everything|all tasks|show (?:the )?backlog)\b.*$")


def _clean(text: str) -> str:
    return " ".join(text.strip().split())


def _strip_trailing_punctuation(text: str) -> str:
    return _clean(text).rstrip(".,;:!?")


def _minutes(amount: float, unit: str) -> int:
    hours = unit.startswith("h")
    return int(round(amount * 60)) if hours else int(round(amount))


def _next_weekday(today: dt.date, weekday: int) -> dt.date:
    ahead = (weekday - today.weekday()) % 7
    return today + dt.timedelta(days=ahead or 7)


def _parse_date_phrase(phrase: str, today: dt.date) -> dt.date | None:
    text = _strip_trailing_punctuation(phrase).lower()
    if not text:
        return None
    if text == "today":
        return today
    if text == "tomorrow":
        return today + dt.timedelta(days=1)
    if text in {"next week", "in a week"}:
        return today + dt.timedelta(days=7)

    words = text.split()
    if words and words[0] == "next" and len(words) > 1 and words[1] in WEEKDAYS:
        return _next_weekday(today, WEEKDAYS[words[1]])
    for word in words:
        if word in WEEKDAYS:
            return _next_weekday(today, WEEKDAYS[word])

    for pattern in ("%Y-%m-%d", "%d/%m/%Y", "%d %B", "%d %b", "%B %d", "%b %d"):
        try:
            parsed = dt.datetime.strptime(text, pattern).date()
        except ValueError:
            continue
        return parsed.replace(year=today.year) if parsed.year == 1900 else parsed
    return None


def _parse_time(text: str) -> dt.time | None:
    match = _TIME.search(text)
    if match is None:
        return None
    if match.group(3):
        hour = int(match.group(1)) % 12
        minute = int(match.group(2) or 0)
        if match.group(3) == "pm":
            hour += 12
        return dt.time(hour, minute)
    hour, minute = int(match.group(4)), int(match.group(5))
    if hour > 23 or minute > 59:
        return None
    return dt.time(hour, minute)


class RuleBasedProvider:
    """Offline provider. Deterministic, and never contacts a network."""

    name = "rule_based"

    def compile_intent(self, utterance: str, context: IntentContext) -> Intent:
        text = _clean(utterance)
        if not text:
            return Clarify(question="What would you like to capture?")

        lowered = text.lower()
        zone = ZoneInfo(context.timezone)

        for pattern, build in (
            (_UNDO, lambda rest: Undo(mutation_id=rest or None)),
            (_COMPLETE, lambda rest: CompleteTask(task_ref=rest) if rest else None),
            (_DROP, lambda rest: DropTask(task_ref=rest) if rest else None),
        ):
            match = pattern.match(lowered)
            if match is not None:
                rest = _strip_trailing_punctuation(match.groupdict().get("rest", ""))
                intent = build(rest)
                if intent is not None:
                    return intent
                return Clarify(question="Which task did you mean?")

        pin = _PIN.match(lowered)
        if pin is not None:
            reference = _strip_trailing_punctuation(pin.group("rest"))
            if not reference:
                return Clarify(question="Which task should be pinned?")
            return PinTask(task_ref=reference, date=context.today)

        if _QUERY_BACKLOG.match(lowered):
            return Query(kind="backlog")
        if _QUERY_TODAY.match(lowered):
            return Query(kind="today")

        event = self._try_event(text, lowered, context, zone)
        if event is not None:
            return event

        return self._task(text, lowered, context)

    def _try_event(
        self,
        text: str,
        lowered: str,
        context: IntentContext,
        zone: ZoneInfo,
    ) -> Intent | None:
        """A fixed commitment needs both a date and a clock time to be unambiguous."""
        clock_time = _parse_time(lowered)
        if clock_time is None:
            return None

        day = _parse_date_phrase(lowered, context.today)
        if day is None:
            for word in lowered.split():
                if word in WEEKDAYS:
                    day = _next_weekday(context.today, WEEKDAYS[word])
                    break
        if day is None:
            day = context.today

        title = self._event_title(text)
        if not title:
            return Clarify(question="What is the event called?")

        start = dt.datetime.combine(day, clock_time, tzinfo=zone)
        minutes = _DEFAULT_EVENT_MINUTES
        effort = _EFFORT.search(lowered)
        if effort is not None:
            minutes = _minutes(float(effort.group(1)), effort.group(2))
        try:
            return CreateEvent(title=title, start=start, end=start + dt.timedelta(minutes=minutes))
        except DomainValidationError:
            return Clarify(question="When does that event start and end?")

    @staticmethod
    def _event_title(text: str) -> str:
        without_time = _TIME.sub("", text)
        words = [
            word
            for word in without_time.split()
            if word.lower() not in WEEKDAYS
            and word.lower() not in {"on", "at", "next", "today", "tomorrow"}
        ]
        return _strip_trailing_punctuation(" ".join(words))

    def _task(self, text: str, lowered: str, context: IntentContext) -> Intent:
        effort_minutes: int | None = None
        effort = _EFFORT.search(lowered)
        if effort is not None:
            effort_minutes = _minutes(float(effort.group(1)), effort.group(2))

        importance = 3
        for word, level in IMPORTANCE_WORDS.items():
            if re.search(rf"\b{word}\b", lowered):
                importance = level
                break

        deadline: dt.date | None = None
        deadline_match = _DEADLINE.search(lowered)
        if deadline_match is not None:
            deadline = _parse_date_phrase(deadline_match.group("when"), context.today)

        title = self._task_title(text)
        if not title:
            return Clarify(question="What should the task be called?")

        try:
            draft = TaskDraft(
                title=title,
                effort_minutes=effort_minutes,
                importance=importance,
                deadline=deadline,
            )
        except DomainValidationError as error:
            return Clarify(question=f"I could not read that as a task: {error}")
        return CreateTask(draft=draft)

    @staticmethod
    def _task_title(text: str) -> str:
        """The first comma-delimited clause, minus any metadata that leaked into it."""
        head = text.split(",")[0]
        head = _EFFORT.sub("", head)
        head = _DEADLINE.sub("", head.lower()) if _DEADLINE.search(head.lower()) else head
        for word in IMPORTANCE_WORDS:
            head = re.sub(rf"\b{word}\b", "", head, flags=re.IGNORECASE)
        return _strip_trailing_punctuation(head)
