from __future__ import annotations

import datetime as dt
import urllib.parse

import pytest
from fastapi.testclient import TestClient

from tests.test_api import allow_firebase, configured_client


def test_google_calendar_factory_loads_tokens_per_owner(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from cryptography.fernet import Fernet

    key = Fernet.generate_key().decode()

    with configured_client(
        monkeypatch,
        f"sqlite:///{tmp_path / 'google.db'}",
        google_client_id="client-id",
        google_client_secret="client-secret",
        encryption_key=key,
    ) as (module, _client):
        alice_token = module.google_calendar("alice").seal_token("alice-refresh")
        bob_token = module.google_calendar("bob").seal_token("bob-refresh")
        module.store.set_setting("alice", module.GOOGLE_SETTING, {"token": alice_token})
        module.store.set_setting("bob", module.GOOGLE_SETTING, {"token": bob_token})

        alice = module.google_calendar("alice")
        bob = module.google_calendar("bob")

    assert alice.connected
    assert bob.connected
    assert alice._refresh_token == "alice-refresh"
    assert bob._refresh_token == "bob-refresh"


def test_oauth_callback_consumes_owner_nonce_before_token_exchange(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with configured_client(
        monkeypatch,
        f"sqlite:///{tmp_path / 'firebase.db'}",
        auth_mode="firebase",
        shared_key=None,
    ) as (module, client):
        auth_headers = allow_firebase(module, monkeypatch, uid="alice", email="friend@example.com")
        exchanges: list[str] = []

        class OwnerCalendar:
            def consent_url(self, state: str) -> str:
                return f"https://accounts.example.test/oauth?state={urllib.parse.quote(state)}"

            def exchange(self, code: str) -> tuple[str, str | None]:
                exchanges.append(code)
                return ("alice-refresh", "friend@example.com")

            def seal_token(self, token: str) -> str:
                return f"sealed:{token}"

        monkeypatch.setattr(module, "google_calendar", lambda owner_id: OwnerCalendar())

        connect = client.post("/api/google/connect", headers=auth_headers)
        state = urllib.parse.parse_qs(urllib.parse.urlparse(connect.json()["url"]).query)["state"][
            0
        ]
        first = client.get("/api/google/callback", params={"code": "code-1", "state": state})
        replay = client.get("/api/google/callback", params={"code": "code-2", "state": state})

        token = module.store.get_setting("alice", module.GOOGLE_SETTING)
        connected = module.store.get_setting("alice", module.GOOGLE_CONNECTED_SETTING)
        nonce = module.store.get_setting("alice", module.GOOGLE_OAUTH_NONCE_SETTING)

    assert connect.status_code == 200
    assert first.status_code == 200
    assert "Calendar connected" in first.text
    assert "did not come from Cooper" in replay.text
    assert exchanges == ["code-1"]
    assert token == {"token": "sealed:alice-refresh"}
    assert connected["email"] == "friend@example.com"
    assert nonce == {}

def test_oauth_callback_rejects_consent_url_transferred_to_another_browser(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with configured_client(
        monkeypatch,
        f"sqlite:///{tmp_path / 'firebase.db'}",
        auth_mode="firebase",
        shared_key=None,
    ) as (module, initiating_browser):
        auth_headers = allow_firebase(
            module, monkeypatch, uid="alice", email="firebase-owner@example.com"
        )
        exchanges: list[str] = []

        class OwnerCalendar:
            def consent_url(self, state: str) -> str:
                return f"https://accounts.example.test/oauth?state={urllib.parse.quote(state)}"

            def exchange(self, code: str) -> tuple[str, str | None]:
                exchanges.append(code)
                return ("alice-refresh", "google-account@example.com")

            def seal_token(self, token: str) -> str:
                return f"sealed:{token}"

        monkeypatch.setattr(module, "google_calendar", lambda owner_id: OwnerCalendar())

        connect = initiating_browser.post("/api/google/connect", headers=auth_headers)
        state = urllib.parse.parse_qs(
            urllib.parse.urlparse(connect.json()["url"]).query
        )["state"][0]
        with TestClient(module.app) as transferred_browser:
            transferred = transferred_browser.get(
                "/api/google/callback", params={"code": "stolen", "state": state}
            )
        completed = initiating_browser.get(
            "/api/google/callback", params={"code": "legitimate", "state": state}
        )
        replay = initiating_browser.get(
            "/api/google/callback", params={"code": "replay", "state": state}
        )
        connected = module.store.get_setting("alice", module.GOOGLE_CONNECTED_SETTING)

    assert "did not come from Cooper" in transferred.text
    assert "Calendar connected" in completed.text
    assert "did not come from Cooper" in replay.text
    assert exchanges == ["legitimate"]
    assert connected["email"] == "google-account@example.com"


def test_oauth_callback_rejects_state_without_matching_owner_nonce(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with configured_client(
        monkeypatch,
        f"sqlite:///{tmp_path / 'firebase.db'}",
        auth_mode="firebase",
        shared_key=None,
    ) as (module, client):
        expires_at = module.now() + dt.timedelta(minutes=5)
        signed = module._sign_oauth_state(
            module.OAuthState(owner_id="alice", nonce="shared-nonce", expires_at=expires_at)
        )
        module.store.set_setting(
            "bob",
            module.GOOGLE_OAUTH_NONCE_SETTING,
            {"nonce": "shared-nonce", "expires_at": expires_at.isoformat()},
        )
        exchanges: list[str] = []

        class OwnerCalendar:
            def exchange(self, code: str) -> tuple[str, str | None]:
                exchanges.append(code)
                return ("refresh", None)

            def seal_token(self, token: str) -> str:
                return f"sealed:{token}"

        monkeypatch.setattr(module, "google_calendar", lambda owner_id: OwnerCalendar())

        response = client.get("/api/google/callback", params={"code": "code", "state": signed})

    assert response.status_code == 200
    assert "did not come from Cooper" in response.text
    assert exchanges == []


def test_disconnect_clears_one_owners_google_grant_only(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    with configured_client(
        monkeypatch,
        f"sqlite:///{tmp_path / 'firebase.db'}",
        auth_mode="firebase",
        shared_key=None,
    ) as (module, client):
        auth_headers = allow_firebase(module, monkeypatch, uid="alice", email="friend@example.com")
        module.store.set_setting("alice", module.GOOGLE_SETTING, {"token": "alice-token"})
        module.store.set_setting("bob", module.GOOGLE_SETTING, {"token": "bob-token"})
        revoked: list[str] = []

        class OwnerCalendar:
            connected = True

            def __init__(self, owner_id: str) -> None:
                self.owner_id = owner_id

            def revoke(self) -> None:
                revoked.append(self.owner_id)

            def busy(self, *, days: int = 14) -> list[object]:
                return []

        monkeypatch.setattr(module, "connected_calendar", lambda owner_id: OwnerCalendar(owner_id))

        response = client.post("/api/google/disconnect", headers=auth_headers)

    assert response.status_code == 200
    assert module.store.get_setting("alice", module.GOOGLE_SETTING) == {}
    assert module.store.get_setting("bob", module.GOOGLE_SETTING) == {"token": "bob-token"}
    assert revoked == ["alice"]
