"""Google authorization routes.

The flow is deliberately explicit rather than hidden behind a library: start, callback, status,
disconnect. Four endpoints, each doing one thing.

The seven-day token trap is surfaced here rather than buried. A consent screen left in Testing
mode expires refresh tokens weekly, which looks exactly like a bug in this code. The status
endpoint reports the credential's health so that failure is legible.
"""

from __future__ import annotations

import datetime as dt
import secrets

from fastapi import APIRouter, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from cadence.adapters.google_calendar import CALENDAR_SCOPE, authorization_url
from cadence.api.dependencies import AuthServiceDep

router = APIRouter(prefix="/api/auth", tags=["auth"])

# A brief page rather than a redirect, because the user lands here in a browser tab and needs
# to know whether it worked before closing it.
CALLBACK_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Cadence</title>
<style>
 body{{font-family:system-ui,sans-serif;background:#f7f3ea;color:#33291f;
      display:grid;place-items:center;height:100vh;margin:0}}
 main{{max-width:34rem;padding:2rem;border:1px solid #ded5c4;border-radius:6px;
       background:#fdfbf6}}
 h1{{font-size:1.4rem;margin:0 0 .5rem}} code{{background:#f1ece0;padding:.1rem .3rem}}
</style></head>
<body><main><h1>{title}</h1><p>{message}</p></main></body></html>"""


class AuthStartResponse(BaseModel):
    authorization_url: str
    scope: str


class AuthStatusResponse(BaseModel):
    connected: bool
    configured: bool
    account_email: str | None = None
    scope: str | None = None
    obtained_at: dt.datetime | None = None
    last_refreshed_at: dt.datetime | None = None
    last_error: str | None = None
    healthy: bool = False
    hint: str | None = None


@router.get("/status", response_model=AuthStatusResponse)
def auth_status(service: AuthServiceDep) -> AuthStatusResponse:
    return AuthStatusResponse(**service.status())


@router.post("/start", response_model=AuthStartResponse)
def start(request: Request, service: AuthServiceDep) -> AuthStartResponse:
    """Return the URL to visit. The state nonce guards against a forged callback."""
    nonce = secrets.token_urlsafe(24)
    request.app.state.oauth_nonce = nonce
    client_id, redirect_uri = service.client_config()
    return AuthStartResponse(
        authorization_url=authorization_url(
            client_id=client_id,
            redirect_uri=redirect_uri,
            state=nonce,
        ),
        scope=CALENDAR_SCOPE,
    )


@router.get("/callback", response_class=HTMLResponse)
def callback(
    request: Request,
    service: AuthServiceDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> HTMLResponse:
    expected = getattr(request.app.state, "oauth_nonce", None)

    if error:
        return HTMLResponse(
            CALLBACK_PAGE.format(title="Authorization refused", message=f"Google said: {error}"),
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    if not code:
        return HTMLResponse(
            CALLBACK_PAGE.format(
                title="Nothing to exchange",
                message="Google returned no authorization code.",
            ),
            status_code=status.HTTP_400_BAD_REQUEST,
        )
    if expected is None or state != expected:
        # Without this check any page could complete an authorization on the user's behalf.
        return HTMLResponse(
            CALLBACK_PAGE.format(
                title="State mismatch",
                message="This callback did not originate from Cadence. Nothing was stored.",
            ),
            status_code=status.HTTP_403_FORBIDDEN,
        )

    request.app.state.oauth_nonce = None
    try:
        email = service.complete(code)
    except Exception as failure:  # noqa: BLE001 - the page must explain any failure
        return HTMLResponse(
            CALLBACK_PAGE.format(title="Could not connect", message=str(failure)),
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    return HTMLResponse(
        CALLBACK_PAGE.format(
            title="Calendar connected",
            message=(
                f"Cadence can now read and write events for {email or 'your account'}. "
                "You can close this tab."
            ),
        )
    )


@router.post("/disconnect", status_code=status.HTTP_204_NO_CONTENT)
def disconnect(service: AuthServiceDep) -> None:
    service.disconnect()
