"""Google Calendar, over the REST API.

One file, no SDK. Reads your events so the planner does not double-book you, and writes the
blocks it places. Only ever modifies events it created, which it recognises by a private tag.

Without credentials every method is a no-op and `connected` is False, so the whole app still
works with the calendar switched off.
"""

from __future__ import annotations

import base64
import dataclasses
import datetime as dt
import json
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

from cryptography.fernet import Fernet, InvalidToken

from cooper.config import Settings

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://www.googleapis.com/calendar/v3"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1"
GOOGLE_SCOPES = (
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/gmail.readonly",
)
GMAIL_SENDER_QUERY = "from:(luma.com OR meetup.com OR eventbrite.com)"
TAG = "cooper"
TIMEOUT = 20


class CalendarError(Exception):
    """Something went wrong talking to Google. The message is meant to be shown."""


@dataclasses.dataclass(frozen=True, slots=True)
class Busy:
    start: dt.datetime
    end: dt.datetime
    title: str
    mine: bool


@dataclasses.dataclass(frozen=True, slots=True)
class CalendarEvent:
    """The display fields for one Google Calendar event."""

    event_id: str
    title: str
    start: dt.datetime
    end: dt.datetime
    all_day: bool
    time_zone: str | None
    meeting_url: str | None
    location: str | None
    description: str | None
    organizer_email: str | None
    organizer_name: str | None
    response_status: str | None
    attendees: tuple[dict[str, str | None], ...]
    mine: bool
    calendar_name: str | None = None
    links: tuple[dict[str, str], ...] = ()
    reminders: tuple[dict[str, str | int | bool | None], ...] = ()
    attachments: tuple[dict[str, str | None], ...] = ()
    metadata: tuple[dict[str, str], ...] = ()


@dataclasses.dataclass(frozen=True, slots=True)
class GmailMessage:
    """The short-lived content a confirmation parser needs, and nothing else."""

    headers: dict[str, str]
    body: str
    internal_at: dt.datetime


