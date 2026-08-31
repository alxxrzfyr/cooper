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


def test_frontend_setup_does_not_require_an_environment_file() -> None:
    text = (ROOT / "frontend" / ".env.example").read_text()
    readme = (ROOT / "README.md").read_text()

    assert "No frontend environment file is required" in text
    assert "VITE_COOPER_KEY" not in text
    assert "VITE_FIREBASE_API_KEY" not in text
    assert "VITE_COOPER_KEY" not in readme
    assert ".env.local" not in readme


def test_vite_proxy_reads_only_the_backend_local_key() -> None:
    text = (ROOT / "frontend" / "vite.config.ts").read_text()

    assert "loadEnv" in text
    assert "COOPER_SHARED_KEY" in text
    assert '"X-Cooper-Key"' in text
    assert "VITE_COOPER_KEY" not in text


def test_dockerfile_runs_migrations_before_cloud_run_server() -> None:
    text = (ROOT / "Dockerfile").read_text()

    migration = text.index("uv run --frozen --no-dev --no-sync alembic upgrade head")
    server = text.index("uv run --frozen --no-dev --no-sync uvicorn cooper.app:app")

    assert migration < server
    assert "uv run alembic upgrade head" not in text
    assert "uv run uvicorn cooper.app:app" not in text
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


def test_hosted_docs_recommend_supabase_postgres_without_a_second_writer() -> None:
    readme = (ROOT / "README.md").read_text()
    architecture = (ROOT / "ARCHITECTURE.md").read_text()
    env_example = (ROOT / ".env.example").read_text()

    assert "Supabase Postgres is the recommended beta database" in readme
    assert "Cloud SQL remains the single-provider alternative" in readme
    assert "Supabase pooler" in readme
    assert "Supabase Auth is not used" in architecture
    assert "Supabase Storage is not used" in architecture
    assert "COOPER_DATABASE_URL=postgresql+psycopg://" in env_example
