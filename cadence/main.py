"""Application assembly.

Builds the object graph once at startup and stores the long-lived pieces on app state. Binds
`127.0.0.1` and nothing else: the localhost assumption is what makes an unauthenticated API
acceptable, and it is asserted by a test rather than trusted.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
from collections.abc import AsyncIterator

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cadence.adapters.database import Base, build_engine, build_session_factory
from cadence.adapters.gemini_provider import GeminiProvider
from cadence.adapters.gemini_transport import build_gemini_transport
from cadence.adapters.google_calendar import GoogleOAuthClient, build_http_transport
from cadence.adapters.quota_governor import QuotaGovernor
from cadence.api.errors import register_error_handlers
from cadence.api.routes_auth import router as auth_router
from cadence.api.routes_capture import router as capture_router
from cadence.api.routes_health import router as health_router
from cadence.api.routes_plan import router as plan_router
from cadence.api.routes_schedule import activity_router
from cadence.api.routes_schedule import router as schedule_router
from cadence.api.routes_tasks import router as tasks_router
from cadence.api.routes_windows import router as windows_router
from cadence.api.security import SHARED_SECRET_HEADER, LocalSecurityMiddleware
from cadence.config import Settings
from cadence.core.protocols import LLMProvider
from cadence.jobs.runtime import run_scheduler

ROUTERS = (
    health_router,
    tasks_router,
    plan_router,
    capture_router,
    windows_router,
    schedule_router,
    activity_router,
    auth_router,
)


def build_llm_provider(settings: Settings) -> LLMProvider | None:
    """Return the configured model provider, or None to run offline.

    None is a supported production state, not an error: with no key the app still captures,
    ranks, and schedules using the rule-based parser and the deterministic scheduler.
    """
    if settings.llm_provider != "gemini" or settings.gemini_api_key is None:
        return None
    return GeminiProvider(
        model_id=settings.model_compile,
        transport=build_gemini_transport(settings.gemini_api_key.get_secret_value()),
    )


def build_oauth_client(
    settings: Settings,
    transport: object,
) -> GoogleOAuthClient | None:
    """Return an OAuth client, or None when Google is not configured.

    Not configured is a normal state: everything except calendar integration works without it.
    """
    if not settings.google_configured or settings.google_client_secret is None:
        return None
    return GoogleOAuthClient(
        client_id=str(settings.google_client_id),
        client_secret=settings.google_client_secret.get_secret_value(),
        redirect_uri=settings.google_redirect_uri,
        transport=transport,  # type: ignore[arg-type]
    )


def create_app(settings: Settings | None = None, *, create_schema: bool = False) -> FastAPI:
    """Build the application.

    `create_schema` exists for tests and throwaway databases. Real runs migrate with Alembic,
    so schema creation is never an implicit side effect of starting the server.
    """
    runtime_settings = settings or Settings()  # type: ignore[call-arg]

    @contextlib.asynccontextmanager
    async def lifespan(instance: FastAPI) -> AsyncIterator[None]:
        """Run background jobs for the life of the process.

        Disabled under `create_schema`, which is the test path: a background loop sharing a
        test database makes assertions race against it.
        """
        stop = asyncio.Event()
        task: asyncio.Task[None] | None = None
        if not create_schema:
            task = asyncio.create_task(
                run_scheduler(
                    factory=instance.state.session_factory,
                    settings=runtime_settings,
                    transport=instance.state.http_transport,
                    stop=stop,
                )
            )
        try:
            yield
        finally:
            stop.set()
            if task is not None:
                with contextlib.suppress(asyncio.CancelledError, TimeoutError):
                    await asyncio.wait_for(task, timeout=5)

    app = FastAPI(title="Cadence", docs_url=None, redoc_url=None, lifespan=lifespan)

    engine = build_engine(runtime_settings.database_url)
    if create_schema:
        Base.metadata.create_all(engine)

    http_transport = build_http_transport()

    app.state.engine = engine
    app.state.session_factory = build_session_factory(engine)
    app.state.settings = runtime_settings
    app.state.score_weights = runtime_settings.score_weights()
    app.state.placement_rules = runtime_settings.placement_rules()
    app.state.llm_provider = build_llm_provider(runtime_settings)
    app.state.http_transport = http_transport
    app.state.oauth_client = build_oauth_client(runtime_settings, http_transport)
    app.state.quota_governor = QuotaGovernor(now=lambda: dt.datetime.now(tz=dt.UTC))
    app.state.oauth_nonce = None

    register_error_handlers(app)
    for router in ROUTERS:
        app.include_router(router)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[runtime_settings.allowed_origin],
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[SHARED_SECRET_HEADER, "Content-Type"],
    )
    app.add_middleware(
        LocalSecurityMiddleware,
        shared_secret=runtime_settings.shared_secret.get_secret_value(),
        allowed_origin=runtime_settings.allowed_origin,
        allowed_hosts=runtime_settings.allowed_hosts,
    )
    return app


app = create_app()


def run() -> None:
    settings = Settings()  # type: ignore[call-arg]
    uvicorn.run("cadence.main:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":
    run()