class Calendar:
    def __init__(
        self,
        *,
        client_id: str | None,
        client_secret: str | None,
        redirect_uri: str,
        encryption_key: str | None,
        refresh_token: str | None = None,
        calendar_id: str = "primary",
    ) -> None:
        self._id = client_id
        self._secret = client_secret
        self._redirect = redirect_uri
        self._calendar = calendar_id
        self._fernet = Fernet(encryption_key.encode()) if encryption_key else None
        self._refresh_token = refresh_token

    @property
    def configured(self) -> bool:
        """Whether Google credentials and a place to keep the token both exist."""
        return bool(self._id and self._secret and self._fernet)

    @property
    def connected(self) -> bool:
        return self.configured and self._refresh_token is not None

    def load_token(self, sealed: str | None) -> None:
        if not sealed or self._fernet is None:
            self._refresh_token = None
            return
        try:
            self._refresh_token = self._fernet.decrypt(sealed.encode()).decode()
        except InvalidToken:
            # The encryption key changed. Treat it as disconnected rather than crashing.
            self._refresh_token = None

    def seal_token(self, token: str) -> str:
        if self._fernet is None:
            raise CalendarError("No encryption key is set, so the token cannot be stored.")
        return self._fernet.encrypt(token.encode()).decode()

    def consent_url(self, state: str) -> str:
        if not self.configured:
            raise CalendarError(
                "Google is not set up. Add COOPER_GOOGLE_CLIENT_ID, "
                "COOPER_GOOGLE_CLIENT_SECRET and COOPER_ENCRYPTION_KEY to .env."
            )
        query = urllib.parse.urlencode(
            {
                "client_id": self._id or "",
                "redirect_uri": self._redirect,
                "response_type": "code",
                "scope": " ".join(GOOGLE_SCOPES),
                # Both flags are required for a refresh token.
                "access_type": "offline",
                "prompt": "consent",
                "state": state,
            }
        )
        return f"{AUTH_URL}?{query}"

    def exchange(self, code: str) -> tuple[str, str | None]:
        """Trade the one-time code for a refresh token. Returns (token, email)."""
        payload = self._post_form(
            TOKEN_URL,
            {
                "code": code,
                "client_id": self._id or "",
                "client_secret": self._secret or "",
                "redirect_uri": self._redirect,
                "grant_type": "authorization_code",
            },
        )
        token = payload.get("refresh_token")
        if not token:
            raise CalendarError(
                "Google did not return a refresh token. The consent screen must request "
                "offline access, and the grant has to be new."
            )
        return (str(token), _email_from(payload.get("id_token")))

    def access_token(self) -> str:
        """Refresh and return the bearer token shared by Google's read-only clients."""
        if not self._refresh_token:
            raise CalendarError("Google Calendar is not connected.")
        payload = self._post_form(
            TOKEN_URL,
            {
                "refresh_token": self._refresh_token,
                "client_id": self._id or "",
                "client_secret": self._secret or "",
                "grant_type": "refresh_token",
            },
        )
        token = payload.get("access_token")
        if not token:
            raise CalendarError("Google refused the saved credential. Reconnect to continue.")
        return str(token)

    def revoke(self) -> None:
        """Ask Google to revoke the saved grant, without blocking local disconnect."""
        if not self._refresh_token:
            return
        try:
            self._post_form(REVOKE_URL, {"token": self._refresh_token})
        except CalendarError:
            return

    def busy(self, *, days: int = 14) -> list[Busy]:
        """Events between now and the horizon, reduced to scheduling facts."""
        return [
            Busy(start=event.start, end=event.end, title=event.title, mine=event.mine)
            for event in self.events(days=days, lookback_hours=6)
        ]

    def events(
        self, *, days: int = 14, lookback_days: int = 0, lookback_hours: int = 0
    ) -> list[CalendarEvent]:
        """Events in the requested window, including fields needed by the detail view."""
        if not self.connected:
            return []
        now = dt.datetime.now(tz=dt.UTC)
        start = now - dt.timedelta(days=lookback_days, hours=lookback_hours)
        end = now + dt.timedelta(days=days)
        out: list[CalendarEvent] = []
        page_token: str | None = None
        while True:
            params = {
                "timeMin": start.isoformat(),
                "timeMax": end.isoformat(),
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "250",
            }
            if page_token:
                params["pageToken"] = page_token
            query = urllib.parse.urlencode(params)
            payload = self._call("GET", f"/calendars/{self._encoded}/events?{query}")
            for raw in payload.get("items") or []:
                event = _calendar_event(
                    raw,
                    calendar_name=payload.get("summary") or self._calendar,
                    calendar_metadata={
                        key: value for key, value in payload.items() if key != "items"
                    },
                )
                if event is not None:
                    out.append(event)
            next_token = payload.get("nextPageToken")
            if not isinstance(next_token, str) or not next_token:
                break
            page_token = next_token
        return out

    def add_block(
        self,
        *,
        item_id: str,
        title: str,
        start: dt.datetime,
        end: dt.datetime,
        description: str | None = None,
        location: str | None = None,
    ) -> str:
        """Create an event Cooper owns. The id is derived so a retry updates, not duplicates."""
        event_id = f"{TAG}{item_id}"
        body = {
            "id": event_id,
            "summary": title,
            "start": {"dateTime": start.astimezone(dt.UTC).isoformat()},
            "end": {"dateTime": end.astimezone(dt.UTC).isoformat()},
            "extendedProperties": {"private": {TAG: item_id}},
            "reminders": {"useDefault": False},
        }
        if description:
            body["description"] = description
        if location:
            body["location"] = location
        try:
            self._call("POST", f"/calendars/{self._encoded}/events", body)
        except CalendarError as error:
            if "409" not in str(error):
                raise
            existing = self._call(
                "GET",
                f"/calendars/{self._encoded}/events/{urllib.parse.quote(event_id)}",
            )
            extended = existing.get("extendedProperties")
            private = extended.get("private") if isinstance(extended, dict) else {}
            private = private if isinstance(private, dict) else {}
            if private.get(TAG) != item_id:
                raise CalendarError("Google event id is not owned by Cooper.") from None
            self._call(
                "PATCH",
                f"/calendars/{self._encoded}/events/{urllib.parse.quote(event_id)}",
                {k: v for k, v in body.items() if k != "id"},
            )
        return event_id

    def remove_block(self, event_id: str) -> None:
        if not self.connected:
            return
        try:
            existing = self._call(
                "GET",
                f"/calendars/{self._encoded}/events/{urllib.parse.quote(event_id)}",
            )
            extended = existing.get("extendedProperties")
            private = extended.get("private") if isinstance(extended, dict) else {}
            private = private if isinstance(private, dict) else {}
            if not isinstance(private.get(TAG), str) or not private[TAG]:
                raise CalendarError("Google event is not owned by Cooper.")
            self._call(
                "DELETE",
                f"/calendars/{self._encoded}/events/{urllib.parse.quote(event_id)}",
            )
        except CalendarError as error:
            # Already gone is the outcome we wanted.
            if "410" not in str(error) and "404" not in str(error):
                raise

    @property
    def _encoded(self) -> str:
        return urllib.parse.quote(self._calendar, safe="")

    def _call(self, method: str, path: str, body: dict | None = None) -> dict:
        request = urllib.request.Request(  # noqa: S310 - fixed https endpoint
            f"{API}{path}",
            data=json.dumps(body).encode() if body is not None else None,
            headers={
                "Authorization": f"Bearer {self.access_token()}",
                "Content-Type": "application/json",
            },
            method=method,
        )
        return self._send(request)

    def _post_form(self, url: str, form: dict[str, str]) -> dict:
        request = urllib.request.Request(  # noqa: S310 - fixed https endpoint
            url,
            data=urllib.parse.urlencode(form).encode(),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        return self._send(request)

    @staticmethod
    def _send(request: urllib.request.Request) -> dict:
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310
                raw = response.read()
                decoded = json.loads(raw) if raw else {}
                return decoded if isinstance(decoded, dict) else {}
        except urllib.error.HTTPError as error:
            raise CalendarError(f"Google returned {error.code}.") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise CalendarError("Could not reach Google.") from error
        except json.JSONDecodeError as error:
            raise CalendarError("Google sent a response that was not JSON.") from error


class Gmail:
    """Read-only Gmail REST access using Calendar's shared OAuth refresh path."""

    def __init__(self, calendar: Calendar, *, lookback_days: int = 14) -> None:
        if not 1 <= lookback_days <= 30:
            raise ValueError("Gmail lookback must be between 1 and 30 days.")
        self._calendar = calendar
        self._lookback_days = lookback_days

    _send = staticmethod(Calendar._send)

    @property
    def configured(self) -> bool:
        return self._calendar.configured

    @property
    def connected(self) -> bool:
        return self._calendar.connected

    def list_messages(self, *, after: dt.datetime, max_results: int) -> list[GmailMessage]:
        """Fetch recent confirmation candidates from the fixed sender allowlist.

        Google message ids are used only to retrieve each message, then discarded before the
        parser boundary. The lookback caller provides is encoded as a UTC calendar date and the
        request size is capped so a watcher cannot accidentally drain a mailbox.
        """
        if after.tzinfo is None:
            raise CalendarError("Gmail lookback must include a timezone.")
        after = after.astimezone(dt.UTC)
        if after < dt.datetime.now(tz=dt.UTC) - dt.timedelta(days=self._lookback_days):
            raise CalendarError(f"Gmail lookback cannot exceed {self._lookback_days} days.")
        if not self.connected:
            return []
        bounded = max(1, min(max_results, 100))
        day = after.date().strftime("%Y/%m/%d")
        query = urllib.parse.urlencode(
            {
                "q": f"after:{day} {GMAIL_SENDER_QUERY}",
                "maxResults": str(bounded),
            }
        )
        payload = self._call("GET", f"/users/me/messages?{query}")
        messages: list[GmailMessage] = []
        for entry in payload.get("messages") or []:
            message_id = entry.get("id") if isinstance(entry, dict) else None
            if isinstance(message_id, str):
                messages.append(self.get_message(message_id))
        return messages

    def get_message(self, message_id: str) -> GmailMessage:
        """Fetch one message in memory; this client never changes mail."""
        payload = self._call(
            "GET", f"/users/me/messages/{urllib.parse.quote(message_id, safe='')}?format=full"
        )
        raw_payload = payload.get("payload")
        if not isinstance(raw_payload, dict):
            raw_payload = {}
        headers = {
            str(entry.get("name")): str(entry.get("value"))
            for entry in raw_payload.get("headers") or []
            if isinstance(entry, dict) and isinstance(entry.get("name"), str)
        }
        raw_date = payload.get("internalDate")
        try:
            internal_at = dt.datetime.fromtimestamp(int(raw_date) / 1000, tz=dt.UTC)
        except (TypeError, ValueError, OverflowError, OSError):
            internal_at = dt.datetime.fromtimestamp(0, tz=dt.UTC)
        return GmailMessage(headers=headers, body=_gmail_body(raw_payload), internal_at=internal_at)

    def _call(self, method: str, path: str) -> dict:
        request = urllib.request.Request(  # noqa: S310 - fixed https endpoint
            f"{GMAIL_API}{path}",
            headers={"Authorization": f"Bearer {self._calendar.access_token()}"},
            method=method,
        )
        return self._send(request)


def _gmail_body(payload: dict) -> str:
    """Decode the smallest useful mail body without retaining the Gmail payload."""
    candidates: list[tuple[str, str]] = []

    def collect(part: dict) -> None:
        body = part.get("body")
        encoded = body.get("data") if isinstance(body, dict) else None
        if isinstance(encoded, str):
            try:
                decoded = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)).decode(
                    errors="replace"
                )
            except (ValueError, UnicodeDecodeError):
                decoded = ""
            candidates.append((str(part.get("mimeType") or ""), decoded))
        for child in part.get("parts") or []:
            if isinstance(child, dict):
                collect(child)

    collect(payload)
    for preferred in ("text/plain", "text/html", ""):
        for mime_type, decoded in candidates:
            if mime_type == preferred and decoded:
                return decoded
    return ""


