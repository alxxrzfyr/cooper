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
