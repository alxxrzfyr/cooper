"""Google OAuth and Calendar, over the REST API directly.

No vendor SDK. The endpoints used here are few and stable, and a hand-written client keeps the
dependency surface at zero while making every request visible in one readable file.

Two guarantees this module is responsible for:
  - **Scrubbing at ingestion.** Events are converted to a narrow record with no description,
    location, meeting link, or attendee address. Those fields never leave this module, so they
    cannot reach the database or a prompt.
  - **Ownership tagging.** App-created events carry a private extended property. That tag is
    the only way Cadence recognises its own events, so it never modifies anything else.
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from cadence.core.errors import CadenceError, ProviderError, QuotaExhaustedError

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"
CALENDAR_ROOT = "https://www.googleapis.com/calendar/v3"
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"
OWNER_PROPERTY = "cadence_block_id"
REQUEST_TIMEOUT_SECONDS = 30


class CalendarSyncTokenExpired(CadenceError):
    """Google rejected the stored sync token; a full read is required."""


class CalendarAuthError(CadenceError):
    """The credential was refused. Re-authorization is needed."""


@dataclasses.dataclass(frozen=True, slots=True)
class ScrubbedEvent:
    """An event reduced to what scheduling actually needs.

    Deliberately missing: description, location, conference links, attendee addresses. Those
    are other people's information and are not required to know when the user is busy.
    """

    google_event_id: str
    calendar_id: str
    title: str
    start_utc: dt.datetime
    end_utc: dt.datetime
    is_app_owned: bool
    has_other_attendees: bool
    updated_at: dt.datetime
    cadence_block_id: str | None = None
    cancelled: bool = False


@dataclasses.dataclass(frozen=True, slots=True)
class CalendarPage:
    events: tuple[ScrubbedEvent, ...]
    next_sync_token: str | None


# (method, url, body, headers) -> decoded JSON
HttpTransport = Callable[[str, str, bytes | None, Mapping[str, str]], Mapping[str, Any]]


def build_http_transport(*, timeout: int = REQUEST_TIMEOUT_SECONDS) -> HttpTransport:
    """The real transport. The only code here that opens a socket."""

    def transport(
        method: str,
        url: str,
        body: bytes | None,
        headers: Mapping[str, str],
    ) -> Mapping[str, Any]:
        request = urllib.request.Request(  # noqa: S310 - fixed https endpoints
            url, data=body, headers=dict(headers), method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:500]
            if error.code == 410:
                raise CalendarSyncTokenExpired("sync token expired") from error
            if error.code in (401, 403) and "invalid_grant" in detail:
                raise CalendarAuthError("credential rejected by Google") from error
            if error.code == 401:
                raise CalendarAuthError("credential rejected by Google") from error
            if error.code == 429:
                raise QuotaExhaustedError("Google API quota exhausted") from error
            raise ProviderError(f"Google returned HTTP {error.code}: {detail}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ProviderError(f"Google unreachable: {error}") from error
        except json.JSONDecodeError as error:
            raise ProviderError("Google response was not JSON") from error

    return transport


def authorization_url(*, client_id: str, redirect_uri: str, state: str) -> str:
    """The URL the user visits once to grant access."""
    query = urllib.parse.urlencode(
        {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": CALENDAR_SCOPE,
            # offline plus consent is what actually returns a refresh token.
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
    )
    return f"{AUTH_ENDPOINT}?{query}"


def _form(payload: Mapping[str, str]) -> bytes:
    return urllib.parse.urlencode(payload).encode()


FORM_HEADERS = {"Content-Type": "application/x-www-form-urlencoded"}


class GoogleOAuthClient:
    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
        transport: HttpTransport,
    ) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._transport = transport

    def exchange_code(self, code: str) -> Mapping[str, Any]:
        """Trade the one-time code for tokens. Must yield a refresh token."""
        payload = self._transport(
            "POST",
            TOKEN_ENDPOINT,
            _form(
                {
                    "code": code,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "redirect_uri": self._redirect_uri,
                    "grant_type": "authorization_code",
                }
            ),
            FORM_HEADERS,
        )
        if "refresh_token" not in payload:
            raise CalendarAuthError(
                "Google returned no refresh token; the consent screen must request offline "
                "access and the grant must be new"
            )
        return payload

    def access_token(self, refresh_token: str) -> str:
        """Exchange the long-lived refresh token for a short-lived access token."""
        payload = self._transport(
            "POST",
            TOKEN_ENDPOINT,
            _form(
                {
                    "refresh_token": refresh_token,
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "grant_type": "refresh_token",
                }
            ),
            FORM_HEADERS,
        )
        token = payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise CalendarAuthError("Google did not return an access token")
        return token


def _parse_moment(value: Mapping[str, Any] | None) -> dt.datetime | None:
    """Read a Google start/end object. All-day events carry `date` instead of `dateTime`."""
    if not value:
        return None
    if "dateTime" in value:
        return dt.datetime.fromisoformat(value["dateTime"]).astimezone(dt.UTC)
    if "date" in value:
        day = dt.date.fromisoformat(value["date"])
        return dt.datetime.combine(day, dt.time.min, tzinfo=dt.UTC)
    return None


def scrub(event: Mapping[str, Any], *, calendar_id: str) -> ScrubbedEvent | None:
    """Reduce a Google event to the narrow record Cadence stores.

    Returns None for events with no usable time span. Every field not named here is dropped,
    which is an allowlist: a field Google adds later is excluded by default.
    """
    event_id = event.get("id")
    if not isinstance(event_id, str):
        return None

    cancelled = event.get("status") == "cancelled"
    start = _parse_moment(event.get("start"))
    end = _parse_moment(event.get("end"))
    if cancelled and (start is None or end is None):
        # A cancellation may arrive with no times. Keep the id so the caller can delete.
        start = start or dt.datetime.min.replace(tzinfo=dt.UTC)
        end = end or start + dt.timedelta(minutes=1)
    if start is None or end is None:
        return None
    if end <= start:
        end = start + dt.timedelta(minutes=1)

    private = (event.get("extendedProperties") or {}).get("private") or {}
    block_id = private.get(OWNER_PROPERTY)

    attendees = event.get("attendees") or []
    has_others = any(not attendee.get("self", False) for attendee in attendees)

    updated_raw = event.get("updated")
    updated = (
        dt.datetime.fromisoformat(updated_raw).astimezone(dt.UTC)
        if isinstance(updated_raw, str)
        else dt.datetime.now(tz=dt.UTC)
    )

    return ScrubbedEvent(
        google_event_id=event_id,
        calendar_id=calendar_id,
        # Titles are kept; they are the user's own words and the planner needs them.
        title=str(event.get("summary") or "(untitled)")[:500],
        start_utc=start,
        end_utc=end,
        is_app_owned=block_id is not None,
        has_other_attendees=has_others,
        updated_at=updated,
        cadence_block_id=block_id if isinstance(block_id, str) else None,
        cancelled=cancelled,
    )


class GoogleCalendarClient:
    """Reads and writes calendar events. Only ever modifies events it owns."""

    def __init__(
        self,
        *,
        access_token: str,
        transport: HttpTransport,
    ) -> None:
        self._token = access_token
        self._transport = transport

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._token}",
            "Content-Type": "application/json",
        }

    def _call(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, str] | None = None,
        payload: Mapping[str, Any] | None = None,
    ) -> Mapping[str, Any]:
        url = f"{CALENDAR_ROOT}{path}"
        if params:
            url = f"{url}?{urllib.parse.urlencode(params)}"
        body = json.dumps(payload).encode() if payload is not None else None
        return self._transport(method, url, body, self._headers)

    def list_events(
        self,
        *,
        calendar_id: str,
        sync_token: str | None = None,
        time_min: dt.datetime | None = None,
        time_max: dt.datetime | None = None,
    ) -> CalendarPage:
        """Read events, incrementally when a sync token is available.

        A `410 Gone` raises CalendarSyncTokenExpired so the caller can discard the token and
        perform a full read, which is the documented recovery.
        """
        encoded = urllib.parse.quote(calendar_id, safe="")
        params: dict[str, str] = {"maxResults": "250", "showDeleted": "true"}
        if sync_token:
            params["syncToken"] = sync_token
        else:
            # Time bounds are only legal on a full read.
            if time_min:
                params["timeMin"] = time_min.astimezone(dt.UTC).isoformat()
            if time_max:
                params["timeMax"] = time_max.astimezone(dt.UTC).isoformat()
            params["singleEvents"] = "true"

        events: list[ScrubbedEvent] = []
        page_token: str | None = None
        next_sync: str | None = None

        while True:
            page_params = dict(params)
            if page_token:
                page_params["pageToken"] = page_token
            payload = self._call("GET", f"/calendars/{encoded}/events", params=page_params)

            for raw in payload.get("items") or []:
                scrubbed = scrub(raw, calendar_id=calendar_id)
                if scrubbed is not None:
                    events.append(scrubbed)

            page_token = payload.get("nextPageToken")
            next_sync = payload.get("nextSyncToken") or next_sync
            if not page_token:
                break

        return CalendarPage(events=tuple(events), next_sync_token=next_sync)

    def insert_block(
        self,
        *,
        calendar_id: str,
        event_id: str,
        block_id: str,
        title: str,
        start_utc: dt.datetime,
        end_utc: dt.datetime,
    ) -> str:
        """Create an app-owned event with a client-chosen id.

        The id is supplied by Cadence so a retry after a timeout updates the same event
        instead of creating a duplicate.
        """
        encoded = urllib.parse.quote(calendar_id, safe="")
        payload = {
            "id": event_id,
            "summary": title,
            "start": {"dateTime": start_utc.astimezone(dt.UTC).isoformat()},
            "end": {"dateTime": end_utc.astimezone(dt.UTC).isoformat()},
            "extendedProperties": {"private": {OWNER_PROPERTY: block_id}},
            "reminders": {"useDefault": False},
        }
        try:
            response = self._call("POST", f"/calendars/{encoded}/events", payload=payload)
        except ProviderError as error:
            # 409 means the id already exists, which is exactly what idempotency wants.
            if "409" not in str(error):
                raise
            return self.update_block(
                calendar_id=calendar_id,
                event_id=event_id,
                title=title,
                start_utc=start_utc,
                end_utc=end_utc,
            )
        returned = response.get("id")
        return str(returned) if returned else event_id

    def update_block(
        self,
        *,
        calendar_id: str,
        event_id: str,
        title: str,
        start_utc: dt.datetime,
        end_utc: dt.datetime,
    ) -> str:
        encoded = urllib.parse.quote(calendar_id, safe="")
        payload = {
            "summary": title,
            "start": {"dateTime": start_utc.astimezone(dt.UTC).isoformat()},
            "end": {"dateTime": end_utc.astimezone(dt.UTC).isoformat()},
        }
        response = self._call(
            "PATCH",
            f"/calendars/{encoded}/events/{urllib.parse.quote(event_id, safe='')}",
            payload=payload,
        )
        returned = response.get("id")
        return str(returned) if returned else event_id

    def delete_block(self, *, calendar_id: str, event_id: str) -> None:
        encoded = urllib.parse.quote(calendar_id, safe="")
        try:
            self._call(
                "DELETE",
                f"/calendars/{encoded}/events/{urllib.parse.quote(event_id, safe='')}",
            )
        except ProviderError as error:
            # Already gone is the desired end state, not a failure.
            if "410" in str(error) or "404" in str(error):
                return
            raise

    def busy_spans(
        self,
        *,
        calendar_ids: Sequence[str],
        time_min: dt.datetime,
        time_max: dt.datetime,
    ) -> tuple[tuple[dt.datetime, dt.datetime], ...]:
        """Free/busy lookup. Returns opaque spans with no event details at all."""
        payload = {
            "timeMin": time_min.astimezone(dt.UTC).isoformat(),
            "timeMax": time_max.astimezone(dt.UTC).isoformat(),
            "items": [{"id": calendar_id} for calendar_id in calendar_ids],
        }
        response = self._call("POST", "/freeBusy", payload=payload)
        spans: list[tuple[dt.datetime, dt.datetime]] = []
        for entry in (response.get("calendars") or {}).values():
            for period in entry.get("busy") or []:
                start = dt.datetime.fromisoformat(period["start"]).astimezone(dt.UTC)
                end = dt.datetime.fromisoformat(period["end"]).astimezone(dt.UTC)
                if end > start:
                    spans.append((start, end))
        return tuple(sorted(spans))
