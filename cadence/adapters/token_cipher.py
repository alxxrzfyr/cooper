"""Encrypted storage for the Google refresh token.

The refresh token is the one long-lived secret this app holds, and it grants write access
to a real calendar. It is encrypted at rest with a key supplied by the environment, so the
database file alone is not enough to use it.

The plaintext never enters a log, an error message, or a `__repr__`.
"""

from __future__ import annotations

import dataclasses
import datetime as dt

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from cadence.adapters.models import GoogleCredentialModel
from cadence.core.errors import CadenceError

CREDENTIAL_ROW_ID = "google"


class CredentialError(CadenceError):
    """The stored credential is missing or cannot be decrypted."""


@dataclasses.dataclass(frozen=True, slots=True)
class GoogleCredential:
    """A stored authorization. `refresh_token` is plaintext only in memory."""

    refresh_token: str
    scope: str
    account_email: str | None
    obtained_at: dt.datetime
    last_refreshed_at: dt.datetime | None = None
    last_error: str | None = None

    def __repr__(self) -> str:
        # Never let the token reach a log line or a traceback.
        return (
            f"GoogleCredential(scope={self.scope!r}, account_email={self.account_email!r}, "
            f"obtained_at={self.obtained_at!r}, refresh_token=<redacted>)"
        )


class TokenCipher:
    """Symmetric encryption for tokens at rest."""

    def __init__(self, key: str) -> None:
        try:
            self._fernet = Fernet(key.encode() if isinstance(key, str) else key)
        except (ValueError, TypeError) as error:
            raise CredentialError(
                "CADENCE_TOKEN_ENCRYPTION_KEY is not a valid Fernet key"
            ) from error

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        try:
            return self._fernet.decrypt(ciphertext.encode()).decode()
        except InvalidToken as error:
            raise CredentialError(
                "stored token could not be decrypted; the encryption key has changed"
            ) from error

    @staticmethod
    def generate_key() -> str:
        return Fernet.generate_key().decode()


class CredentialStore:
    """Single-row credential storage. One user means one Google account."""

    def __init__(self, session: Session, cipher: TokenCipher) -> None:
        self._session = session
        self._cipher = cipher

    def save(self, credential: GoogleCredential) -> None:
        row = self._session.get(GoogleCredentialModel, CREDENTIAL_ROW_ID)
        if row is None:
            row = GoogleCredentialModel(id=CREDENTIAL_ROW_ID)
            self._session.add(row)
        row.refresh_token_encrypted = self._cipher.encrypt(credential.refresh_token)
        row.scope = credential.scope
        row.account_email = credential.account_email
        row.obtained_at = credential.obtained_at.astimezone(dt.UTC)
        row.last_refreshed_at = (
            credential.last_refreshed_at.astimezone(dt.UTC)
            if credential.last_refreshed_at
            else None
        )
        row.last_error = credential.last_error
        self._session.flush()

    def load(self) -> GoogleCredential | None:
        row = self._session.scalars(
            select(GoogleCredentialModel).where(GoogleCredentialModel.id == CREDENTIAL_ROW_ID)
        ).first()
        if row is None:
            return None
        return GoogleCredential(
            refresh_token=self._cipher.decrypt(row.refresh_token_encrypted),
            scope=row.scope,
            account_email=row.account_email,
            obtained_at=_aware(row.obtained_at),
            last_refreshed_at=_optional_aware(row.last_refreshed_at),
            last_error=row.last_error,
        )

    def record_error(self, message: str) -> None:
        """Note a failure without touching the token itself."""
        row = self._session.get(GoogleCredentialModel, CREDENTIAL_ROW_ID)
        if row is not None:
            row.last_error = message[:500]
            self._session.flush()

    def record_success(self, *, at: dt.datetime) -> None:
        row = self._session.get(GoogleCredentialModel, CREDENTIAL_ROW_ID)
        if row is not None:
            row.last_refreshed_at = at.astimezone(dt.UTC)
            row.last_error = None
            self._session.flush()

    def clear(self) -> None:
        row = self._session.get(GoogleCredentialModel, CREDENTIAL_ROW_ID)
        if row is not None:
            self._session.delete(row)
            self._session.flush()


def _aware(moment: dt.datetime) -> dt.datetime:
    return moment if moment.tzinfo else moment.replace(tzinfo=dt.UTC)


def _optional_aware(moment: dt.datetime | None) -> dt.datetime | None:
    return None if moment is None else _aware(moment)
