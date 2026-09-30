from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

SCRIPT = Path(__file__).parents[1] / "scripts" / "live_provider_preflight.py"
SPEC = importlib.util.spec_from_file_location("live_provider_preflight", SCRIPT)
assert SPEC and SPEC.loader
preflight = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(preflight)


@pytest.fixture(autouse=True)
def _isolate_from_shell_environment(monkeypatch) -> None:
    # The script prefers the process environment over the file, so an exported
    # (even empty) COOPER_* variable in the developer's shell would mask the test file.
    for name in (
        "COOPER_SHARED_KEY",
        "COOPER_GOOGLE_CLIENT_ID",
        "COOPER_GOOGLE_CLIENT_SECRET",
        "COOPER_ENCRYPTION_KEY",
    ):
        monkeypatch.delenv(name, raising=False)


def test_preflight_accepts_valid_local_provider_values(tmp_path, monkeypatch, capsys) -> None:
    key = Fernet.generate_key().decode()
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            (
                "COOPER_SHARED_KEY=local-provider-test-key-12345",
                "COOPER_GOOGLE_CLIENT_ID=test-client",
                "COOPER_GOOGLE_CLIENT_SECRET=test-secret",
                f"COOPER_ENCRYPTION_KEY={key}",
            )
        )
    )
    monkeypatch.setattr(sys, "argv", ["preflight", "--env-file", str(env_file)])

    assert preflight.main() == 0
    output = capsys.readouterr().out
    assert "Preflight passed" in output
    assert key not in output


def test_preflight_rejects_an_invalid_encryption_key(tmp_path, monkeypatch, capsys) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "\n".join(
            (
                "COOPER_SHARED_KEY=local-provider-test-key-12345",
                "COOPER_GOOGLE_CLIENT_ID=test-client",
                "COOPER_GOOGLE_CLIENT_SECRET=test-secret",
                "COOPER_ENCRYPTION_KEY=not-a-fernet-key",
            )
        )
    )
    monkeypatch.setattr(sys, "argv", ["preflight", "--env-file", str(env_file)])

    assert preflight.main() == 1
    assert "not a valid Fernet key" in capsys.readouterr().out
