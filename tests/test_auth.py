from __future__ import annotations

import datetime as dt

import pytest
from pydantic import ValidationError

from cooper.auth import AuthFailure, verify_firebase_token
from cooper.config import Settings


def _claims(**overrides: object) -> dict[str, object]:
    base = {
        "uid": "u1",
        "email": "friend@example.com",
        "email_verified": True,
        "aud": "project",
        "iss": "https://securetoken.google.com/project",
        "exp": int((dt.datetime.now(dt.UTC) + dt.timedelta(hours=1)).timestamp()),
    }
    return base | overrides


def test_firebase_identity_requires_verified_email(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("firebase_admin.get_app", lambda: (_ for _ in ()).throw(ValueError()))
    monkeypatch.setattr("firebase_admin.initialize_app", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        "firebase_admin.auth.verify_id_token",
        lambda token, **kwargs: _claims(email_verified=False),
    )

    with pytest.raises(AuthFailure) as error:
        verify_firebase_token("token", project_id="project")

    assert error.value.status_code == 401
    assert error.value.detail == "Invalid authentication token"


def test_firebase_identity_requires_a_matching_audience(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("firebase_admin.get_app", lambda: (_ for _ in ()).throw(ValueError()))
    monkeypatch.setattr("firebase_admin.initialize_app", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        "firebase_admin.auth.verify_id_token",
        lambda token, **kwargs: _claims(aud="other"),
    )

    with pytest.raises(AuthFailure) as error:
        verify_firebase_token("token", project_id="project")

    assert error.value.status_code == 401


def test_firebase_identity_requires_a_uid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("firebase_admin.get_app", lambda: (_ for _ in ()).throw(ValueError()))
    monkeypatch.setattr("firebase_admin.initialize_app", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        "firebase_admin.auth.verify_id_token",
        lambda token, **kwargs: _claims(uid=""),
    )

    with pytest.raises(AuthFailure) as error:
        verify_firebase_token("token", project_id="project")

    assert error.value.status_code == 401


def test_firebase_identity_rejects_expired_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("firebase_admin.get_app", lambda: (_ for _ in ()).throw(ValueError()))
    monkeypatch.setattr("firebase_admin.initialize_app", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        "firebase_admin.auth.verify_id_token",
        lambda token, **kwargs: _claims(
            exp=int((dt.datetime.now(dt.UTC) - dt.timedelta(hours=1)).timestamp())
        ),
    )

    with pytest.raises(AuthFailure) as error:
        verify_firebase_token("token", project_id="project")

    assert error.value.status_code == 401


def test_firebase_mode_starts_without_an_email_allowlist() -> None:
    settings = Settings(
        _env_file=None,
        shared_key=None,
        auth_mode="firebase",
        firebase_project_id="project",
        database_url="postgresql+psycopg://example.invalid/test",
        oauth_state_secret="oauth-state-secret-long-enough",
        sync_secret="sync-secret-that-is-long-enough",
    )
    assert settings.auth_mode == "firebase"


def test_firebase_mode_does_not_require_a_shared_key() -> None:
    settings = Settings(
        _env_file=None,
        shared_key=None,
        auth_mode="firebase",
        firebase_project_id="project",
        database_url="postgresql+psycopg://example.invalid/test",
        oauth_state_secret="oauth-state-secret-long-enough",
        sync_secret="sync-secret-that-is-long-enough",
    )

    assert settings.shared_key is None


def test_firebase_mode_requires_a_hosted_database() -> None:
    with pytest.raises(ValidationError, match="COOPER_DATABASE_URL must point to PostgreSQL"):
        Settings(
            _env_file=None,
            shared_key=None,
            auth_mode="firebase",
            firebase_project_id="project",
            database_url="sqlite:///./cooper.db",
            oauth_state_secret="oauth-state-secret-long-enough",
            sync_secret="sync-secret-that-is-long-enough",
        )


def test_firebase_mode_requires_an_oauth_state_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("COOPER_OAUTH_STATE_SECRET", raising=False)

    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            shared_key=None,
            auth_mode="firebase",
            firebase_project_id="project",
            database_url="postgresql+psycopg://example.invalid/test",
            sync_secret="sync-secret-that-is-long-enough",
        )


def test_firebase_mode_requires_a_sync_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("COOPER_SYNC_SECRET", raising=False)

    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            shared_key=None,
            auth_mode="firebase",
            firebase_project_id="project",
            database_url="postgresql+psycopg://example.invalid/test",
            oauth_state_secret="oauth-state-secret-long-enough",
        )


def test_local_mode_requires_a_long_shared_key() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, shared_key="short", auth_mode="local")


def test_server_side_gemini_key_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("COOPER_GEMINI_API_KEY", "server-secret")

    with pytest.raises(ValidationError):
        Settings(_env_file=None, shared_key="test-key-that-is-long-enough-x")
