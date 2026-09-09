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
        description = component.get("DESCRIPTION")
        organizer = component.get("ORGANIZER")
        organizer_email = _mailto(organizer)
        organizer_name = _param(organizer, "CN")
        attendees = _attendees(component)
        self_status = next(
            (
                guest["response_status"]
                for guest in attendees
                if guest["email"] and guest["email"].lower() == self._email.lower()
            ),
            None,
        )
        return CalendarEvent(
            event_id=key,
            title=str(component.get("SUMMARY", "Busy")),
            start=start,
            end=end,
            all_day=all_day,
            time_zone=_param(component.get("DTSTART"), "TZID") or str(self._zone),
            meeting_url=url if url.startswith("https://") else None,
            location=str(component.get("LOCATION", "")).strip() or None,
            description=(str(description).strip() or None) if description else None,
            organizer_email=organizer_email,
            organizer_name=organizer_name,
            response_status=self_status,
            attendees=tuple(attendees),
            mine=False,
            calendar_name=calendar_ref,
            links=_links(component, url),
            reminders=_reminders(component),
            attachments=_attachments(component),
            metadata=_metadata(component),
        )

    def _moment(self, value: dt.date) -> dt.datetime:
        if isinstance(value, dt.datetime):
            return (value if value.tzinfo else value.replace(tzinfo=self._zone)).astimezone(dt.UTC)
        return dt.datetime.combine(value, dt.time(), self._zone).astimezone(dt.UTC)


def _mailto(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).removeprefix("mailto:").strip()
    return text or None


def _param(value: object, name: str) -> str | None:
    params = getattr(value, "params", None)
    if not params:
        return None
    raw = params.get(name)
    if isinstance(raw, (list, tuple)):
        raw = raw[0] if raw else None
    text = str(raw).strip() if raw is not None else ""
    return text or None


def _partstat(value: object) -> str | None:
    raw = (_param(value, "PARTSTAT") or "").upper()
    mapping = {
        "ACCEPTED": "accepted",
        "DECLINED": "declined",
        "TENTATIVE": "tentative",
        "NEEDS-ACTION": "needsAction",
    }
    return mapping.get(raw)


def _attendees(component: Event) -> list[dict[str, str | None]]:
    raw = component.get("ATTENDEE")
    if raw is None:
        items: list[object] = []
    elif isinstance(raw, list):
        items = list(raw)
    else:
        items = [raw]
    guests: list[dict[str, str | None]] = []
    for item in items:
        email = _mailto(item)
        if not email:
            continue
        guests.append(
            {
                "email": email,
                "name": _param(item, "CN"),
                "response_status": _partstat(item),
            }
        )
    return guests


def _values(component: Event, key: str) -> list[object]:
    value = component.get(key)
    if value is None:
        return []
    return list(value) if isinstance(value, list) else [value]


def _links(component: Event, url: str) -> tuple[dict[str, str], ...]:
    values = [url, *[str(value) for value in _values(component, "URL")]]
    return tuple(
        {"label": "Event link", "url": value}
        for value in dict.fromkeys(values)
        if value.startswith(("https://", "http://"))
    )


def _reminders(component: Event) -> tuple[dict[str, str | int | bool | None], ...]:
    reminders: list[dict[str, str | int | bool | None]] = []
    for alarm in getattr(component, "subcomponents", []):
        if getattr(alarm, "name", "") != "VALARM":
            continue
        trigger = alarm.get("TRIGGER")
        reminders.append(
            {
                "method": str(alarm.get("ACTION", "display")).lower(),
                "minutes": None,
                "use_default": False,
                "trigger": trigger.to_ical().decode("utf-8") if trigger is not None else None,
            }
        )
    return tuple(reminders)


def _attachments(component: Event) -> tuple[dict[str, str | None], ...]:
    return tuple(
        {"title": None, "url": str(value), "mime_type": None}
        for value in _values(component, "ATTACH")
    )


def _metadata(component: Event) -> tuple[dict[str, str], ...]:
    return ({"label": "Original calendar event", "value": component.to_ical().decode("utf-8")},)
