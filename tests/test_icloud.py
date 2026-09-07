from __future__ import annotations

import datetime as dt

from cryptography.fernet import Fernet
from icalendar import Event

from cooper.icloud import ICloudCalDAVProvider


def provider() -> ICloudCalDAVProvider:
    return ICloudCalDAVProvider(
        encryption_key=Fernet.generate_key().decode(),
        timezone="Asia/Manila",
    )


def test_credentials_are_encrypted_and_reload_without_exposure(monkeypatch) -> None:
    key = Fernet.generate_key().decode()
    calendar = ICloudCalDAVProvider(encryption_key=key, timezone="Asia/Manila")
    monkeypatch.setattr(calendar, "events", lambda **kwargs: [])

    sealed = calendar.connect("owner@icloud.com", "app-specific-password")
    restored = ICloudCalDAVProvider(
        encryption_key=key,
        sealed=sealed,
        timezone="Asia/Manila",
    )

    assert "app-specific-password" not in sealed
    assert restored.connected
    assert restored.email == "owner@icloud.com"


def test_timed_and_all_day_events_are_normalized_to_utc() -> None:
    calendar = provider()
    timed = Event()
    timed.add("uid", "timed-1")
    timed.add("summary", "Class")
    timed.add("dtstart", dt.datetime(2026, 9, 10, 9, 0, tzinfo=dt.timezone(dt.timedelta(hours=8))))
    timed.add("duration", dt.timedelta(minutes=90))
    all_day = Event()
    all_day.add("uid", "day-1")
    all_day.add("summary", "Holiday")
    all_day.add("dtstart", dt.date(2026, 9, 11))

    timed_event = calendar._event(timed, "calendar-a")
    day_event = calendar._event(all_day, "calendar-a")

    assert timed_event is not None
    assert timed_event.start == dt.datetime(2026, 9, 10, 1, 0, tzinfo=dt.UTC)
    assert timed_event.end == dt.datetime(2026, 9, 10, 2, 30, tzinfo=dt.UTC)
    assert day_event is not None
    assert day_event.all_day
    assert day_event.end - day_event.start == dt.timedelta(days=1)


def test_transparent_and_cancelled_events_do_not_block_time() -> None:
    calendar = provider()
    for field, value in (("transp", "TRANSPARENT"), ("status", "CANCELLED")):
        event = Event()
        event.add("uid", field)
        event.add("dtstart", dt.datetime(2026, 9, 10, 9, 0, tzinfo=dt.UTC))
        event.add("dtend", dt.datetime(2026, 9, 10, 10, 0, tzinfo=dt.UTC))
        event.add(field, value)

        assert calendar._event(event, "calendar-a") is None