def _calendar_event(
    raw: dict, *, calendar_name: str | None = None, calendar_metadata: dict | None = None
) -> CalendarEvent | None:
    begins = _moment(raw.get("start"))
    finishes = _moment(raw.get("end"))
    event_id = raw.get("id")
    if (
        not isinstance(event_id, str)
        or not event_id
        or begins is None
        or finishes is None
        or finishes <= begins
    ):
        return None

    start = raw.get("start") if isinstance(raw.get("start"), dict) else {}
    end = raw.get("end") if isinstance(raw.get("end"), dict) else {}
    private = (raw.get("extendedProperties") or {}).get("private") or {}
    organizer = raw.get("organizer") if isinstance(raw.get("organizer"), dict) else {}
    attendees: list[dict[str, str | None]] = []
    response_status: str | None = None
    for attendee in raw.get("attendees") or []:
        if not isinstance(attendee, dict) or not isinstance(attendee.get("email"), str):
            continue
        status = attendee.get("responseStatus")
        attendee_data = {
            "email": attendee["email"],
            "name": attendee.get("displayName")
            if isinstance(attendee.get("displayName"), str)
            else None,
            "response_status": status if isinstance(status, str) else None,
        }
        attendees.append(attendee_data)
        if attendee.get("self") is True:
            response_status = attendee_data["response_status"]

    meeting_url = _meeting_url(raw)
    links = _event_links(raw, meeting_url)
    return CalendarEvent(
        event_id=event_id,
        title=str(raw.get("summary") or "Busy"),
        start=begins,
        end=finishes,
        all_day="date" in start,
        time_zone=(
            start.get("timeZone")
            if isinstance(start.get("timeZone"), str)
            else end.get("timeZone")
            if isinstance(end.get("timeZone"), str)
            else (calendar_metadata or {}).get("timeZone")
        ),
        meeting_url=meeting_url,
        location=_text(raw.get("location")),
        description=_text(raw.get("description")),
        organizer_email=organizer.get("email") if isinstance(organizer.get("email"), str) else None,
        organizer_name=(
            organizer.get("displayName") if isinstance(organizer.get("displayName"), str) else None
        ),
        response_status=response_status,
        attendees=tuple(attendees),
        mine=TAG in private,
        calendar_name=calendar_name,
        links=links,
        reminders=_reminders(raw.get("reminders")),
        attachments=_attachments(raw.get("attachments")),
        metadata=_metadata(raw)
        + tuple(
            {"label": f"Calendar {key}", "value": json.dumps(value, ensure_ascii=False)}
            for key, value in (calendar_metadata or {}).items()
            if key not in {"nextPageToken", "nextSyncToken"}
        ),
    )


