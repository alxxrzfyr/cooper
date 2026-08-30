import dataclasses
import datetime as dt
from zoneinfo import ZoneInfo

import pytest

from cooper.google import GmailMessage
from cooper.watcher import EmailProposal, Watcher, parse_confirmation

NOW = dt.datetime(2026, 8, 30, 12, tzinfo=dt.UTC)


def message(sender: str, subject: str, body: str) -> GmailMessage:
    return GmailMessage(
        headers={"From": sender, "Subject": subject},
        body=body,
        internal_at=NOW,
    )


def test_parses_luma_plain_text_confirmation_in_the_configured_timezone() -> None:
    proposal = parse_confirmation(
        message(
            "Luma <events@luma.com>",
            "Your RSVP is confirmed",
            """RSVP confirmed
Title: Climate Action Meetup
When: Thursday, September 10, 2026, 6:30 PM - 8:00 PM
https://lu.ma/climate-action-manila
""",
        ),
        timezone="Asia/Manila",
        now=NOW,
    )

    assert proposal == EmailProposal(
        provider="luma",
        title="Climate Action Meetup",
        source_ref="luma:climate-action-manila",
        start=dt.datetime(2026, 9, 10, 18, 30, tzinfo=ZoneInfo("Asia/Manila")),
        end=dt.datetime(2026, 9, 10, 20, 0, tzinfo=ZoneInfo("Asia/Manila")),
        cancelled=False,
    )


def test_parses_meetup_html_confirmation_and_normalizes_title_and_reference() -> None:
    proposal = parse_confirmation(
        message(
            "Meetup <no-reply@e.meetup.com>",
            "You're going to Python Manila",
            """<html><body><p>Registration confirmed</p>
<p>Title: Python   Manila\n Community</p>
<p>When: Friday, September 11, 2026, 7:00 PM - 9:00 PM</p>
<a href="https://www.meetup.com/python-manila/events/303030303/?utm_source=email">
  View event
</a></body></html>""",
        ),
        timezone="America/New_York",
        now=NOW,
    )

    assert proposal == EmailProposal(
        provider="meetup",
        title="Python Manila Community",
        source_ref="meetup:303030303",
        start=dt.datetime(2026, 9, 11, 19, 0, tzinfo=ZoneInfo("America/New_York")),
        end=dt.datetime(2026, 9, 11, 21, 0, tzinfo=ZoneInfo("America/New_York")),
        cancelled=False,
    )


def test_parses_eventbrite_confirmation() -> None:
    proposal = parse_confirmation(
        message(
            "Eventbrite <noreply@eventbrite.com>",
            "Your order is confirmed",
            """Order confirmed
Title: Design Systems Workshop
Date and time: Saturday, September 12, 2026, 10:00 AM - 12:30 PM
https://www.eventbrite.com/e/design-systems-workshop-tickets-1234567890
""",
        ),
        timezone="Asia/Manila",
        now=NOW,
    )

    assert proposal == EmailProposal(
        provider="eventbrite",
        title="Design Systems Workshop",
        source_ref="eventbrite:1234567890",
        start=dt.datetime(2026, 9, 12, 10, 0, tzinfo=ZoneInfo("Asia/Manila")),
        end=dt.datetime(2026, 9, 12, 12, 30, tzinfo=ZoneInfo("Asia/Manila")),
        cancelled=False,
    )


def test_parses_cancellation_without_inventing_times() -> None:
    proposal = parse_confirmation(
        message(
            "Luma <events@luma.com>",
            "Climate Action Meetup has been cancelled",
            """This event has been cancelled.
Title: Climate Action Meetup
https://lu.ma/climate-action-manila
""",
        ),
        timezone="Asia/Manila",
        now=NOW,
    )

    assert proposal == EmailProposal(
        provider="luma",
        title="Climate Action Meetup",
        source_ref="luma:climate-action-manila",
        start=None,
        end=None,
        cancelled=True,
    )


@pytest.mark.parametrize(
    "candidate",
    [
        message(
            "Luma <events@luma.com>",
            "Your RSVP is confirmed",
            """RSVP confirmed
Title: Missing an end time
When: Thursday, September 10, 2026, 6:30 PM
https://lu.ma/missing-end
""",
        ),
        message(
            "Luma <events@luma.com>",
            "Your RSVP is confirmed",
            """RSVP confirmed
Title: Two events
When: Thursday, September 10, 2026, 6:30 PM - 8:00 PM
https://lu.ma/first-event
https://lu.ma/second-event
""",
        ),
        message(
            "Unknown <events@untrusted.example>",
            "Your RSVP is confirmed",
            """RSVP confirmed
Title: Never import this
When: Thursday, September 10, 2026, 6:30 PM - 8:00 PM
https://lu.ma/untrusted-event
""",
        ),
    ],
)
def test_rejects_incomplete_ambiguous_or_untrusted_messages(candidate: GmailMessage) -> None:
    assert parse_confirmation(candidate, timezone="Asia/Manila", now=NOW) is None


def test_proposal_discards_the_message_body_and_has_only_safe_fields() -> None:
    proposal = parse_confirmation(
        message(
            "Luma <events@luma.com>",
            "Your RSVP is confirmed",
            """RSVP confirmed
Title: Private title
When: Thursday, September 10, 2026, 6:30 PM - 8:00 PM
https://lu.ma/private-event
Private body text that must not survive parsing.
""",
        ),
        timezone="Asia/Manila",
        now=NOW,
    )

    assert proposal is not None
    assert set(dataclasses.asdict(proposal)) == {
        "provider",
        "title",
        "source_ref",
        "start",
        "end",
        "cancelled",
    }
    assert "Private body text" not in repr(proposal)


class StopAfterWaits:
    def __init__(self, count: int) -> None:
        self.remaining = count
        self.intervals: list[int] = []

    def is_set(self) -> bool:
        return self.remaining == 0

    def wait(self, seconds: int) -> bool:
        self.intervals.append(seconds)
        self.remaining -= 1
        return self.is_set()


def test_watcher_invokes_the_app_callback_once_per_fixed_interval() -> None:
    calls: list[None] = []
    stop = StopAfterWaits(2)
    watcher = Watcher(lambda: calls.append(None) or object(), interval_seconds=300)

    watcher.run_forever(stop)

    assert calls == [None, None]
    assert stop.intervals == [300, 300]


def test_watcher_does_not_retry_a_failed_sync_before_its_next_interval() -> None:
    calls: list[None] = []
    stop = StopAfterWaits(1)
    watcher = Watcher(
        lambda: calls.append(None) or object(),
        interval_seconds=300,
    )

    watcher.run_forever(stop)

    assert calls == [None]
    assert stop.intervals == [300]
