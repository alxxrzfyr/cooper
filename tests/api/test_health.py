from fastapi.testclient import TestClient

from cadence.api.security import SHARED_SECRET_HEADER
from cadence.config import Settings
from cadence.main import create_app

SECRET = "health-test-shared-secret-0123456789abcd"
HEADERS = {SHARED_SECRET_HEADER: SECRET}
ALLOWED_ORIGIN = "http://127.0.0.1:5173"


def make_client() -> TestClient:
    settings = Settings(
        shared_secret=SECRET,
        allowed_origin=ALLOWED_ORIGIN,
        allowed_hosts=("testserver",),
    )
    return TestClient(create_app(settings))


def test_health_reports_ready() -> None:
    response = make_client().get("/health", headers=HEADERS)

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_request_without_shared_secret_is_refused() -> None:
    response = make_client().get("/health")

    assert response.status_code == 403


def test_request_with_wrong_shared_secret_is_refused() -> None:
    response = make_client().get("/health", headers={SHARED_SECRET_HEADER: "x" * len(SECRET)})

    assert response.status_code == 403


def test_request_from_unknown_origin_is_refused() -> None:
    response = make_client().get(
        "/health",
        headers={**HEADERS, "Origin": "https://attacker.example"},
    )

    assert response.status_code == 403


def test_request_with_unexpected_host_is_refused() -> None:
    response = make_client().get(
        "/health",
        headers={**HEADERS, "Host": "attacker.example"},
    )

    assert response.status_code == 400


def test_exact_allowed_origin_receives_cors_headers() -> None:
    response = make_client().options(
        "/health",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
