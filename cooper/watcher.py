"""Safely reduce known event confirmations to short, validated proposals."""

from __future__ import annotations

import dataclasses
import datetime as dt
import html
import re
import threading
from collections.abc import Callable
from email.utils import parseaddr
from html.parser import HTMLParser
from typing import TYPE_CHECKING
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cooper.google import GmailMessage

if TYPE_CHECKING:
    from cooper.app import SyncSummary


@dataclasses.dataclass(frozen=True, slots=True)
class EmailProposal:
    provider: str
    title: str
    source_ref: str
    start: dt.datetime | None
    end: dt.datetime | None
    cancelled: bool


class Watcher:
    """Run the app-owned Gmail sync on one fixed interval."""

    def __init__(self, run_once: Callable[[], SyncSummary], interval_seconds: int) -> None:
        if interval_seconds < 1:
            raise ValueError("Watcher interval must be positive.")
        self._run_once = run_once
        self._interval_seconds = interval_seconds

    def run_forever(self, stop_event: threading.Event | None = None) -> None:
        stop = stop_event or threading.Event()
        while not stop.is_set():
            self._run_once()
            stop.wait(self._interval_seconds)


_SENDER_DOMAINS = {
    "luma": "luma.com",
    "meetup": "meetup.com",
    "eventbrite": "eventbrite.com",
}
_URL = re.compile(r"https?://[^\s<>'\"]+", re.IGNORECASE)
_TITLE = re.compile(
    r"(?im)^(?:title|event\s+title|event\s+name)\s*:\s*"
    r"(?P<value>[^\n]+(?:\n[ \t]+[^\n]+)*)"
)
_DATE_LINE = re.compile(
    r"(?im)^(?:when|date(?:\s+and\s+time)?|time)\s*:\s*"
    r"(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*,?\s*)?"
    r"(?P<date>(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|"
    r"dec(?:ember)?)\s+\d{1,2},\s+\d{4})\s*,?\s*"
    r"(?P<start>\d{1,2}(?::\d{2})?\s*(?:a\.?(?:m\.?)|p\.?(?:m\.?)))\s*"
    r"(?:-|–|—|to)\s*"
    r"(?P<end>\d{1,2}(?::\d{2})?\s*(?:a\.?(?:m\.?)|p\.?(?:m\.?)))\s*$"
)
_DATE_LABEL = re.compile(r"(?im)^(?:when|date(?:\s+and\s+time)?|time)\s*:")
_CONFIRMATION = re.compile(
    r"\b(?:rsvp|registration|order)\s+(?:is\s+)?confirmed\b|\byou(?:'re| are) going\b",
    re.IGNORECASE,
)
_CANCELLED = re.compile(
    r"\b(?:event|rsvp|registration|order).{0,30}\b(?:cancelled|canceled)\b",
    re.IGNORECASE,
)


def parse_confirmation(
    message: GmailMessage, *, timezone: str, now: dt.datetime
) -> EmailProposal | None:
    """Return one provider event proposal, or nothing when the email is not certain enough."""
    if now.tzinfo is None or now.utcoffset() is None:
        return None
    try:
        zone = ZoneInfo(timezone)
    except ZoneInfoNotFoundError:
        return None

    provider = _provider_from(message.headers)
    if provider is None:
        return None

    body = _strip_html(message.body)
    subject = _header(message.headers, "subject")
    text = f"{subject}\n{body}"
    cancelled = bool(_CANCELLED.search(text))
    if not cancelled and not _CONFIRMATION.search(text):
        return None

    title = _title_from(body)
    reference = _reference_from(provider, body)
    if title is None or reference is None:
        return None

    moments = _moments_from(body, zone)
    if moments is None and (not cancelled or _DATE_LABEL.search(body)):
        return None
    start, end = moments if moments is not None else (None, None)
    return EmailProposal(
        provider=provider,
        title=title,
        source_ref=reference,
        start=start,
        end=end,
        cancelled=cancelled,
    )


def _provider_from(headers: dict[str, str]) -> str | None:
    sender = _header(headers, "from")
    _, address = parseaddr(sender)
    domain = address.rpartition("@")[2].lower()
    for provider, allowed in _SENDER_DOMAINS.items():
        if domain == allowed or domain.endswith(f".{allowed}"):
            return provider
    return None


