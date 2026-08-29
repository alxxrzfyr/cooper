import datetime as dt
import json
import urllib.parse
from collections.abc import Mapping
from typing import Any

import pytest

from cadence.adapters.google_calendar import (
    CALENDAR_SCOPE,
    OWNER_PROPERTY,
    CalendarAuthError,
    CalendarSyncTokenExpired,
    GoogleCalendarClient,
    GoogleOAuthClient,
    authorization_url,
    scrub,
)
from cadence.core.errors import ProviderError, QuotaExhaustedError

UTC = dt.UTC


class FakeTransport:
    """Replays queued responses and records every request.

    A fake rather than a mock: it enforces the same call signature the real transport has, so a
    passing test means the client builds real requests.
    """

    def __init__(self, *responses: Mapping[str, Any] | Exception) -> None:
        self.queue = list(responses)
        self.calls: list[tuple[str, str, Any, Mapping[str, str]]] = []

    def __call__(
        self,
        method: str,
        url: str,
        body: bytes | None,
        headers: Mapping[str, str],
    ) -> Mapping[str, Any]:
        decoded: Any = None
        if body:
            raw = body.decode()
            try:
                decoded = json.loads(raw)
            except json.JSONDecodeError:
                decoded = raw
        self.calls.append((method, url, decoded, headers))
        outcome = self.queue.pop(0) if self.queue else {}
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def google_event(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "evt-1",
        "status": "confirmed",
        "summary": "Team standup",
        "start": {"dateTime": "2026-08-31T09:00:00+08:00"},
        "end": {"dateTime": "2026-08-31T09:15:00+08:00"},
        "updated": "2026-08-30T10:00:00.000Z",
    }
    return base | overrides


class TestAuthorizationUrl:
    def parsed(self, **overrides: str) -> dict[str, list[str]]:
        defaults = {
            "client_id": "client-123",
            "redirect_uri": "http://127.0.0.1:8000/api/auth/callback",
            "state": "nonce",
        }
        url = authorization_url(**(defaults | overrides))  # type: ignore[arg-type]
        return urllib.parse.parse_qs(urllib.parse.urlparse(url).query)

    def test_requests_only_the_events_scope(self) -> None:
        query = self.parsed()

        # Decoded, so this checks the real requested scope rather than a substring.
        assert query["scope"] == [CALENDAR_SCOPE]
        assert query["client_id"] == ["client-123"]
        assert query["state"] == ["nonce"]

    def test_does_not_request_full_calendar_access(self) -> None:
        scopes = self.parsed()["scope"][0].split()

        assert "https://www.googleapis.com/auth/calendar" not in scopes
        assert scopes == [CALENDAR_SCOPE]

    def test_requests_offline_access_so_a_refresh_token_is_returned(self) -> None:
        query = self.parsed()

        assert query["access_type"] == ["offline"]
        assert query["prompt"] == ["consent"]
        assert query["response_type"] == ["code"]


class TestOAuthExchange:
    def build(self, transport: FakeTransport) -> GoogleOAuthClient:
        return GoogleOAuthClient(
            client_id="client",
            client_secret="secret",
            redirect_uri="http://127.0.0.1:8000/api/auth/callback",
            transport=transport,
        )

    def test_a_code_exchange_returns_the_refresh_token(self) -> None:
        transport = FakeTransport({"refresh_token": "rt-1", "access_token": "at-1"})

        payload = self.build(transport).exchange_code("code-abc")

        assert payload["refresh_token"] == "rt-1"
        method, url, body, _ = transport.calls[0]
        assert method == "POST"
        assert "oauth2.googleapis.com/token" in url
        assert "code=code-abc" in body
        assert "grant_type=authorization_code" in body

    def test_a_response_without_a_refresh_token_is_an_auth_error(self) -> None:
        # This is what a re-consent without offline access looks like, and it is the single
        # most confusing Google OAuth failure, so it gets an explicit message.
        transport = FakeTransport({"access_token": "at-1"})

        with pytest.raises(CalendarAuthError, match="no refresh token"):
            self.build(transport).exchange_code("code-abc")

    def test_a_refresh_token_buys_an_access_token(self) -> None:
        transport = FakeTransport({"access_token": "at-2"})

        assert self.build(transport).access_token("rt-1") == "at-2"
        _, _, body, _ = transport.calls[0]
        assert "grant_type=refresh_token" in body

    def test_a_missing_access_token_is_an_auth_error(self) -> None:
        with pytest.raises(CalendarAuthError):
            self.build(FakeTransport({})).access_token("rt-1")