def _text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def _event_links(raw: dict, meeting_url: str | None) -> tuple[dict[str, str], ...]:
    candidates = [("Event link", raw.get("htmlLink")), ("Meeting link", meeting_url)]
    source = raw.get("source")
    if isinstance(source, dict):
        candidates.append(("Source link", source.get("url")))
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for label, candidate in candidates:
        if not isinstance(candidate, str) or candidate in seen:
            continue
        parsed = urllib.parse.urlparse(candidate)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            links.append({"label": label, "url": candidate})
            seen.add(candidate)
    return tuple(links)


def _reminders(value: object) -> tuple[dict[str, str | int | bool | None], ...]:
    if not isinstance(value, dict):
        return ()
    overrides = value.get("overrides")
    if isinstance(overrides, list):
        return tuple(
            {
                "method": entry.get("method") if isinstance(entry.get("method"), str) else None,
                "minutes": entry.get("minutes") if isinstance(entry.get("minutes"), int) else None,
                "use_default": False,
            }
            for entry in overrides
            if isinstance(entry, dict)
        )
    if value.get("useDefault") is True:
        return ({"method": None, "minutes": None, "use_default": True},)
    return ()


def _attachments(value: object) -> tuple[dict[str, str | None], ...]:
    if not isinstance(value, list):
        return ()
    return tuple(
        {
            "title": entry.get("title") if isinstance(entry.get("title"), str) else None,
            "url": entry.get("fileUrl") if isinstance(entry.get("fileUrl"), str) else None,
            "mime_type": entry.get("mimeType") if isinstance(entry.get("mimeType"), str) else None,
        }
        for entry in value
        if isinstance(entry, dict)
    )


