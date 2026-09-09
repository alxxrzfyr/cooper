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


def test_event_details_preserve_description_organizer_and_attendees() -> None:
    from icalendar import vCalAddress, vText

    calendar = provider()
    calendar._email = "me@icloud.com"
    event = Event()
    event.add("uid", "detail-1")
    event.add("summary", "Dev Days")
    event.add("dtstart", dt.datetime(2026, 9, 10, 6, 0, tzinfo=dt.UTC))
    event.add("dtend", dt.datetime(2026, 9, 10, 9, 0, tzinfo=dt.UTC))
    event.add("location", "Microsoft Philippines, Inc.")
    event.add(
        "description",
        "Code of Conduct\nWe are committed to providing a welcoming environment. Please review.",
    )
    organizer = vCalAddress("mailto:calendar-invite@lu.ma")
    organizer.params["cn"] = vText("Dev Days")
    event["organizer"] = organizer
    guest = vCalAddress("mailto:alex@example.com")
    guest.params["cn"] = vText("Alex Berin Jr.")
    guest.params["partstat"] = vText("ACCEPTED")
    event.add("attendee", guest, encode=0)
    self_guest = vCalAddress("mailto:me@icloud.com")
    self_guest.params["partstat"] = vText("ACCEPTED")
    event.add("attendee", self_guest, encode=0)

    parsed = calendar._event(event, "calendar-a")

    assert parsed is not None
    assert parsed.location == "Microsoft Philippines, Inc."
    assert parsed.description is not None
    assert "Please review" in parsed.description
    assert parsed.organizer_email == "calendar-invite@lu.ma"
    assert parsed.organizer_name == "Dev Days"
    assert parsed.response_status == "accepted"
    assert parsed.attendees == (
        {
            "email": "alex@example.com",
            "name": "Alex Berin Jr.",
            "response_status": "accepted",
        },
        {
            "email": "me@icloud.com",
            "name": None,
            "response_status": "accepted",
        },
    )


def test_event_details_do_not_truncate_long_icalendar_values() -> None:
    from icalendar import vCalAddress

    calendar = provider()
    event = Event()
    event.add("uid", "long-detail-1")
    event.add("summary", "T" * 301)
    event.add("dtstart", dt.datetime(2026, 9, 10, 6, 0, tzinfo=dt.UTC))
    event.add("dtend", dt.datetime(2026, 9, 10, 9, 0, tzinfo=dt.UTC))
    event.add("location", "L" * 501)
    event.add("description", "D" * 5001)
    for index in range(101):
        event.add("attendee", vCalAddress(f"mailto:guest-{index}@example.com"), encode=0)

    parsed = calendar._event(event, "calendar-a")

    assert parsed is not None
    assert parsed.title == "T" * 301
    assert parsed.location == "L" * 501
    assert parsed.description == "D" * 5001
    assert len(parsed.attendees) == 101
    assert parsed.metadata[0]["value"] == event.to_ical().decode("utf-8")