class TestScrubbing:
    def test_sensitive_fields_are_dropped(self) -> None:
        raw = google_event(
            description="Confidential: acquisition terms and pricing",
            location="Level 42, 1 Secret Road",
            hangoutLink="https://meet.google.com/private-abc",
            conferenceData={"entryPoints": [{"uri": "https://meet.google.com/private-abc"}]},
            attendees=[
                {"email": "me@example.com", "self": True},
                {"email": "someone.else@partner.example"},
            ],
        )

        event = scrub(raw, calendar_id="primary")

        assert event is not None
        serialised = repr(dataclasses_fields(event))
        assert "Confidential" not in serialised
        assert "Secret Road" not in serialised
        assert "meet.google.com" not in serialised
        assert "partner.example" not in serialised
        assert "someone.else" not in serialised

    def test_the_record_has_no_field_for_sensitive_data(self) -> None:
        # A structural guarantee, not a filtering one: there is nowhere to put it.
        event = scrub(google_event(), calendar_id="primary")
        assert event is not None

        fields = set(type(event).__dataclass_fields__)
        assert not fields & {"description", "location", "attendees", "hangout_link", "conference"}

    def test_titles_are_kept_because_the_planner_needs_them(self) -> None:
        event = scrub(google_event(summary="Team standup"), calendar_id="primary")

        assert event is not None
        assert event.title == "Team standup"

    def test_other_attendees_are_flagged_without_storing_who(self) -> None:
        shared = scrub(
            google_event(
                attendees=[{"email": "me@example.com", "self": True}, {"email": "b@x.example"}]
            ),
            calendar_id="primary",
        )
        solo = scrub(
            google_event(attendees=[{"email": "me@example.com", "self": True}]),
            calendar_id="primary",
        )

        assert shared is not None and shared.has_other_attendees is True
        assert solo is not None and solo.has_other_attendees is False

    def test_an_app_owned_event_is_recognised_by_its_tag(self) -> None:
        event = scrub(
            google_event(extendedProperties={"private": {OWNER_PROPERTY: "block-7"}}),
            calendar_id="primary",
        )

        assert event is not None
        assert event.is_app_owned is True
        assert event.cadence_block_id == "block-7"

    def test_an_untagged_event_is_never_treated_as_app_owned(self) -> None:
        event = scrub(google_event(), calendar_id="primary")

        assert event is not None
        assert event.is_app_owned is False
        assert event.cadence_block_id is None

    def test_times_are_normalised_to_utc(self) -> None:
        event = scrub(google_event(), calendar_id="primary")

        assert event is not None
        assert event.start_utc == dt.datetime(2026, 8, 31, 1, 0, tzinfo=UTC)
        assert event.end_utc == dt.datetime(2026, 8, 31, 1, 15, tzinfo=UTC)

    def test_an_all_day_event_is_handled(self) -> None:
        event = scrub(
            google_event(start={"date": "2026-08-31"}, end={"date": "2026-09-01"}),
            calendar_id="primary",
        )

        assert event is not None
        assert event.start_utc.date() == dt.date(2026, 8, 31)

    def test_a_cancellation_survives_with_its_id(self) -> None:
        event = scrub({"id": "evt-9", "status": "cancelled"}, calendar_id="primary")

        assert event is not None
        assert event.cancelled is True
        assert event.google_event_id == "evt-9"

    def test_an_event_without_an_id_is_discarded(self) -> None:
        assert scrub({"summary": "no id"}, calendar_id="primary") is None

    def test_a_missing_title_gets_a_placeholder_rather_than_failing(self) -> None:
        event = scrub(google_event(summary=None), calendar_id="primary")

        assert event is not None
        assert event.title == "(untitled)"


def dataclasses_fields(event: object) -> dict[str, object]:
    return {name: getattr(event, name) for name in type(event).__dataclass_fields__}