def _metadata(raw: dict) -> tuple[dict[str, str], ...]:
    omitted = {
        "summary",
        "location",
        "hangoutLink",
        "htmlLink",
    }
    return tuple(
        {"label": key, "value": json.dumps(value, ensure_ascii=False, sort_keys=True)}
        for key, value in raw.items()
        if key not in omitted and value is not None
    )


def _meeting_url(raw: dict) -> str | None:
    candidates = [raw.get("hangoutLink")]
    conference = raw.get("conferenceData")
    if isinstance(conference, dict):
        candidates.extend(
            entry.get("uri")
            for entry in conference.get("entryPoints") or []
            if isinstance(entry, dict) and entry.get("entryPointType") == "video"
        )
    for candidate in candidates:
        if not isinstance(candidate, str):
            continue
        parsed = urllib.parse.urlparse(candidate)
        if parsed.scheme in {"http", "https"} and parsed.netloc:
            return candidate
    return None


def _moment(value: dict | None) -> dt.datetime | None:
    if not value:
        return None
    if "dateTime" in value:
        return dt.datetime.fromisoformat(value["dateTime"]).astimezone(dt.UTC)
    if "date" in value:
        day = dt.date.fromisoformat(value["date"])
        zone = ZoneInfo(Settings().timezone)
        return dt.datetime.combine(day, dt.time(), zone).astimezone(dt.UTC)
    return None


def _email_from(id_token: object) -> str | None:
    """Read the account label out of the id token, for display only."""
    if not isinstance(id_token, str) or id_token.count(".") != 2:
        return None
    try:
        body = id_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    email = claims.get("email")
    return str(email) if isinstance(email, str) else None
