"""Google connection lifecycle.

Owns the one piece of state the rest of the app should not have to reason about: whether a
usable credential exists right now, and if not, what the user should do about it.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from cadence.adapters.google_calendar import (
    CALENDAR_SCOPE,
    CalendarAuthError,
    GoogleCalendarClient,
    GoogleOAuthClient,
    HttpTransport,
)
from cadence.adapters.token_cipher import CredentialError, CredentialStore, GoogleCredential
from cadence.core.errors import DomainValidationError
from cadence.core.protocols import Clock

# A consent screen left in Testing mode expires refresh tokens after this long. It is the most
# likely reason sync stops while the code is entirely correct.
TESTING_MODE_TOKEN_DAYS = 7


class AuthService:
    def __init__(
        self,
        *,
        store: CredentialStore,
        oauth: GoogleOAuthClient | None,
        transport: HttpTransport,
        clock: Clock,
        client_id: str | None,
        redirect_uri: str,
    ) -> None:
        self._store = store
        self._oauth = oauth
        self._transport = transport
        self._clock = clock
        self._client_id = client_id
        self._redirect_uri = redirect_uri

    @property
    def configured(self) -> bool:
        """Whether Google credentials exist in configuration at all."""
        return self._oauth is not None and bool(self._client_id)

    def client_config(self) -> tuple[str, str]:
        if not self.configured or self._client_id is None:
            raise DomainValidationError(
                "Google OAuth is not configured. Set CADENCE_GOOGLE_CLIENT_ID and "
                "CADENCE_GOOGLE_CLIENT_SECRET, then restart."
            )
        return (self._client_id, self._redirect_uri)

    def complete(self, code: str) -> str | None:
        """Exchange the code and store the refresh token encrypted."""
        if self._oauth is None:
            raise DomainValidationError("Google OAuth is not configured")

        payload = self._oauth.exchange_code(code)
        now = self._clock.now()
        email = _email_from(payload)
        self._store.save(
            GoogleCredential(
                refresh_token=str(payload["refresh_token"]),
                scope=str(payload.get("scope") or CALENDAR_SCOPE),
                account_email=email,
                obtained_at=now,
            )
        )
        return email

    def disconnect(self) -> None:
        self._store.clear()

    def credential(self) -> GoogleCredential | None:
        try:
            return self._store.load()
        except CredentialError:
            return None

    def calendar_client(self) -> GoogleCalendarClient | None:
        """A ready-to-use client, or None when no usable credential exists."""
        if self._oauth is None:
            return None
        credential = self.credential()
        if credential is None:
            return None
        try:
            token = self._oauth.access_token(credential.refresh_token)
        except CalendarAuthError as error:
            self._store.record_error(str(error))
            return None
        self._store.record_success(at=self._clock.now())
        return GoogleCalendarClient(access_token=token, transport=self._transport)

    def status(self) -> dict[str, Any]:
        if not self.configured:
            return {
                "connected": False,
                "configured": False,
                "hint": (
                    "Google OAuth is not configured. Calendar features stay off until "
                    "CADENCE_GOOGLE_CLIENT_ID and CADENCE_GOOGLE_CLIENT_SECRET are set."
                ),
            }

        try:
            credential = self._store.load()
        except CredentialError as error:
            return {
                "connected": False,
                "configured": True,
                "last_error": str(error),
                "hint": "The encryption key changed. Reconnect Google Calendar.",
            }

        if credential is None:
            return {
                "connected": False,
                "configured": True,
                "hint": "Not connected yet. Start authorization to enable calendar features.",
            }

        age = self._clock.now() - credential.obtained_at
        stale = age > dt.timedelta(days=TESTING_MODE_TOKEN_DAYS)
        healthy = credential.last_error is None and not stale
        hint = None
        if credential.last_error is not None:
            hint = "Google refused the credential. Reconnect to resume syncing."
        elif stale:
            hint = (
                "This authorization is more than seven days old. If sync has stopped, the "
                "consent screen is probably still in Testing mode, which expires refresh "
                "tokens weekly. Publishing the app removes the expiry."
            )

        return {
            "connected": True,
            "configured": True,
            "account_email": credential.account_email,
            "scope": credential.scope,
            "obtained_at": credential.obtained_at,
            "last_refreshed_at": credential.last_refreshed_at,
            "last_error": credential.last_error,
            "healthy": healthy,
            "hint": hint,
        }


def _email_from(payload: Any) -> str | None:
    """Best-effort account label from the id token, without verifying it.

    Only used for display. Nothing is authorized on the strength of this value, so decoding it
    without signature verification is acceptable here and nowhere else.
    """
    import base64
    import json

    id_token = payload.get("id_token")
    if not isinstance(id_token, str) or id_token.count(".") != 2:
        return None
    try:
        body = id_token.split(".")[1]
        padded = body + "=" * (-len(body) % 4)
        claims = json.loads(base64.urlsafe_b64decode(padded))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    email = claims.get("email")
    return str(email) if isinstance(email, str) else None
