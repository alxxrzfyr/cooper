from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_firebase_hosting_is_spa_only() -> None:
    config = json.loads((ROOT / "firebase.json").read_text())

    rewrites = config["hosting"]["rewrites"]
    assert config["hosting"]["public"] == "frontend/dist"
    assert rewrites == [{"source": "**", "destination": "/index.html"}]
    assert not any("run" in rewrite for rewrite in rewrites)
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


def test_dockerfile_runs_migrations_before_render_server() -> None:
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


def test_ci_verifies_pull_requests_but_deploys_only_main_runs() -> None:
    workflow = (ROOT / ".github" / "workflows" / "deploy.yml").read_text()

    assert "  pull_request:\n    branches:\n      - main" in workflow
    assert "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'" in workflow
    assert "uv lock --check" in workflow
    assert "uv pip check" in workflow
    assert "npm audit --omit=dev --audit-level=high" in workflow


def test_solo_workflow_documents_main_and_ticket_conventions() -> None:
    workflow = (ROOT / "docs" / "WORKFLOW.md").read_text()
    issue_template = (ROOT / ".github" / "ISSUE_TEMPLATE" / "work-item.md").read_text()
    pull_request = (ROOT / ".github" / "pull_request_template.md").read_text()

    assert "`main` is the production branch" in workflow
    assert "COOP-<issue number>" in workflow
    assert "COOP-___" in issue_template
    assert "Testing performed" in pull_request


def test_backend_env_example_documents_local_and_hosted_values() -> None:
    local = (ROOT / ".env.example").read_text()
    hosted = (ROOT / "render.env.example").read_text()

    for expected in (
        "COOPER_AUTH_MODE=local",
        "COOPER_DATABASE_URL=sqlite:///./cooper.db",
    ):
        assert expected in local
    for expected in (
        "COOPER_AUTH_MODE=firebase",
        "COOPER_OAUTH_STATE_SECRET=",
        "COOPER_SYNC_SECRET=",
        "COOPER_GOOGLE_REDIRECT_URI=",
    ):
        assert expected in hosted
    assert "COOPER_GEMINI_API_KEY" not in local
    assert "COOPER_GEMINI_API_KEY" not in hosted
    assert "COOPER_ALLOWED_EMAILS" not in hosted
    assert "render.env.example" in local


def test_hosted_docs_recommend_supabase_postgres_without_a_second_writer() -> None:
    readme = (ROOT / "README.md").read_text()
    architecture = (ROOT / "ARCHITECTURE.md").read_text()
    hosted = (ROOT / "render.env.example").read_text()

    assert "Supabase Postgres is the recommended beta database" in readme
    assert "Cloud SQL remains the single-provider alternative" in readme
    assert "Supabase pooler" in readme
    assert "Supabase Auth is not used" in architecture
    assert "Supabase Storage is not used" in architecture
    assert "COOPER_DATABASE_URL=postgresql+psycopg://" in hosted
    assert "sslmode=require" in hosted
