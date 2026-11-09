"""Read-only planning answers from a supplied snapshot; no model, settings, or I/O."""

from __future__ import annotations

import datetime as dt
import re
from typing import Any
from zoneinfo import ZoneInfo

from cooper.brain import AskIntent
from cooper.db import Item
from cooper.planner import Hours, Slot, place, rank
from cooper.sources import merge_intervals


def answer_planning_intent(
    intent: AskIntent, question: str, view: dict[str, Any]
) -> dict[str, Any]:
    """Render common planning answers from the canonical snapshot, never model opinion."""
    planning = view["planning"]
    tasks = planning["tasks"]
    commitments = planning["commitments"]
    warnings = [
        entry.get("message") or f"{str(entry['source']).title()} calendar is unavailable."
        for entry in planning["source_health"]
        if entry["status"] != "ok"
    ]
    facts: list[str] = []

    if intent == "focus_week":
        if not tasks:
            message = "You have no open COOPER tasks to prioritize this week."
        else:
            task = tasks[0]
            reason = _recommendation_reason(task, view["timezone"])
            message = f"Your highest-priority open task is {task['title']}{reason}."
            if not planning["complete"]:
                message += (
                    " I can't confirm safe placement while a connected calendar is unavailable."
                )
            else:
                message += " This is a priority ranking, not a confirmed time slot."
            facts.append(f"{task['title']} · {reason.removeprefix(' because ')}")
    elif intent == "remaining_today":
        remaining = _commitments_on_day(
            commitments,
            view["today"],
            view["timezone"],
            after=dt.datetime.fromisoformat(view["now"]),
        )
        if not remaining:
            message = "You have no remaining calendar commitments today."
        else:
            facts = [_commitment_fact(entry, view["timezone"]) for entry in remaining]
            message = f"You still have {len(remaining)} today: " + "; ".join(facts) + "."
        pending = [task for task in tasks if task.get("start_at") is None]
        if pending:
            pending_facts = [
                f"Unscheduled · {task['title']} · "
                + (
                    f"{task['minutes']} minutes"
                    if task.get("minutes") is not None
                    else "effort unknown"
                )
                for task in pending
            ]
            message += " Unscheduled work (not all due today): " + "; ".join(pending_facts) + "."
            facts.extend(pending_facts)
    elif intent == "work_next":
        identity = planning["focus"]["now_id"] or planning["focus"]["next_id"]
        commitment = next((entry for entry in commitments if entry["id"] == identity), None)
        task = next((entry for entry in tasks if entry["id"] == identity), None)
        if commitment:
            fact = _commitment_fact(commitment, view["timezone"])
            label = "current" if commitment["id"] == planning["focus"]["now_id"] else "next"
            message = f"Your {label} commitment is {fact}."
            facts.append(fact)
        elif task:
            reason = _recommendation_reason(task, view["timezone"])
            message = f"Work on {task['title']} next{reason}."
            facts.append(f"{task['title']} · {reason.removeprefix(' because ')}")
        else:
            message = "Nothing is waiting in your COOPER plan right now."
    elif intent == "fit_duration":
        requested = _requested_minutes(question)
        free = planning["metrics"]["largest_free_block_minutes"]
        if not planning["complete"]:
            message = "I can’t confirm a free block while a connected calendar is unavailable."
        elif not _supports_today_fit(question):
            message = "Ask for one duration today, for example: Can I fit 30 minutes today?"
        elif requested is None:
            message = (
                f"Your largest remaining calendar gap today is {free} minutes. "
                "This is a gap metric, not a capacity verdict."
            )
            facts.append(f"Largest calendar gap · {free} minutes")
        elif not 1 <= requested <= 1440:
            message = "Use a duration from 1 to 1440 whole minutes today."
        else:
            slot = _fit_duration_slot(view, requested)
            if slot:
                zone = ZoneInfo(view["timezone"])
                start = slot.start.astimezone(zone).strftime("%I:%M %p").lstrip("0")
                end = slot.end.astimezone(zone).strftime("%I:%M %p").lstrip("0")
                message = (
                    f"Yes. An unsaved {requested}-minute candidate fits today at "
                    f"{start}–{end} ({view['timezone']}). It respects availability and "
                    "daily limits. This standalone check does not reserve time or "
                    "outrank unscheduled work."
                )
                facts.append(f"Unsaved candidate · {start}–{end}")
            else:
                message = (
                    f"No legal {requested}-minute slot remains today under your "
                    "availability, existing blocks, breaks, lead time, and daily limits."
                )
    elif intent == "deadline_summary":
        zone = ZoneInfo(view["timezone"])
        today = dt.date.fromisoformat(view["today"])
        deadlines = [
            task
            for task in tasks
            if task.get("due")
            and dt.datetime.fromisoformat(task["due"]).astimezone(zone).date()
            <= today + dt.timedelta(days=7)
        ]
        if not deadlines:
            message = "You have no open deadlines in the next seven days."
        else:
            facts = [
                f"{task['title']} · due "
                f"{dt.datetime.fromisoformat(task['due']).astimezone(zone).strftime('%a %d %b')}"
                for task in deadlines
            ]
            noun = "deadlines" if len(deadlines) != 1 else "deadline"
            message = f"You have {len(deadlines)} {noun}: " + "; ".join(facts) + "."
    else:
        target = (
            dt.date.fromisoformat(view["today"]) + dt.timedelta(days=1)
            if "tomorrow" in question.casefold()
            else dt.date.fromisoformat(view["today"])
        )
        day_commitments = _commitments_on_day(commitments, target.isoformat(), view["timezone"])
        conflicts = _conflict_count(day_commitments)
        occupied = _occupied_minutes(day_commitments, target, view["timezone"])
        label = "tomorrow" if target.isoformat() != view["today"] else "today"
        if not planning["complete"]:
            message = (
                f"I can’t confirm whether {label} is overloaded while a connected calendar "
                "is unavailable."
            )
        else:
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
        facts.extend([f"Scheduled · {len(day_commitments)}", f"Occupied · {occupied} minutes"])

    return {"message": message, "facts": facts, "warnings": warnings}


