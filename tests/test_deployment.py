from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_firebase_hosting_rewrites_api_to_cloud_run() -> None:
    config = json.loads((ROOT / "firebase.json").read_text())

    rewrites = config["hosting"]["rewrites"]
    api = next(rewrite for rewrite in rewrites if rewrite["source"] == "/api/**")
    callback = next(rewrite for rewrite in rewrites if rewrite["source"] == "/api/google/callback")

    assert config["hosting"]["public"] == "frontend/dist"
    assert api["run"] == {"serviceId": "cooper-api", "region": "asia-southeast1"}
    assert callback["run"] == {"serviceId": "cooper-api", "region": "asia-southeast1"}
    assert ".firebaserc" not in {path.name for path in ROOT.iterdir()}


def test_frontend_env_example_contains_only_public_values() -> None:
    text = (ROOT / "frontend" / ".env.example").read_text()

    assert "VITE_COOPER_API=" in text
    assert "VITE_FIREBASE_API_KEY=" in text
    assert "VITE_FIREBASE_AUTH_DOMAIN=" in text
    assert "VITE_FIREBASE_PROJECT_ID=" in text
    assert "VITE_FIREBASE_APP_ID=" in text
    for private_name in (
        "DATABASE_URL",
        "CLIENT_SECRET",
        "ENCRYPTION_KEY",
        "OAUTH_STATE_SECRET",
        "SYNC_SECRET",
    ):
        assert private_name not in text


def test_dockerfile_runs_migrations_before_cloud_run_server() -> None:
    text = (ROOT / "Dockerfile").read_text()

    migration = text.index("uv run alembic upgrade head")
    server = text.index("uv run uvicorn cooper.app:app")

    assert migration < server
    assert "--host 0.0.0.0" in text
    assert "--port ${PORT:-8080}" in text
    assert "COOPER_GOOGLE_CLIENT_SECRET=" not in text
    assert "COOPER_DATABASE_URL=" not in text


def test_backend_env_example_documents_local_and_hosted_values() -> None:
    text = (ROOT / ".env.example").read_text()

    for expected in (
        "COOPER_AUTH_MODE=local",
        "COOPER_DATABASE_URL=sqlite:///./cooper.db",
        "COOPER_AUTH_MODE=firebase",
        "COOPER_ALLOWED_EMAILS=",
        "COOPER_OAUTH_STATE_SECRET=",
        "COOPER_SYNC_SECRET=",
        "COOPER_GOOGLE_REDIRECT_URI=",
    ):
        assert expected in text
    assert "COOPER_GEMINI_API_KEY" not in text