class TestCalendarReads:
    def client(self, transport: FakeTransport) -> GoogleCalendarClient:
        return GoogleCalendarClient(access_token="at-1", transport=transport)

    def test_a_full_read_scrubs_every_event(self) -> None:
        transport = FakeTransport(
            {"items": [google_event(), google_event(id="evt-2")], "nextSyncToken": "sync-1"}
        )

        page = self.client(transport).list_events(calendar_id="primary")

        assert [event.google_event_id for event in page.events] == ["evt-1", "evt-2"]
        assert page.next_sync_token == "sync-1"

    def test_a_sync_token_is_sent_for_an_incremental_read(self) -> None:
        transport = FakeTransport({"items": [], "nextSyncToken": "sync-2"})

        self.client(transport).list_events(calendar_id="primary", sync_token="sync-1")

        _, url, _, _ = transport.calls[0]
        assert "syncToken=sync-1" in url
        # Time bounds are illegal alongside a sync token.
        assert "timeMin" not in url

    def test_pagination_is_followed_to_the_end(self) -> None:
        transport = FakeTransport(
            {"items": [google_event()], "nextPageToken": "page-2"},
            {"items": [google_event(id="evt-2")], "nextSyncToken": "sync-3"},
        )

        page = self.client(transport).list_events(calendar_id="primary")

        assert len(page.events) == 2
        assert page.next_sync_token == "sync-3"
        assert len(transport.calls) == 2

    def test_an_expired_sync_token_raises_so_the_caller_can_resync(self) -> None:
        transport = FakeTransport(CalendarSyncTokenExpired("gone"))

        with pytest.raises(CalendarSyncTokenExpired):
            self.client(transport).list_events(calendar_id="primary", sync_token="stale")

    def test_a_rejected_credential_raises_an_auth_error(self) -> None:
        transport = FakeTransport(CalendarAuthError("bad token"))

        with pytest.raises(CalendarAuthError):
            self.client(transport).list_events(calendar_id="primary")

    def test_quota_exhaustion_propagates(self) -> None:
        transport = FakeTransport(QuotaExhaustedError("slow down"))

        with pytest.raises(QuotaExhaustedError):
            self.client(transport).list_events(calendar_id="primary")

    def test_the_bearer_token_is_sent(self) -> None:
        transport = FakeTransport({"items": []})

        self.client(transport).list_events(calendar_id="primary")

        _, _, _, headers = transport.calls[0]
        assert headers["Authorization"] == "Bearer at-1"

    def test_free_busy_returns_opaque_spans(self) -> None:
        transport = FakeTransport(
            {
                "calendars": {
                    "primary": {
                        "busy": [
                            {
                                "start": "2026-08-31T02:00:00Z",
                                "end": "2026-08-31T03:00:00Z",
                            }
                        ]
                    }
                }
            }
        )

        spans = self.client(transport).busy_spans(
            calendar_ids=["primary"],
            time_min=dt.datetime(2026, 8, 31, tzinfo=UTC),
            time_max=dt.datetime(2026, 9, 1, tzinfo=UTC),
        )

        assert spans == (
            (
                dt.datetime(2026, 8, 31, 2, tzinfo=UTC),
                dt.datetime(2026, 8, 31, 3, tzinfo=UTC),
            ),
        )


class TestCalendarWrites:
    def client(self, transport: FakeTransport) -> GoogleCalendarClient:
        return GoogleCalendarClient(access_token="at-1", transport=transport)

    def test_an_inserted_block_carries_the_ownership_tag_and_a_chosen_id(self) -> None:
        transport = FakeTransport({"id": "cadenceblock1"})

        self.client(transport).insert_block(
            calendar_id="primary",
            event_id="cadenceblock1",
            block_id="block-7",
            title="write the report",
            start_utc=dt.datetime(2026, 8, 31, 1, tzinfo=UTC),
            end_utc=dt.datetime(2026, 8, 31, 2, tzinfo=UTC),
        )

        _, _, body, _ = transport.calls[0]
        assert body["id"] == "cadenceblock1"
        assert body["extendedProperties"]["private"][OWNER_PROPERTY] == "block-7"
        assert body["summary"] == "write the report"

    def test_a_duplicate_insert_falls_back_to_an_update(self) -> None:
        # Idempotency: retrying after a timeout must not create a second event.
        transport = FakeTransport(
            ProviderError("Google returned HTTP 409: duplicate"),
            {"id": "cadenceblock1"},
        )

        result = self.client(transport).insert_block(
            calendar_id="primary",
            event_id="cadenceblock1",
            block_id="block-7",
            title="write the report",
            start_utc=dt.datetime(2026, 8, 31, 1, tzinfo=UTC),
            end_utc=dt.datetime(2026, 8, 31, 2, tzinfo=UTC),
        )

        assert result == "cadenceblock1"
        assert transport.calls[1][0] == "PATCH"

    def test_a_non_conflict_error_on_insert_is_not_swallowed(self) -> None:
        transport = FakeTransport(ProviderError("Google returned HTTP 500: server error"))

        with pytest.raises(ProviderError):
            self.client(transport).insert_block(
                calendar_id="primary",
                event_id="e",
                block_id="b",
                title="t",
                start_utc=dt.datetime(2026, 8, 31, 1, tzinfo=UTC),
                end_utc=dt.datetime(2026, 8, 31, 2, tzinfo=UTC),
            )

    def test_deleting_an_already_absent_event_is_not_an_error(self) -> None:
        transport = FakeTransport(ProviderError("Google returned HTTP 410: already deleted"))

        self.client(transport).delete_block(calendar_id="primary", event_id="gone")

    def test_a_real_delete_failure_is_raised(self) -> None:
        transport = FakeTransport(ProviderError("Google returned HTTP 500: boom"))

        with pytest.raises(ProviderError):
            self.client(transport).delete_block(calendar_id="primary", event_id="evt")