def _recommendation_reason(task: dict[str, Any], timezone: str) -> str:
    if task.get("pinned"):
        return " because you pinned it"
    if task.get("due"):
        due = dt.datetime.fromisoformat(task["due"]).astimezone(ZoneInfo(timezone))
        return f" because it is due {due.strftime('%a %d %b')}"
    if task.get("importance", 3) >= 4:
        return " because it is marked important"
    return ""


def _day_bounds(day: str, timezone: str) -> tuple[dt.datetime, dt.datetime]:
    zone = ZoneInfo(timezone)
    local_day = dt.date.fromisoformat(day)
    start = dt.datetime.combine(local_day, dt.time(), tzinfo=zone).astimezone(dt.UTC)
    end = dt.datetime.combine(local_day + dt.timedelta(days=1), dt.time(), tzinfo=zone).astimezone(
        dt.UTC
    )
    return start, end


def _commitments_on_day(
    commitments: list[dict[str, Any]],
    day: str,
    timezone: str,
    *,
    after: dt.datetime | None = None,
) -> list[dict[str, Any]]:
    start, end = _day_bounds(day, timezone)
    threshold = after.astimezone(dt.UTC) if after else start
    return [
        entry
        for entry in commitments
        if dt.datetime.fromisoformat(entry["start_at"]) < end
        and max(start, threshold) < dt.datetime.fromisoformat(entry["end_at"])
    ]


def _commitment_fact(commitment: dict[str, Any], timezone: str) -> str:
    if commitment.get("all_day"):
        return f"{commitment['title']} all day"
    starts = dt.datetime.fromisoformat(commitment["start_at"]).astimezone(ZoneInfo(timezone))
    return f"{commitment['title']} at {starts.strftime('%I:%M %p').lstrip('0')}"


def _supports_today_fit(question: str) -> bool:
    text = question.casefold().replace("’", "'").replace("-", " ").strip().rstrip("?.!")
    amount = r"(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)"
    unit = r"(?:hours?|hrs?|minutes?|mins?)"
    duration = (
        rf"(?:a |an )?{amount}\s*{unit}(?: (?:focus |work |study )?(?:block|session|task))? today"
    )
    return bool(
        re.fullmatch(
            rf"(?:can|could) i fit {duration}|do i have enough time for {duration}"
            r"|(?:what is|what's) my largest free block today",
            text,
        )
    )


def _fit_duration_slot(view: dict[str, Any], minutes: int) -> Slot | None:
    """Probe one unsaved session against the sampled snapshot, without reads or writes."""
    planning = view["planning"]
    at = dt.datetime.fromisoformat(planning["generated_at"])
    _, end = _day_bounds(view["today"], view["timezone"])
    scheduled = [
        Item(
            id=entry["id"],
            kind="task",
            status="open",
            source="me",
            start_at=dt.datetime.fromisoformat(entry["start_at"]),
            end_at=dt.datetime.fromisoformat(entry["end_at"]),
        )
        for entry in planning["tasks"]
        if entry.get("source", "me") == "me" and entry.get("start_at") and entry.get("end_at")
    ]
    busy = [
        (dt.datetime.fromisoformat(entry["start_at"]), dt.datetime.fromisoformat(entry["end_at"]))
        for entry in planning["commitments"]
    ]
    candidate = Item(
        id="fit-probe",
        kind="task",
        status="open",
        source="me",
        title="Unsaved session",
        minutes=minutes,
        importance=3,
        pinned=0,
        created_at=at,
        due=end,
    )
    slots = place(
        rank([candidate], at=at),
        busy=busy,
        hours=Hours.from_setting(view["hours"]),
        at=at,
        days=1,
        until=end,
        scheduled=scheduled,
    )
    return slots[0] if slots else None


def _requested_minutes(question: str) -> int | None:
    lowered = question.casefold().replace("-", " ")
    words = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}
    match = re.search(
        r"\b(?P<amount>\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*"
        r"(?P<unit>hours?|hrs?|minutes?|mins?)\b",
        lowered,
    )
    if not match:
        return None
    raw = match.group("amount")
    amount = float(words.get(raw, raw))
    minutes = amount * 60 if match.group("unit").startswith("h") else amount
    return int(minutes) if minutes.is_integer() else 0


def _conflict_count(commitments: list[dict[str, Any]]) -> int:
    count = 0
    for index, first in enumerate(commitments):
        first_start = dt.datetime.fromisoformat(first["start_at"])
        first_end = dt.datetime.fromisoformat(first["end_at"])
        for second in commitments[index + 1 :]:
            if (
                first_start < dt.datetime.fromisoformat(second["end_at"])
                and dt.datetime.fromisoformat(second["start_at"]) < first_end
            ):
                count += 1
    return count


def _occupied_minutes(commitments: list[dict[str, Any]], day: dt.date, timezone: str) -> int:
    start, end = _day_bounds(day.isoformat(), timezone)
    spans = merge_intervals(
        [
            (
                max(start, dt.datetime.fromisoformat(entry["start_at"])),
                min(end, dt.datetime.fromisoformat(entry["end_at"])),
            )
            for entry in commitments
        ]
    )
    return round(
        sum((span_end - span_start).total_seconds() / 60 for span_start, span_end in spans)
    )
