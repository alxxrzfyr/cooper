import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from cadence.adapters.database import Base, build_engine, build_session_factory
from cadence.api.errors import register_error_handlers
from cadence.api.routes_health import router as health_router
from cadence.api.routes_tasks import router as tasks_router
from cadence.api.security import SHARED_SECRET_HEADER, LocalSecurityMiddleware
from cadence.config import Settings


def create_app(settings: Settings | None = None, *, create_schema: bool = False) -> FastAPI:
    """Build the application.

    `create_schema` exists for tests and throwaway databases. Real runs migrate with
    Alembic, so schema creation is never an implicit side effect of starting the server.
    """
    runtime_settings = settings or Settings()  # type: ignore[call-arg]
    app = FastAPI(title="Cadence", docs_url=None, redoc_url=None)

    engine = build_engine(runtime_settings.database_url)
    if create_schema:
        Base.metadata.create_all(engine)
    app.state.engine = engine
    app.state.session_factory = build_session_factory(engine)
    app.state.settings = runtime_settings

    register_error_handlers(app)
    app.include_router(health_router)
    app.include_router(tasks_router)

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
