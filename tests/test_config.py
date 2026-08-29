import pytest
from pydantic import ValidationError

from cadence.config import SHARED_SECRET_MIN_LENGTH, Settings
from tests.conftest import TEST_SHARED_SECRET


def test_server_host_is_fixed_to_ipv4_loopback() -> None:
    with pytest.raises(ValidationError):
        Settings(shared_secret=TEST_SHARED_SECRET, host="0.0.0.0")

    assert Settings(shared_secret=TEST_SHARED_SECRET).host == "127.0.0.1"


def test_shared_secret_must_not_be_empty_or_weak() -> None:
    too_short = "x" * (SHARED_SECRET_MIN_LENGTH - 1)
    for secret in ("", "short", too_short):
        with pytest.raises(ValidationError):
            Settings(shared_secret=secret)


def test_shared_secret_at_minimum_length_is_accepted() -> None:
    settings = Settings(shared_secret="y" * SHARED_SECRET_MIN_LENGTH)

    assert settings.shared_secret.get_secret_value() == "y" * SHARED_SECRET_MIN_LENGTH


def test_secret_value_is_not_exposed_by_repr() -> None:
    settings = Settings(shared_secret=TEST_SHARED_SECRET)

    assert TEST_SHARED_SECRET not in repr(settings)


def test_a_blank_token_encryption_key_is_treated_as_absent() -> None:
    # A blank assignment in .env previously overrode the default and surfaced as a 500 on
    # the first calendar request. Absent is a supported state; broken is not.
    settings = Settings(shared_secret=TEST_SHARED_SECRET, token_encryption_key="")

    assert settings.token_encryption_key is None
    assert settings.calendar_storage_ready is False


def test_an_invalid_token_encryption_key_fails_at_startup() -> None:
    with pytest.raises(ValidationError, match="Fernet"):
        Settings(shared_secret=TEST_SHARED_SECRET, token_encryption_key="not-a-key")


def test_a_valid_token_encryption_key_is_accepted() -> None:
    from cadence.adapters.token_cipher import TokenCipher

    settings = Settings(
        shared_secret=TEST_SHARED_SECRET,
        token_encryption_key=TokenCipher.generate_key(),
    )

    assert settings.calendar_storage_ready is True


def test_no_encryption_key_is_committed_as_a_default() -> None:
    # A default encryption key in source protects nothing and invites reuse across installs.
    # Asserted against the field default rather than a constructed Settings, because a real
    # .env would legitimately supply one.
    assert Settings.model_fields["token_encryption_key"].default is None
