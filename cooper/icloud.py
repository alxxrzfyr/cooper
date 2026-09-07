"""Read iCloud calendars through CalDAV, without exposing the saved credential."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
from zoneinfo import ZoneInfo

from caldav import DAVClient
from cryptography.fernet import Fernet, InvalidToken
from icalendar import Event

from cooper.google import Busy, CalendarError, CalendarEvent


class ICloudCalDAVProvider:
    def __init__(
        self, *, encryption_key: str | None, sealed: str | None = None, timezone: str = "UTC"
    ) -> None:
        self._fernet = Fernet(encryption_key.encode()) if encryption_key else None
        self._zone = ZoneInfo(timezone)
        self._email = ""
        self._password = ""
        if sealed and self._fernet:
            try:
                saved = json.loads(self._fernet.decrypt(sealed.encode()))
                if (
                    isinstance(saved, dict)
                    and isinstance(saved.get("email"), str)
                    and isinstance(saved.get("password"), str)
                ):
                    self._email, self._password = saved["email"], saved["password"]
            except (InvalidToken, ValueError, TypeError):
                pass

    @property
    def configured(self) -> bool:
        return self._fernet is not None

    @property
    def connected(self) -> bool:
        return bool(self._email and self._password)

    @property
    def email(self) -> str | None:
        return self._email or None

    def connect(self, email: str, password: str) -> str:
        if not self._fernet:
            raise CalendarError("Server encryption must be configured before connecting iCloud.")
        self._email, self._password = email.strip(), password.strip()
        self.events(days=1)
        return self._fernet.encrypt(
            json.dumps(
                {
                    "email": self._email,
                    "password": self._password,
                }
            ).encode()
        ).decode()

    def busy(self, *, days: int = 14) -> list[Busy]:
        return [
            Busy(event.start, event.end, event.title, False) for event in self.events(days=days)
        ]

    def events(self, *, days: int = 14, lookback_days: int = 0) -> list[CalendarEvent]:
        if not self.connected:
            return []
        at = dt.datetime.now(dt.UTC)
        start, end = at - dt.timedelta(days=lookback_days), at + dt.timedelta(days=days)
        result: list[CalendarEvent] = []
        try:
            with DAVClient(
                url="https://caldav.icloud.com/",
                username=self._email,
                password=self._password,
                timeout=15,
            ) as client:
                for calendar in client.principal().calendars():
                    for resource in calendar.search(start=start, end=end, event=True, expand=True):
                        event = self._event(resource.get_icalendar_component(), str(calendar.url))
                        if event and event.end > start and event.start < end:
                            result.append(event)
        except Exception:
            raise CalendarError(
                "Could not read iCloud Calendar. Check your connection and app-specific password."
            ) from None
        return result

    def _event(self, component: Event, calendar_ref: str) -> CalendarEvent | None:
        if (
            str(component.get("STATUS", "")).upper() == "CANCELLED"
            or str(component.get("TRANSP", "")).upper() == "TRANSPARENT"
        ):
            return None
        if "DTSTART" not in component:
            return None
        raw_start = component.decoded("DTSTART")
        if not isinstance(raw_start, dt.date):
            return None
        all_day = not isinstance(raw_start, dt.datetime)
        start = self._moment(raw_start)
        if "DTEND" in component:
            end = self._moment(component.decoded("DTEND"))
        else:
            duration = (
                component.decoded("DURATION")
                if "DURATION" in component
                else dt.timedelta(days=1 if all_day else 0)
            )
            end = start + duration
        if end <= start:
            return None
        uid = str(component.get("UID", ""))
        key = hashlib.sha256(f"{calendar_ref}|{uid}|{start.isoformat()}".encode()).hexdigest()
        url = str(component.get("URL", ""))
        return CalendarEvent(
            event_id=key,
            title=str(component.get("SUMMARY", "Busy"))[:300],
            start=start,
            end=end,
            all_day=all_day,
            time_zone=str(self._zone),
            meeting_url=url if url.startswith("https://") else None,
            location=str(component.get("LOCATION", ""))[:500] or None,
            description=None,
            organizer_email=None,
            organizer_name=None,
            response_status=None,
            attendees=(),
            mine=False,
        )

    def _moment(self, value: dt.date) -> dt.datetime:
        if isinstance(value, dt.datetime):
            return (value if value.tzinfo else value.replace(tzinfo=self._zone)).astimezone(dt.UTC)
        return dt.datetime.combine(value, dt.time(), self._zone).astimezone(dt.UTC)
