import datetime as dt

import pytest
from sqlalchemy.orm import Session

from cadence.adapters.database import Base, build_engine, build_session_factory
from cadence.adapters.token_cipher import (
    CredentialError,
    CredentialStore,
    GoogleCredential,
    TokenCipher,
)

UTC = dt.UTC
OBTAINED = dt.datetime(2026, 8, 29, 10, 0, tzinfo=UTC)
SECRET_TOKEN = "1//super-secret-refresh-token-value"


@pytest.fixture
def session() -> Session:
    engine = build_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with build_session_factory(engine)() as open_session:
        yield open_session


@pytest.fixture
def cipher() -> TokenCipher:
    return TokenCipher(TokenCipher.generate_key())


def credential(**overrides: object) -> GoogleCredential:
    defaults: dict[str, object] = {
        "refresh_token": SECRET_TOKEN,
        "scope": "https://www.googleapis.com/auth/calendar.events",
        "account_email": "user@example.com",
        "obtained_at": OBTAINED,
    }
    return GoogleCredential(**(defaults | overrides))  # type: ignore[arg-type]


class TestCipher:
    def test_a_round_trip_returns_the_original(self, cipher: TokenCipher) -> None:
        assert cipher.decrypt(cipher.encrypt(SECRET_TOKEN)) == SECRET_TOKEN

    def test_ciphertext_does_not_contain_the_plaintext(self, cipher: TokenCipher) -> None:
        assert SECRET_TOKEN not in cipher.encrypt(SECRET_TOKEN)

    def test_encrypting_twice_gives_different_ciphertext(self, cipher: TokenCipher) -> None:
        # Fernet includes a nonce, so identical input must not produce identical output.
        assert cipher.encrypt(SECRET_TOKEN) != cipher.encrypt(SECRET_TOKEN)

    def test_a_wrong_key_cannot_decrypt(self, cipher: TokenCipher) -> None:
        other = TokenCipher(TokenCipher.generate_key())

        with pytest.raises(CredentialError, match="encryption key has changed"):
            other.decrypt(cipher.encrypt(SECRET_TOKEN))

    def test_an_invalid_key_is_rejected_at_construction(self) -> None:
        with pytest.raises(CredentialError, match="not a valid Fernet key"):
            TokenCipher("not-a-real-key")

    def test_tampered_ciphertext_is_refused(self, cipher: TokenCipher) -> None:
        ciphertext = cipher.encrypt(SECRET_TOKEN)
        tampered = ciphertext[:-4] + "AAAA"

        with pytest.raises(CredentialError):
            cipher.decrypt(tampered)


class TestCredentialStore:
    def test_a_saved_credential_round_trips(self, session: Session, cipher: TokenCipher) -> None:
        store = CredentialStore(session, cipher)

        store.save(credential())
        loaded = store.load()

        assert loaded is not None
        assert loaded.refresh_token == SECRET_TOKEN
        assert loaded.account_email == "user@example.com"
        assert loaded.obtained_at == OBTAINED

    def test_the_token_is_encrypted_in_the_database(
        self, session: Session, cipher: TokenCipher
    ) -> None:
        from sqlalchemy import text

        CredentialStore(session, cipher).save(credential())

        stored = session.execute(
            text("SELECT refresh_token_encrypted FROM google_credential")
        ).scalar_one()
        assert SECRET_TOKEN not in stored

    def test_loading_with_no_credential_returns_none(
        self, session: Session, cipher: TokenCipher
    ) -> None:
        assert CredentialStore(session, cipher).load() is None

    def test_saving_twice_replaces_rather_than_duplicates(
        self, session: Session, cipher: TokenCipher
    ) -> None:
        from sqlalchemy import text

        store = CredentialStore(session, cipher)
        store.save(credential())
        store.save(credential(refresh_token="1//a-newer-token"))

        count = session.execute(text("SELECT COUNT(*) FROM google_credential")).scalar_one()
        assert count == 1
        loaded = store.load()
        assert loaded is not None
        assert loaded.refresh_token == "1//a-newer-token"

    def test_repr_never_leaks_the_token(self) -> None:
        # A traceback or log line must not become a credential disclosure.
        rendered = repr(credential())

        assert SECRET_TOKEN not in rendered
        assert "<redacted>" in rendered

    def test_an_error_is_recorded_without_touching_the_token(
        self, session: Session, cipher: TokenCipher
    ) -> None:
        store = CredentialStore(session, cipher)
        store.save(credential())

        store.record_error("invalid_grant: token expired")

        loaded = store.load()
        assert loaded is not None
        assert loaded.last_error is not None
        assert "invalid_grant" in loaded.last_error
        assert loaded.refresh_token == SECRET_TOKEN

    def test_success_clears_a_previous_error(self, session: Session, cipher: TokenCipher) -> None:
        store = CredentialStore(session, cipher)
        store.save(credential())
        store.record_error("temporary failure")

        store.record_success(at=dt.datetime(2026, 8, 30, 9, 0, tzinfo=UTC))

        loaded = store.load()
        assert loaded is not None
        assert loaded.last_error is None
        assert loaded.last_refreshed_at == dt.datetime(2026, 8, 30, 9, 0, tzinfo=UTC)

    def test_clearing_removes_the_credential(self, session: Session, cipher: TokenCipher) -> None:
        store = CredentialStore(session, cipher)
        store.save(credential())

        store.clear()

        assert store.load() is None

    def test_a_rotated_encryption_key_surfaces_a_clear_error(self, session: Session) -> None:
        original = TokenCipher(TokenCipher.generate_key())
        CredentialStore(session, original).save(credential())

        rotated = CredentialStore(session, TokenCipher(TokenCipher.generate_key()))

        with pytest.raises(CredentialError, match="encryption key has changed"):
            rotated.load()