def _header(headers: dict[str, str], name: str) -> str:
    for key, value in headers.items():
        if key.lower() == name:
            return value
    return ""


class _TextOnly(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"br", "div", "p", "li", "tr"}:
            self.parts.append("\n")
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.parts.extend(("\n", href, "\n"))

    def handle_endtag(self, tag: str) -> None:
        if tag in {"div", "p", "li", "tr"}:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _strip_html(body: str) -> str:
    parser = _TextOnly()
    parser.feed(body)
    parser.close()
    return html.unescape("".join(parser.parts))


def _title_from(body: str) -> str | None:
    matches = {_normalize(match.group("value")) for match in _TITLE.finditer(body)}
    matches.discard("")
    if len(matches) != 1:
        return None
    title = matches.pop()
    if len(title) > 200 or "http://" in title or "https://" in title:
        return None
    return title


def _reference_from(provider: str, body: str) -> str | None:
    references = {
        reference
        for url in _URL.findall(body)
        if (reference := _provider_reference(provider, url.rstrip(".,);]}\"'"))) is not None
    }
    return references.pop() if len(references) == 1 else None


def _provider_reference(provider: str, url: str) -> str | None:
    parsed = urlparse(url)
    host = parsed.hostname.lower() if parsed.hostname else ""
    path = parsed.path.strip("/")
    if provider == "luma" and _is_domain(host, "lu.ma"):
        match = re.fullmatch(r"([A-Za-z0-9_-]{3,})", path)
        return f"luma:{match.group(1)}" if match else None
    if provider == "meetup" and _is_domain(host, "meetup.com"):
        match = re.search(r"/events/(\d{6,})(?:/|$)", parsed.path)
        return f"meetup:{match.group(1)}" if match else None
    if provider == "eventbrite" and _is_domain(host, "eventbrite.com"):
        match = re.search(r"(?:-|/)(\d{6,})(?:/|$)", path)
        return f"eventbrite:{match.group(1)}" if match else None
    return None


def _is_domain(host: str, allowed: str) -> bool:
    return host == allowed or host.endswith(f".{allowed}")


def _moments_from(body: str, zone: ZoneInfo) -> tuple[dt.datetime, dt.datetime] | None:
    moments: set[tuple[dt.datetime, dt.datetime]] = set()
    for match in _DATE_LINE.finditer(body):
        start = _local_moment(match.group("date"), match.group("start"), zone)
        end = _local_moment(match.group("date"), match.group("end"), zone)
        if start is None or end is None or end <= start:
            return None
        moments.add((start, end))
    return moments.pop() if len(moments) == 1 else None


def _local_moment(date: str, time: str, zone: ZoneInfo) -> dt.datetime | None:
    clean_time = re.sub(r"\.", "", time).upper()
    for date_format in ("%B %d, %Y", "%b %d, %Y"):
        for time_format in ("%I:%M %p", "%I %p"):
            try:
                naive = dt.datetime.strptime(f"{date} {clean_time}", f"{date_format} {time_format}")
            except ValueError:
                continue
            return _unambiguous_local(naive, zone)
    return None


def _unambiguous_local(naive: dt.datetime, zone: ZoneInfo) -> dt.datetime | None:
    first = naive.replace(tzinfo=zone, fold=0)
    second = naive.replace(tzinfo=zone, fold=1)
    first_valid = first.astimezone(dt.UTC).astimezone(zone).replace(tzinfo=None) == naive
    second_valid = second.astimezone(dt.UTC).astimezone(zone).replace(tzinfo=None) == naive
    if not first_valid or not second_valid or first.utcoffset() != second.utcoffset():
        return None
    return first


def _normalize(value: str) -> str:
    return " ".join(value.split())


def main() -> None:
    """Start the one app-owned sync loop without importing the app at module load time."""
    from cooper.app import settings, sync_gmail_once

    Watcher(
        lambda: sync_gmail_once(settings.owner_id), settings.gmail_poll_interval_seconds
    ).run_forever()


if __name__ == "__main__":
    main()
