from __future__ import annotations

import json
import os
import re
import shlex
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy.engine import make_url

from cooper.config import Settings

ROOT = Path(__file__).resolve().parents[1]


def test_firebase_hosting_is_spa_only() -> None:
    config = json.loads((ROOT / "firebase.json").read_text(encoding="utf-8"))

    rewrites = config["hosting"]["rewrites"]
    assert config["hosting"]["public"] == "frontend/dist"
    assert any(
        rewrite.get("source") == "**" and rewrite.get("destination") == "/index.html"
        for rewrite in rewrites
    )
    assert not any("run" in rewrite for rewrite in rewrites)


def test_ci_actions_cannot_change_via_mutable_tags() -> None:
    workflow = (ROOT / ".github" / "workflows" / "deploy.yml").read_text(encoding="utf-8")

    uses = re.findall(r"^\s+uses:\s+(.+)$", workflow, re.MULTILINE)
    assert uses
    for action in uses:
        assert re.fullmatch(
            r"[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}",
            action.split("#", 1)[0].strip(),
        )


def test_container_start_is_gated_on_successful_migrations() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    commands = [json.loads(line[4:]) for line in dockerfile.splitlines() if line.startswith("CMD ")]
    assert len(commands) == 1
    launcher = commands[0]
    assert launcher[:2] == ["sh", "-c"]
    tokens = shlex.split(launcher[2])
    # The actual container command must not start serving if Alembic fails. Unlike a source
    # substring check, this also rejects replacing && with ; or || while keeping both commands.
    gate = tokens.index("&&")
    migration, server = tokens[:gate], tokens[gate + 1 :]
    assert migration[-3:] == ["alembic", "upgrade", "head"]
    assert "uvicorn" in server and "cooper.app:app" in server


@pytest.fixture
def template_settings(monkeypatch):
    # Exercise the real .env loader without inheriting a developer's credentials or test defaults.
    for name in list(os.environ):
        if name.startswith("COOPER_"):
            monkeypatch.delenv(name)

    def load(template: str, **overrides) -> Settings:
        return Settings(
            _env_file=ROOT / template,
            shared_key="synthetic-local-test-key-only",
            **overrides,
        )

    return load


def test_local_template_works_without_provider_credentials(template_settings) -> None:
    settings = template_settings(".env.example")

    assert settings.auth_mode == "local"
    assert make_url(settings.database_url).get_backend_name() == "sqlite"
    assert not settings.google_client_id
    assert not settings.google_secret()
    assert not settings.encryption()
    assert not settings.included_ai_enabled


def test_hosted_template_accepts_operator_secrets_and_requires_tls(template_settings) -> None:
    settings = template_settings(
        "render.env.example",
        oauth_state_secret="synthetic-oauth-secret-long-enough",
        sync_secret="synthetic-sync-secret-long-enough",
    )
    database = make_url(settings.database_url)

    assert settings.auth_mode == "firebase"
    assert database.get_backend_name() == "postgresql"
    assert database.query.get("sslmode") == "require"
    assert not settings.included_ai_enabled


@pytest.mark.parametrize("template", [".env.example", "render.env.example"])
def test_templates_cannot_enable_unfunded_ai_by_flipping_the_flag(template_settings, template):
    with pytest.raises(ValidationError, match="pinned models and reviewed prices"):
        template_settings(template, included_ai_enabled=True)
