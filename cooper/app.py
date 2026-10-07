"""Cooper: the whole web app.

One file for every route, because there are only a dozen and spreading them across a layered
architecture is what made the previous attempt hard to follow.

The model proposes; this executes. `brain.py` returns a validated action and nothing else
touches the database, so a wrong answer from Gemini can be refused rather than applied.
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import dataclasses
import datetime as dt
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
import uuid
from collections import deque
from threading import Lock
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field
from sqlalchemy import select, text, update
from sqlalchemy.exc import IntegrityError

from cooper import mcp, sources
from cooper.auth import AuthFailure, AuthIdentity, verify_firebase_token
from cooper.brain import (
    COOPER_IDENTITY,
    Action,
    AskIntent,
    Brain,
    classify_ask_intent,
    guess_category,
    looks_like_a_question,
    sanitize_for_prompt,
    validate,
)
from cooper.config import KEY_MIN, Settings
from cooper.db import (
    AiAllowance,
    AiAttempt,
    AiRequest,
    AiSpendEnvelope,
    Change,
    Item,
    Setting,
    Store,
    aware,
    new_id,
    now,
)
from cooper.google import Calendar, CalendarError, Gmail
from cooper.icloud import ICloudCalDAVProvider
from cooper.planner import (
    Hours,
    RecoveryPlan,
    Slot,
    accepts_interval,
    build_planning_snapshot,
    place,
    preview_recovery,
    project_open_tasks,
    rank,
    weekly_review,
)
from cooper.watcher import EmailProposal, parse_confirmation

SECRET_HEADER = "X-Cooper-Key"
HOURS_SETTING = "hours"
GOOGLE_SETTING = "google_token"
GOOGLE_CONNECTED_SETTING = "google_connected"
GOOGLE_OAUTH_NONCE_SETTING = "google_oauth_nonce"
GOOGLE_OAUTH_BROWSER_COOKIE = "cooper_google_oauth"
GMAIL_SETTING = "gmail"
ICLOUD_SETTING = "icloud_credentials"
ICLOUD_STATUS_SETTING = "icloud_status"
GOOGLE_NOT_CONNECTED = "Google is not connected for this account."
OAUTH_STATE_SECONDS = 600
RATE_WINDOW_SECONDS = 60
API_REQUESTS_PER_MINUTE = 120
SYNC_REQUESTS_PER_MINUTE = 5
_rate_hits: dict[tuple[str, str], deque[float]] = {}
_rate_lock = Lock()
logger = logging.getLogger("cooper.requests")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(handler)


@dataclasses.dataclass(frozen=True, slots=True)
class SyncSummary:
    """What one Gmail pull changed locally, safe for the watcher and dashboard to consume."""

    created: int = 0
    updated: int = 0
    dropped: int = 0
    skipped: int = 0
    error: str | None = None


@dataclasses.dataclass(frozen=True, slots=True)
class OAuthState:
    owner_id: str
    nonce: str
    expires_at: dt.datetime


settings = Settings()  # type: ignore[call-arg]
store = Store(settings.database_url)
brain = Brain(
    api_key=None,
    model=settings.gemini_model,
    timezone=settings.timezone,
)
app = FastAPI(title="Cooper", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.origin],
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[SECRET_HEADER, "Authorization", "Content-Type"],
)


@app.exception_handler(RequestValidationError)
async def request_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    """Return useful locations without reflecting request values into an error response.

    In particular, Pydantic's normal error shape includes the rejected input. That would reflect
    a browser-provided Gemini key when it exceeds its length bound, so values are intentionally
    left out of every validation error Cooper returns.
    """
    detail = [
        {
            "type": error.get("type", "value_error"),
            "loc": error.get("loc", ()),
            "msg": "Invalid request.",
        }
        for error in exc.errors()
    ]
    return JSONResponse({"detail": detail}, status_code=422)


@app.middleware("http")
async def guard(request: Request, call_next: Any) -> Any:
    """Authenticate requests before any route code runs."""
    if request.method == "OPTIONS" or request.url.path == "/health":
        return await call_next(request)

    if request.url.path == "/api/google/callback":
        return await call_next(request)

    if request.url.path == "/api/internal/google/sync":
        return await call_next(request)

    if settings.auth_mode == "local":
        supplied = request.headers.get(SECRET_HEADER, "")
        if not secrets.compare_digest(supplied, settings.key()):
            return JSONResponse({"detail": "Wrong or missing key."}, status_code=403)
        request.state.identity = AuthIdentity(settings.owner_id, "local")
        return await call_next(request)

    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.casefold() != "bearer" or not token.strip():
        return JSONResponse({"detail": "Invalid authentication token"}, status_code=401)

    try:
        identity = verify_firebase_token(
            token.strip(),
            project_id=settings.firebase_project_id or "",
        )
    except AuthFailure as error:
        return JSONResponse({"detail": error.detail}, status_code=error.status_code)

    retry_after = _rate_wait(identity.uid, "api", API_REQUESTS_PER_MINUTE)
    if retry_after is None and request.url.path in {
        "/api/google/sync",
        "/api/icloud/connect",
    }:
        retry_after = _rate_wait(identity.uid, "provider", SYNC_REQUESTS_PER_MINUTE)
    if retry_after is not None:
        return JSONResponse(
            {"detail": "Too many requests. Please try again shortly."},
            status_code=429,
            headers={"Retry-After": str(retry_after)},
        )
    request.state.identity = identity
    return await call_next(request)


def _rate_wait(owner_id: str, bucket: str, limit: int) -> int | None:
    """One-process abuse guard for the current single-worker hosted API."""
    at = time.monotonic()
    key = (owner_id, bucket)
    with _rate_lock:
        hits = _rate_hits.setdefault(key, deque())
        while hits and hits[0] <= at - RATE_WINDOW_SECONDS:
            hits.popleft()
        if len(hits) >= limit:
            return max(1, int(hits[0] + RATE_WINDOW_SECONDS - at) + 1)
        hits.append(at)
    return None


@app.middleware("http")
async def request_log(request: Request, call_next: Any) -> Any:
    """Log bounded request context without URLs, bodies, identities, or credentials."""
    request_id = secrets.token_hex(8)
    started = time.perf_counter()
    status = 500
    try:
        response = await call_next(request)
        status = response.status_code
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        route = request.scope.get("route")
        logger.info(
            json.dumps(
                {
                    "request_id": request_id,
                    "method": request.method,
                    "route": getattr(route, "path", "unmatched"),
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000),
                }
            )
        )


def request_owner(request: Request) -> AuthIdentity:
    identity = getattr(request.state, "identity", None)
    if not isinstance(identity, AuthIdentity):
        raise HTTPException(status_code=401, detail="Invalid authentication token")
    return identity


class Say(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=1000)
    # Manual mode is local and remains the default.
    mode: Literal["manual", "ai"] = "manual"
    logical_request_id: str | None = Field(default=None, max_length=36)
    intent: AskIntent | None = None


AI_SERVICE_OWNER = "cooper-service"


def _ai_period() -> str:
    return now().astimezone(dt.UTC).strftime("%Y-%m")


def provision_ai_pilot(
    owner_id: str,
    limit_units: int,
    aggregate_microusd: int,
    gemini_microusd: int,
    groq_microusd: int,
) -> None:
    """Explicit operator provisioning; never invoked by an HTTP request."""
    values = (limit_units, aggregate_microusd, gemini_microusd, groq_microusd)
    if not owner_id or any(type(value) is not int or value < 0 for value in values):
        raise ValueError("Nonnegative integer allowance and cash limits required")
    period = _ai_period()
    with store.session() as session:
        allowance = session.get(AiAllowance, (owner_id, period))
        if allowance is None:
            session.add(AiAllowance(owner_id=owner_id, period=period, limit_units=limit_units))
        else:
            allowance.limit_units = limit_units
        for scope, limit in zip(("aggregate", "gemini", "groq"), values[1:], strict=True):
            envelope = session.get(AiSpendEnvelope, (AI_SERVICE_OWNER, period, scope))
            if envelope is None:
                session.add(
                    AiSpendEnvelope(
                        owner_id=AI_SERVICE_OWNER, period=period, scope=scope, limit_microusd=limit
                    )
                )
            else:
                envelope.limit_microusd = limit


def _ai_digest(owner_id: str, body: Say) -> str:
    payload = (owner_id, " ".join(body.text.split()), body.mode, body.intent)
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False).encode()).hexdigest()


def _existing_ai(owner_id: str, body: Say) -> tuple[str, dict[str, Any]] | None:
    if not body.logical_request_id or not store.ai_schema_available:
        return None
    with store.session() as session:
        row = session.scalar(
            select(AiRequest).where(
                AiRequest.owner_id == owner_id,
                AiRequest.logical_request_id == body.logical_request_id,
            )
        )
        if row is None:
            return None
        if row.payload_digest != _ai_digest(owner_id, body):
            raise HTTPException(409, "Request ID was already used for different input")
        response = (
            row.response
            if row.state in {"completed", "failed"} and row.response
            else {
                "kind": "pending",
                "message": "This request is pending review; retrying cannot dispatch it again.",
                "logical_request_id": row.logical_request_id,
            }
        )
        return row.id, dict(response)


def _reserve_ai_cost(session, period: str, provider: str, amount: int) -> None:
    for scope in ("aggregate", provider):
        result = session.execute(
            update(AiSpendEnvelope)
            .where(
                AiSpendEnvelope.owner_id == AI_SERVICE_OWNER,
                AiSpendEnvelope.period == period,
                AiSpendEnvelope.scope == scope,
                AiSpendEnvelope.enabled.is_(True),
                AiSpendEnvelope.reserved_microusd + AiSpendEnvelope.spent_microusd + amount
                <= AiSpendEnvelope.limit_microusd,
            )
            .values(reserved_microusd=AiSpendEnvelope.reserved_microusd + amount)
        )
        if result.rowcount != 1:
            raise HTTPException(429, "Included AI spending limit reached or unavailable")


def _admit_ai(owner_id: str, body: Say, cost: int) -> tuple[str, dict[str, Any] | None]:
    if not store.ai_schema_available:
        raise HTTPException(503, "Included AI accounting migration is required")
    existing = _existing_ai(owner_id, body)
    if existing:
        return existing
    try:
        logical_id = str(uuid.UUID(body.logical_request_id or ""))
    except ValueError:
        raise HTTPException(
            422, "A UUID logical_request_id is required for assisted requests"
        ) from None
    # Canonical IDs avoid alternate UUID spellings bypassing uniqueness.
    body.logical_request_id = logical_id
    existing = _existing_ai(owner_id, body)
    if existing:
        return existing
    period = _ai_period()
    request_id = str(uuid.uuid4())
    try:
        with store.session() as session:
            session.add(
                AiRequest(
                    id=request_id,
                    owner_id=owner_id,
                    logical_request_id=logical_id,
                    payload_digest=_ai_digest(owner_id, body),
                    period=period,
                )
            )
            session.flush()
            result = session.execute(
                update(AiAllowance)
                .where(
                    AiAllowance.owner_id == owner_id,
                    AiAllowance.period == period,
                    AiAllowance.reserved_units + AiAllowance.consumed_units
                    < AiAllowance.limit_units,
                )
                .values(reserved_units=AiAllowance.reserved_units + 1)
            )
            if result.rowcount != 1:
                raise HTTPException(429, "Included AI allowance exhausted or unavailable")
            _reserve_ai_cost(session, period, "gemini", cost)
            session.add(
                AiAttempt(
                    id=str(uuid.uuid4()),
                    owner_id=owner_id,
                    request_id=request_id,
                    attempt_no=1,
                    provider="gemini",
                    model=settings.gemini_model,
                    price_revision=settings.ai_price_revision,
                    input_rate_microusd=settings.gemini_input_microusd_per_million,
                    output_rate_microusd=settings.gemini_output_microusd_per_million,
                    reserved_microusd=cost,
                )
            )
    except IntegrityError:
        existing = _existing_ai(owner_id, body)
        if existing:
            return existing
        raise HTTPException(503, "Included AI allowance is not provisioned") from None
    return request_id, None


def _ai_status(owner_id: str) -> dict[str, Any]:
    at = now().astimezone(dt.UTC)
    reset = (at.replace(day=28) + dt.timedelta(days=4)).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    )
    result = {
        "status": "unavailable",
        "tier": "free",
        "remaining_units": 0,
        "limit_units": 0,
        "reset_at": reset.isoformat(),
    }
    if not store.ai_schema_available:
        return result
    with store.session() as session:
        row = session.get(AiAllowance, (owner_id, _ai_period()))
        if row is None:
            return result
        remaining = row.limit_units - row.reserved_units - row.consumed_units
        result.update(tier=row.tier, remaining_units=remaining, limit_units=row.limit_units)
        envelopes = [
            session.get(AiSpendEnvelope, (AI_SERVICE_OWNER, row.period, scope))
            for scope in ("aggregate", "gemini", "groq")
        ]
        if settings.included_ai_enabled and all(
            env and env.enabled and env.reserved_microusd + env.spent_microusd < env.limit_microusd
            for env in envelopes
        ):
            result["status"] = "ready" if remaining else "exhausted"
    return result


def _ai_cost(provider: str, input_tokens: int, output_tokens: int) -> int:
    rate_in = getattr(settings, f"{provider}_input_microusd_per_million")
    rate_out = getattr(settings, f"{provider}_output_microusd_per_million")
    return (input_tokens * rate_in + output_tokens * rate_out + 999_999) // 1_000_000


def _lock_ai_accounting(session, request: AiRequest) -> None:
    """Portable write-lock order: request, owner allowance, attempt, envelopes."""
    session.execute(update(AiRequest).where(AiRequest.id == request.id).values(updated_at=now()))
    result = session.execute(
        update(AiAllowance)
        .where(
            AiAllowance.owner_id == request.owner_id,
            AiAllowance.period == request.period,
        )
        .values(updated_at=now())
    )
    if result.rowcount != 1:
        raise RuntimeError("Request allowance is missing")


def _settle_ai_attempt(
    attempt_id: str,
    input_tokens: int | None,
    output_tokens: int | None,
    *,
    freeze_missing: bool = False,
) -> bool:
    with store.session() as session:
        attempt = session.get(AiAttempt, attempt_id)
        if attempt is None or attempt.state != "dispatching":
            raise RuntimeError("Provider attempt is not awaiting settlement")
        request = session.get(AiRequest, attempt.request_id)
        measured = input_tokens is not None and output_tokens is not None
        actual = _attempt_cost(attempt, input_tokens, output_tokens) if measured else None
        oversized = measured and (
            input_tokens > settings.ai_input_token_bound
            or output_tokens > settings.ai_output_token_bound
            or actual > attempt.reserved_microusd
        )
        _lock_ai_accounting(session, request)
        target = "settled" if measured and not oversized else "uncertain"
        claimed = session.execute(
            update(AiAttempt)
            .where(
                AiAttempt.id == attempt_id,
                AiAttempt.state == "dispatching",
            )
            .values(
                state=target,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                actual_microusd=actual,
            )
        )
        if claimed.rowcount != 1:
            raise RuntimeError("Provider attempt was already settled")
        if target == "uncertain":
            if oversized or freeze_missing:
                for scope in ("aggregate", attempt.provider):
                    session.execute(
                        update(AiSpendEnvelope)
                        .where(
                            AiSpendEnvelope.owner_id == AI_SERVICE_OWNER,
                            AiSpendEnvelope.period == request.period,
                            AiSpendEnvelope.scope == scope,
                        )
                        .values(enabled=False)
                    )
            return not oversized
        for scope in ("aggregate", attempt.provider):
            result = session.execute(
                update(AiSpendEnvelope)
                .where(
                    AiSpendEnvelope.owner_id == AI_SERVICE_OWNER,
                    AiSpendEnvelope.period == request.period,
                    AiSpendEnvelope.scope == scope,
                    AiSpendEnvelope.reserved_microusd >= attempt.reserved_microusd,
                )
                .values(
                    reserved_microusd=AiSpendEnvelope.reserved_microusd - attempt.reserved_microusd,
                    spent_microusd=AiSpendEnvelope.spent_microusd + actual,
                )
            )
            if result.rowcount != 1:
                raise RuntimeError("Provider cost reservation is inconsistent")
        return True


@dataclasses.dataclass
class AssistedRequest:
    owner_id: str
    request_id: str
    deadline: float
    provider: str = "gemini"
    calls: int = 0
    stopped: bool = False

    def dispatch(self, body: dict[str, Any]) -> dict[str, Any]:
        from cooper import providers

        if self.stopped:
            raise providers.ProviderFailure("refusal")
        # Reviewed token upper bound includes normalized transport overhead. Reject
        # oversized bodies rather than truncate safety instructions or tool history.
        if len(json.dumps(body, ensure_ascii=False).encode()) > settings.ai_input_token_bound:
            self.stopped = True
            raise providers.ProviderFailure("invalid_response")
        config = body.setdefault("generationConfig", {})
        config["maxOutputTokens"] = min(
            config.get("maxOutputTokens", 384), settings.ai_output_token_bound
        )
        for _ in range(2):
            if self.calls >= 4 or time.monotonic() >= self.deadline:
                self.stopped = True
                raise providers.ProviderFailure("unavailable")
            provider = self.provider
            cost = _ai_cost(provider, settings.ai_input_token_bound, settings.ai_output_token_bound)
            with store.session() as session:
                request = session.get(AiRequest, self.request_id)
                if (
                    request is None
                    or request.owner_id != self.owner_id
                    or request.state not in {"admitted", "running"}
                ):
                    raise RuntimeError("Provider dispatch outside admitted request")
                _lock_ai_accounting(session, request)
                number = self.calls + 1
                if number == 1:
                    attempt = session.scalar(
                        select(AiAttempt).where(
                            AiAttempt.request_id == self.request_id, AiAttempt.attempt_no == 1
                        )
                    )
                else:
                    _reserve_ai_cost(session, request.period, provider, cost)
                    attempt = AiAttempt(
                        id=str(uuid.uuid4()),
                        owner_id=self.owner_id,
                        request_id=self.request_id,
                        attempt_no=number,
                        provider=provider,
                        model=settings.gemini_model
                        if provider == "gemini"
                        else settings.groq_model,
                        price_revision=settings.ai_price_revision,
                        input_rate_microusd=getattr(
                            settings, f"{provider}_input_microusd_per_million"
                        ),
                        output_rate_microusd=getattr(
                            settings, f"{provider}_output_microusd_per_million"
                        ),
                        state="reserved",
                        reserved_microusd=cost,
                    )
                    session.add(attempt)
                if attempt is None or attempt.state != "reserved":
                    raise RuntimeError("Attempt was already dispatched")
                attempt.state = "dispatching"
                claimed = session.execute(
                    update(AiRequest)
                    .where(
                        AiRequest.id == self.request_id,
                        AiRequest.owner_id == self.owner_id,
                        AiRequest.state.in_(("admitted", "running")),
                    )
                    .values(state="running")
                )
                if claimed.rowcount != 1:
                    raise RuntimeError("Provider request was abandoned before dispatch")
                attempt_id = attempt.id
            self.calls += 1
            secret = settings.gemini_api_key if provider == "gemini" else settings.groq_api_key
            try:
                reply = providers.generate(
                    provider,
                    secret.get_secret_value(),
                    settings.gemini_model if provider == "gemini" else settings.groq_model,
                    body,
                    max(0.001, min(20.0, self.deadline - time.monotonic())),
                )
            except providers.ProviderFailure as failure:
                valid_cost = _settle_ai_attempt(
                    attempt_id,
                    failure.input_tokens,
                    failure.output_tokens,
                    freeze_missing=failure.kind == "invalid_response",
                )
                if (
                    valid_cost
                    and provider == "gemini"
                    and failure.kind in {"timeout", "unavailable"}
                ):
                    self.provider = "groq"
                    continue
                self.stopped = True
                raise
            except Exception:
                _settle_ai_attempt(attempt_id, None, None)
                self.stopped = True
                raise
            if not _settle_ai_attempt(attempt_id, reply.input_tokens, reply.output_tokens):
                self.stopped = True
                raise providers.ProviderFailure("invalid_response")
            return reply.envelope
        self.stopped = True
        raise providers.ProviderFailure("unavailable")


def _finish_ai(session, request_id: str, result: dict[str, Any], *, useful: bool) -> None:
    row = session.get(AiRequest, request_id)
    if row is None or row.allowance_state != "reserved":
        raise RuntimeError("Logical request has already settled")
    _lock_ai_accounting(session, row)
    if useful and row.state not in {"running", "applying"}:
        raise RuntimeError("Abandoned request cannot complete")
    attempts = session.scalars(select(AiAttempt).where(AiAttempt.request_id == request_id)).all()
    for attempt in attempts:
        if attempt.state == "reserved":
            claim = session.execute(
                update(AiAttempt)
                .where(
                    AiAttempt.id == attempt.id,
                    AiAttempt.state == "reserved",
                )
                .values(state="released")
            )
            if claim.rowcount != 1:
                raise RuntimeError("Attempt reservation was already released")
            for scope in ("aggregate", attempt.provider):
                session.execute(
                    update(AiSpendEnvelope)
                    .where(
                        AiSpendEnvelope.owner_id == AI_SERVICE_OWNER,
                        AiSpendEnvelope.period == row.period,
                        AiSpendEnvelope.scope == scope,
                    )
                    .values(
                        reserved_microusd=AiSpendEnvelope.reserved_microusd
                        - attempt.reserved_microusd
                    )
                )
            attempt.state = "released"
    uncertain = any(attempt.state in {"dispatching", "uncertain"} for attempt in attempts)
    if useful or not uncertain:
        allowance_state = "consumed" if useful else "released"
        claim = session.execute(
            update(AiRequest)
            .where(
                AiRequest.id == request_id,
                AiRequest.allowance_state == "reserved",
                AiRequest.state.in_(
                    ("running", "applying")
                    if useful
                    else ("admitted", "running", "applying", "uncertain")
                ),
            )
            .values(allowance_state=allowance_state)
        )
        if claim.rowcount != 1:
            raise RuntimeError("Logical request was already finalized")
        result_update = session.execute(
            update(AiAllowance)
            .where(
                AiAllowance.owner_id == row.owner_id,
                AiAllowance.period == row.period,
                AiAllowance.reserved_units > 0,
            )
            .values(
                reserved_units=AiAllowance.reserved_units - 1,
                consumed_units=AiAllowance.consumed_units + (1 if useful else 0),
            )
        )
        if result_update.rowcount != 1:
            raise RuntimeError("Allowance reservation is inconsistent")
        row.allowance_state = allowance_state
    row.state = "completed" if useful else "uncertain" if uncertain else "failed"
    # Full snapshot/provider details are read afresh, never stored as service receipt.
    row.response = {
        key: value for key, value in result.items() if key != "view" and not key.startswith("_")
    }


def _attempt_cost(attempt: AiAttempt, input_tokens: int, output_tokens: int) -> int:
    return (
        input_tokens * attempt.input_rate_microusd
        + output_tokens * attempt.output_rate_microusd
        + 999_999
    ) // 1_000_000


def abandon_ai_request(request_id: str) -> None:
    """Operator-reviewed abandoned worker; no takeover and no repeated mutation."""
    with store.session() as session:
        row = session.get(AiRequest, request_id)
        if row is None or row.state in {"completed", "failed"}:
            raise ValueError("Only pending requests can be abandoned")
        previous_state = row.state
        _lock_ai_accounting(session, row)
        claim = session.execute(
            update(AiRequest)
            .where(
                AiRequest.id == request_id,
                AiRequest.state == previous_state,
                AiRequest.allowance_state == "reserved",
            )
            .values(state="uncertain")
        )
        if claim.rowcount != 1:
            raise ValueError("Request state changed during review")
        session.execute(
            update(AiAttempt)
            .where(AiAttempt.request_id == request_id, AiAttempt.state == "dispatching")
            .values(state="uncertain")
        )
        _finish_ai(
            session,
            request_id,
            {
                "kind": "question",
                "source": "cooper",
                "message": (
                    "This abandoned request was closed without replay. "
                    "Please submit again or use Form."
                ),
            },
            useful=False,
        )


def reconcile_ai_attempt(
    attempt_id: str,
    *,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    proven_not_dispatched: bool = False,
) -> None:
    """Operator-only evidence-backed resolution; costs use immutable dispatch prices."""
    if proven_not_dispatched and (input_tokens is not None or output_tokens is not None):
        raise ValueError("Choose non-dispatch evidence or measured usage")
    if not proven_not_dispatched and (input_tokens is None or output_tokens is None):
        raise ValueError("Provider usage evidence is required")
    if any(
        type(value) is not int or value < 0
        for value in (input_tokens, output_tokens)
        if value is not None
    ):
        raise ValueError("Nonnegative usage is required")
    with store.session() as session:
        attempt = session.get(AiAttempt, attempt_id)
        if attempt is None or attempt.state not in {"uncertain", "dispatching"}:
            raise ValueError("Only unresolved attempts can be reconciled")
        request = session.get(AiRequest, attempt.request_id)
        actual = 0 if proven_not_dispatched else _attempt_cost(attempt, input_tokens, output_tokens)
        _lock_ai_accounting(session, request)
        target = "released" if proven_not_dispatched else "settled"
        claim = session.execute(
            update(AiAttempt)
            .where(AiAttempt.id == attempt_id, AiAttempt.state.in_(("uncertain", "dispatching")))
            .values(state=target)
        )
        if claim.rowcount != 1:
            raise ValueError("Attempt was already reconciled")
        for scope in ("aggregate", attempt.provider):
            result = session.execute(
                update(AiSpendEnvelope)
                .where(
                    AiSpendEnvelope.owner_id == AI_SERVICE_OWNER,
                    AiSpendEnvelope.period == request.period,
                    AiSpendEnvelope.scope == scope,
                    AiSpendEnvelope.reserved_microusd >= attempt.reserved_microusd,
                    AiSpendEnvelope.spent_microusd
                    + AiSpendEnvelope.reserved_microusd
                    - attempt.reserved_microusd
                    + actual
                    <= AiSpendEnvelope.limit_microusd,
                )
                .values(
                    reserved_microusd=AiSpendEnvelope.reserved_microusd - attempt.reserved_microusd,
                    spent_microusd=AiSpendEnvelope.spent_microusd + actual,
                )
            )
            if result.rowcount != 1:
                raise ValueError("Reviewed cash envelope does not cover measured cost")
        attempt.input_tokens, attempt.output_tokens = input_tokens, output_tokens
        attempt.actual_microusd = actual
        session.flush()
        if request.state == "uncertain" and request.response:
            unresolved = session.scalar(
                select(AiAttempt.id).where(
                    AiAttempt.request_id == request.id,
                    AiAttempt.state.in_(("uncertain", "dispatching")),
                )
            )
            if unresolved is None and request.allowance_state == "reserved":
                _finish_ai(session, request.id, request.response, useful=False)


def review_ai_envelopes(period: str) -> None:
    """Explicit operator re-enable after model/price/budget reconciliation review."""
    with store.session() as session:
        for scope in ("aggregate", "gemini", "groq"):
            result = session.execute(
                update(AiSpendEnvelope)
                .where(
                    AiSpendEnvelope.owner_id == AI_SERVICE_OWNER,
                    AiSpendEnvelope.period == period,
                    AiSpendEnvelope.scope == scope,
                    AiSpendEnvelope.reserved_microusd + AiSpendEnvelope.spent_microusd
                    <= AiSpendEnvelope.limit_microusd,
                )
                .values(enabled=True)
            )
            if result.rowcount != 1:
                raise ValueError("Reviewed complete cash envelopes are required")


class HoursIn(BaseModel):
    start_hour: int = Field(ge=0, le=23)
    end_hour: int = Field(ge=1, le=24)
    weekdays: list[int]
    max_per_day: int = Field(ge=1, le=100)
    windows: list[tuple[int, int, int]] | None = None
    break_minutes: int = Field(default=10, ge=0, le=1440)
    max_minutes_per_day: int | None = Field(default=None, ge=1, le=1440)


class ItemIn(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    minutes: int | None = Field(default=None, ge=1, le=1440)
    importance: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = None


class MoveIn(BaseModel):
    start: dt.datetime
    minutes: int = Field(ge=1, le=1440)


class NewItem(BaseModel):
    """Manual mode, as a form rather than a sentence.

    Every field is here as a value, so nothing is parsed and the model is never called. This is
    the whole point of requirement 6: Manual stopped meaning "type a sentence and have simple
    rules read it", which was the typing without the smartness.

    A due date arrives as a plain ISO date. A `start` datetime turns the item into an event; a
    task leaves it empty and gets booked into working hours like any other.
    """

    title: str = Field(min_length=1, max_length=300)
    kind: Literal["task", "event"] = "task"
    minutes: int | None = Field(default=None, ge=1, le=1440)
    importance: int = Field(default=3, ge=1, le=5)
    category: Literal["academics", "work", "organizations", "personal"] | None = None
    due: dt.date | None = None
    start: dt.datetime | None = None
    end: dt.datetime | None = None
    meeting_url: AnyHttpUrl | None = None
    location: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=5000)


class BulkIn(BaseModel):
    """A bulk complete or drop, confirmed against the exact ids shown to the user.

    The list is chosen in a first request (a match) and acted on in a second (this), so the user
    always sees what will happen before it does. Undo is enough for one item and not for twenty.
    """

    verb: Literal["complete", "drop"]
    ids: list[str] = Field(min_length=1, max_length=100)


class ICloudCredentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)


def current_hours(owner_id: str) -> Hours:
    saved = store.get_setting(owner_id, HOURS_SETTING)
    if saved:
        return Hours.from_setting({**saved, "timezone": settings.timezone})
    return Hours(timezone=settings.timezone)


def google_calendar(owner_id: str) -> Calendar:
    """Build a Calendar client from this owner's encrypted Google grant."""
    calendar = Calendar(
        client_id=settings.google_client_id,
        client_secret=settings.google_secret(),
        redirect_uri=settings.google_redirect_uri,
        encryption_key=settings.encryption(),
        calendar_id=settings.calendar_id,
    )
    saved = store.get_setting(owner_id, GOOGLE_SETTING) or {}
    token = saved.get("token") if isinstance(saved, dict) else None
    calendar.load_token(token if isinstance(token, str) else None)
    return calendar


def google_gmail(owner_id: str) -> Gmail:
    return Gmail(google_calendar(owner_id), lookback_days=settings.gmail_lookback_days)


def connected_calendar(owner_id: str) -> Calendar | None:
    calendar = google_calendar(owner_id)
    return calendar if calendar.connected else None


def icloud_calendar(owner_id: str) -> ICloudCalDAVProvider:
    saved = store.get_setting(owner_id, ICLOUD_SETTING) or {}
    sealed = saved.get("credential") if isinstance(saved, dict) else None
    return ICloudCalDAVProvider(
        encryption_key=settings.encryption(),
        sealed=sealed if isinstance(sealed, str) else None,
        timezone=settings.timezone,
    )


def _google_connected(owner_id: str) -> dict[str, Any]:
    saved = store.get_setting(owner_id, GOOGLE_CONNECTED_SETTING) or {}
    return saved if isinstance(saved, dict) else {}


def _is_local_item(item: Item, owner_id: str) -> bool:
    """Return whether Cooper owns an item and may change it."""
    return item.source == "me" and item.owner_id == owner_id


def _require_local_item(item: Item, owner_id: str) -> None:
    """Reject attempts to mutate an item managed by an external source."""
    if not _is_local_item(item, owner_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "External calendar items are read-only in COOPER. "
                "Change this event in its source calendar instead."
            ),
        )


def find(session: Any, owner_id: str, words: str, *, include_external: bool = False) -> Item | None:
    """Match an item by words the user typed. Exact, then contained, then nothing.

    Returning None rather than a best guess is deliberate: acting on the wrong task is worse
    than asking.
    """
    needle = words.strip().lower()
    if not needle:
        return None
    items = [
        item
        for item in store.open_items(session, owner_id)
        if include_external or _is_local_item(item, owner_id)
    ]

    for item in items:
        if item.id == words or item.title.lower() == needle:
            return item

    hits = [item for item in items if needle in item.title.lower()]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:
        raise HTTPException(
            status_code=409,
            detail=f"“{words}” matches {len(hits)} items: "
            + ", ".join(item.title for item in hits[:4]),
        )

    words_in_needle = [word for word in needle.split() if len(word) > 3]
    loose = [
        item
        for item in items
        if words_in_needle and all(word in item.title.lower() for word in words_in_needle)
    ]
    return loose[0] if len(loose) == 1 else None


def google_events(
    owner_id: str, *, days: int = 14, health: list[dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    """Your real calendar events for display. Empty when Google is off.

    The display window is wider than the planner window so Calendar can show a complete month
    and nearby ranges. Scheduling still uses the shorter busy-time horizon in sources.py.
    """
    calendar = connected_calendar(owner_id)
    if calendar is None:
        return []
    try:
        events = getattr(calendar, "events", None)
        entries = (
            events(days=366, lookback_hours=0) if callable(events) else calendar.busy(days=days)
        )
    except CalendarError:
        if health is not None:
            health.append(
                {
                    "source": "google",
                    "status": "unavailable",
                    "message": "Google calendar could not be refreshed.",
                }
            )
        return []
    if health is not None:
        health.append({"source": "google", "status": "ok"})
    with store.session() as session:
        linked = {
            item.google_event_id: item
            for item in store.open_items(session, owner_id)
            if item.google_event_id and _is_local_item(item, owner_id)
        }

    def matches(entry: Any) -> bool:
        item = linked.get(getattr(entry, "event_id", None))
        return bool(
            item
            and item.title == entry.title
            and item.start_at == entry.start
            and item.end_at == entry.end
            and (item.notes or "") == (getattr(entry, "description", None) or "")
        )

    return [
        {
            "title": entry.title,
            "start_at": entry.start.isoformat(),
            "end_at": entry.end.isoformat(),
            "category": guess_category(entry.title),
            "mine": matches(entry),
            "legacy_difference": bool(
                getattr(entry, "event_id", None) in linked and not matches(entry)
            ),
            "source": "google",
            "event_id": getattr(entry, "event_id", None),
            "all_day": getattr(entry, "all_day", False),
            "time_zone": getattr(entry, "time_zone", None),
            "meeting_url": getattr(entry, "meeting_url", None),
            "location": getattr(entry, "location", None),
            "description": getattr(entry, "description", None),
            "organizer_email": getattr(entry, "organizer_email", None),
            "organizer_name": getattr(entry, "organizer_name", None),
            "response_status": getattr(entry, "response_status", None),
            "attendees": list(getattr(entry, "attendees", ())),
            "calendar_name": getattr(entry, "calendar_name", None),
            "links": list(getattr(entry, "links", ())),
            "reminders": list(getattr(entry, "reminders", ())),
            "attachments": list(getattr(entry, "attachments", ())),
            "metadata": list(getattr(entry, "metadata", ())),
        }
        for entry in sorted(entries, key=lambda entry: entry.start)
    ]


def icloud_events(
    owner_id: str, *, days: int = 366, health: list[dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    calendar = icloud_calendar(owner_id)
    if not calendar.connected:
        return []
    try:
        entries = calendar.events(days=days)
    except CalendarError:
        if health is not None:
            health.append(
                {
                    "source": "icloud",
                    "status": "unavailable",
                    "message": "iCloud calendar could not be refreshed.",
                }
            )
        return []
    if health is not None:
        health.append({"source": "icloud", "status": "ok"})
    return [
        {
            "title": entry.title,
            "start_at": entry.start.isoformat(),
            "end_at": entry.end.isoformat(),
            "category": guess_category(entry.title),
            "mine": False,
            "source": "icloud",
            "event_id": entry.event_id,
            "all_day": entry.all_day,
            "time_zone": entry.time_zone,
            "meeting_url": entry.meeting_url,
            "location": entry.location,
            "description": entry.description,
            "organizer_email": entry.organizer_email,
            "organizer_name": entry.organizer_name,
            "response_status": entry.response_status,
            "attendees": list(entry.attendees),
            "calendar_name": entry.calendar_name,
            "links": list(entry.links),
            "reminders": list(entry.reminders),
            "attachments": list(entry.attachments),
            "metadata": list(entry.metadata),
        }
        for entry in sorted(entries, key=lambda entry: entry.start)
    ]


def item_details(*, notes: str | None, location: str | None, meeting_url: str | None) -> str | None:
    """Store optional form details in the existing item notes field."""
    parts = []
    if location:
        parts.append(f"Location: {location.strip()}")
    if meeting_url:
        parts.append(f"Meeting link: {meeting_url}")
    if notes and notes.strip():
        parts.append(f"Notes:\n{notes.strip()}")
    return "\n\n".join(parts) or None


def item_location(notes: str | None) -> str | None:
    """Recover the optional location when a task is later booked into an event."""
    if not notes:
        return None
    match = re.search(r"^Location:\s*(.+)$", notes, re.MULTILINE)
    return match.group(1).strip() if match else None


def busy_windows(owner_id: str, *, days: int = 14) -> list[tuple[dt.datetime, dt.datetime]]:
    """Times already committed, from every source. The gathering itself lives in sources.py.

    Kept as a one-line wrapper so the schedulers below read the same as before and there is one
    obvious place — sources.py — where a new commitment source is added.
    """
    icloud = icloud_calendar(owner_id)
    providers = (icloud,) if icloud.connected else ()
    return sources.busy_windows(
        store,
        owner_id,
        connected_calendar(owner_id),
        at=now(),
        days=days,
        providers=providers,
    )


def sync_gmail_once(owner_id: str) -> SyncSummary:
    """Read and reconcile recent confirmation proposals without touching a remote calendar.

    Gmail message ids and bodies remain inside the transport/parser boundary.  This function only
    receives the small proposal shape and is the one database writer for Gmail-backed Items.
    """
    checked_at = now()
    gmail = google_gmail(owner_id)
    if not gmail.connected:
        summary = SyncSummary(error=GOOGLE_NOT_CONNECTED)
        _record_gmail_health(owner_id, checked_at, summary)
        return summary

    try:
        messages = gmail.list_messages(
            after=(
                checked_at
                - dt.timedelta(days=settings.gmail_lookback_days)
                + dt.timedelta(seconds=1)
            ),
            max_results=100,
        )
    except CalendarError:
        summary = SyncSummary(error="Gmail could not be reached.")
        _record_gmail_health(owner_id, checked_at, summary)
        return summary

    proposals: list[EmailProposal] = []
    skipped = 0
    # Apply messages oldest first so later cancellations win.
    for message in sorted(messages, key=lambda entry: getattr(entry, "internal_at", checked_at)):
        try:
            proposal = parse_confirmation(message, timezone=settings.timezone, now=checked_at)
        except (TypeError, ValueError):
            proposal = None
        if proposal is None:
            skipped += 1
        else:
            proposals.append(proposal)

    summary = _reconcile_gmail_proposals(owner_id, proposals, skipped=skipped)
    _record_gmail_health(owner_id, checked_at, summary)
    return summary


def _reconcile_gmail_proposals(
    owner_id: str, proposals: list[EmailProposal], *, skipped: int = 0
) -> SyncSummary:
    """Apply Gmail proposals in one local transaction; imported changes are never undoable."""
    created = updated = dropped = 0
    with store.session() as session:
        for proposal in proposals:
            # Do not let validation invent an end time for an email proposal.
            if not proposal.cancelled and (
                proposal.start is None
                or proposal.end is None
                or proposal.start.tzinfo is None
                or proposal.end.tzinfo is None
                or proposal.end <= proposal.start
            ):
                skipped += 1
                continue
            action = validate(
                Action(
                    verb="add",
                    title=proposal.title,
                    kind="event",
                    start=proposal.start,
                    end=proposal.end,
                    category=guess_category(proposal.title),
                    location=proposal.location,
                    meeting_url=proposal.meeting_url,
                    source="gmail",
                )
            )
            if action.is_question:
                skipped += 1
                continue

            row = session.scalars(
                select(Item).where(
                    Item.owner_id == owner_id,
                    Item.source == "gmail",
                    Item.source_ref == proposal.source_ref,
                )
            ).first()
            if proposal.cancelled:
                if row is None or row.status == "dropped":
                    skipped += 1
                    continue
                row.status = "dropped"
                dropped += 1
                continue

            if action.start is None or action.end is None:
                skipped += 1
                continue
            if row is None:
                session.add(
                    Item(
                        id=new_id(),
                        owner_id=owner_id,
                        source="gmail",
                        source_ref=proposal.source_ref,
                        kind="event",
                        title=action.title or proposal.title,
                        importance=3,
                        category=action.category or "personal",
                        notes=item_details(
                            notes=None,
                            location=proposal.location,
                            meeting_url=proposal.meeting_url,
                        ),
                        start_at=action.start,
                        end_at=action.end,
                        created_at=now(),
                    )
                )
                created += 1
                continue

            changed = (
                row.title != action.title
                or aware(row.start_at) != action.start.astimezone(dt.UTC)
                or aware(row.end_at) != action.end.astimezone(dt.UTC)
                or row.category != action.category
                or row.notes
                != item_details(
                    notes=None,
                    location=proposal.location,
                    meeting_url=proposal.meeting_url,
                )
                or row.status != "open"
            )
            if not changed:
                skipped += 1
                continue
            row.title = action.title or proposal.title
            row.start_at = action.start
            row.end_at = action.end
            row.category = action.category or "personal"
            row.notes = item_details(
                notes=None,
                location=proposal.location,
                meeting_url=proposal.meeting_url,
            )
            row.status = "open"
            updated += 1

    return SyncSummary(created=created, updated=updated, dropped=dropped, skipped=skipped)


def _record_gmail_health(owner_id: str, checked_at: dt.datetime, summary: SyncSummary) -> None:
    """Keep watcher health and safe counters, never Gmail bodies or message ids."""
    store.set_setting(
        owner_id,
        GMAIL_SETTING,
        {
            "last_checked": checked_at.isoformat(),
            "last_error": summary.error,
            "counts": {
                "created": summary.created,
                "updated": summary.updated,
                "dropped": summary.dropped,
                "skipped": summary.skipped,
            },
        },
    )


def today_view(owner_id: str, *, using_model: bool | None = None) -> dict[str, Any]:
    at = now()
    hours = current_hours(owner_id)
    zone = ZoneInfo(settings.timezone)

    with store.session() as session:
        items = store.open_items(session, owner_id)
        scheduled = [
            item.to_dict()
            for item in sorted(
                (item for item in items if item.start_at),
                key=lambda entry: aware(entry.start_at) or at,
            )
        ]
        change = store.last_change(session, owner_id)
        undo_label = change.label if change else None
    gmail_health = store.get_setting(owner_id, GMAIL_SETTING) or {}
    gmail_counts = gmail_health.get("counts") or {}
    calendar = google_calendar(owner_id)
    gmail = Gmail(calendar, lookback_days=settings.gmail_lookback_days)
    google_connected = _google_connected(owner_id)
    icloud = icloud_calendar(owner_id)
    icloud_status = store.get_setting(owner_id, ICLOUD_STATUS_SETTING) or {}

    source_health: list[dict[str, Any]] = []
    events = [
        *google_events(owner_id, health=source_health),
        *icloud_events(owner_id, health=source_health),
    ]
    availability = {
        "complete": all(entry["status"] == "ok" for entry in source_health),
        "source_health": source_health,
    }
    commitments = [
        commitment
        for item in items
        if (commitment := sources.normalize_local_commitment(item)) is not None
    ]
    commitments.extend(sources.normalize_provider_commitment(event) for event in events)
    planning = build_planning_snapshot(
        items=items,
        commitments=commitments,
        source_health=source_health,
        hours=hours,
        at=at,
    )
    items_by_id = {item.id: item.to_dict() for item in items}
    events_by_identity = {
        (str(event.get("source")), str(event.get("event_id"))): event
        for event in events
        if event.get("event_id")
    }
    for commitment in planning["commitments"]:
        local_item = items_by_id.get(commitment["local_item_id"])
        if local_item is not None and commitment["editable"]:
            commitment["item"] = local_item
            continue
        provider_event = events_by_identity.get(
            (commitment["source"], str(commitment["source_id"]))
        )
        if provider_event is not None:
            commitment["event"] = provider_event
    shortlist = []
    for entry in planning["tasks"]:
        payload = dict(entry)
        if payload["kind"] == "task" and not payload["start_at"]:
            payload["waiting_reason"] = payload.get("waiting_reason") or _waiting_reason(
                payload, availability
            )
        shortlist.append(payload)
    planning["tasks"] = shortlist
    ai_status = _ai_status(owner_id)
    return {
        "now": at.isoformat(),
        "today": at.astimezone(zone).date().isoformat(),
        "timezone": settings.timezone,
        "shortlist": shortlist,
        "scheduled": scheduled,
        "hours": hours.as_setting(),
        "events": events,
        "source_health": source_health,
        "planning": planning,
        "undo": undo_label,
        "using_model": ai_status["status"] == "ready",
        "ai": ai_status,
        "calendar": {
            "configured": calendar.configured,
            "connected": calendar.connected,
            "email": google_connected.get("email"),
        },
        "gmail": {
            "configured": gmail.configured,
            "connected": gmail.connected,
            "last_checked": gmail_health.get("last_checked"),
            "last_error": gmail_health.get("last_error"),
            "imported": gmail_counts.get("created", 0),
            "skipped": gmail_counts.get("skipped", 0),
        },
        "icloud": {
            "configured": icloud.configured,
            "connected": icloud.connected,
            "email": icloud.email,
            "error": icloud_status.get("error") if isinstance(icloud_status, dict) else None,
        },
    }


@app.get("/health")
def health() -> dict[str, str]:
    try:
        with store.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        raise HTTPException(status_code=503, detail="Database unavailable.") from None
    return {"status": "ok"}


@app.get("/api/today")
def get_today(request: Request) -> dict[str, Any]:
    return today_view(request_owner(request).uid)


def _slot_payload(slot: Slot) -> dict[str, Any]:
    return {
        "item_id": slot.item_id,
        "title": slot.title,
        "start": slot.start.isoformat(),
        "end": slot.end.isoformat(),
        "minutes": slot.minutes,
    }


def execute_tool(owner_id: str, name: str, arguments: object) -> dict[str, Any]:
    try:
        parsed = mcp.parse_arguments(name, arguments)
    except ValueError as error:
        return mcp.tool_result(str(error), error=True)

    if isinstance(parsed, mcp.AvailabilityArgs):
        availability = _external_availability(owner_id, days=parsed.days + 1)
        windows = [
            *availability.pop("busy"),
            *sources.collect_local(store, owner_id, at=now()),
            *sources.collect_gmail(store, owner_id, at=now()),
        ]
        return mcp.tool_result(
            {
                **availability,
                "timezone": settings.timezone,
                "working_hours": current_hours(owner_id).as_setting(),
                "unavailable_sources": [
                    entry["source"]
                    for entry in availability["source_health"]
                    if entry["status"] == "unavailable"
                ],
                "busy": [
                    {"start": start.isoformat(), "end": end.isoformat()}
                    for start, end in sources.merge_intervals(windows)
                ],
            }
        )

    if isinstance(parsed, mcp.GmailArgs):
        gmail = google_gmail(owner_id)
        if not gmail.connected:
            return mcp.tool_result(GOOGLE_NOT_CONNECTED, error=True)
        summary = sync_gmail_once(owner_id) if parsed.refresh else SyncSummary()
        if summary.error:
            return mcp.tool_result(summary.error, error=True)
        with store.session() as session:
            commitments = [
                {
                    "title": sanitize_for_prompt(item.title),
                    "start": aware(item.start_at).isoformat() if aware(item.start_at) else None,
                    "end": aware(item.end_at).isoformat() if aware(item.end_at) else None,
                }
                for item in store.open_items(session, owner_id)
                if item.source == "gmail"
            ][:50]
        return mcp.tool_result({"sync": dataclasses.asdict(summary), "confirmations": commitments})

    if isinstance(parsed, mcp.PlanArgs):
        availability = _external_availability(owner_id, days=parsed.days + 1)
        slots = plan_tasks(
            owner_id, item_ids=parsed.item_ids, days=parsed.days, availability=availability
        )
        return mcp.tool_result(
            {
                "slots": [_slot_payload(slot) for slot in slots],
                "complete": availability["complete"],
                "unavailable_sources": [
                    entry["source"]
                    for entry in availability["source_health"]
                    if entry["status"] == "unavailable"
                ],
                "reason": (
                    "A connected calendar could not be checked, so no time can be promised."
                    if not availability["complete"]
                    else "No selected task fits the current availability and deadlines."
                    if not slots
                    else "Tasks are ranked by deadline, age, and duration, then fitted into "
                    "your availability around existing commitments."
                ),
            }
        )

    if isinstance(parsed, mcp.ApplyPlanArgs):
        slots = plan_tasks(owner_id, item_ids=parsed.item_ids, days=parsed.days)
        if not slots:
            return mcp.tool_result(
                "No selected task can be placed in the available hours.", error=True
            )
        applied = apply_slots(owner_id, slots, days=parsed.days)
        if not applied:
            return mcp.tool_result(
                "No task was scheduled. Availability or task state changed; refresh and retry.",
                error=True,
            )
        return mcp.tool_result(
            {
                "slots": [_slot_payload(slot) for slot in applied],
                "destination": "cooper",
                "complete": len(applied) == len(slots),
            }
        )

    return mcp.tool_result("Unknown tool.", error=True)


@app.post("/api/mcp")
def mcp_endpoint(body: dict[str, Any], request: Request) -> dict[str, Any]:
    request_id = body.get("id")
    if body.get("jsonrpc") != "2.0" or not isinstance(body.get("method"), str):
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32600, "message": "Invalid Request"},
        }
    method = body["method"]
    if method == "initialize":
        result = {
            "protocolVersion": "2025-11-25",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "cooper", "version": "1.0.0"},
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": mcp.TOOLS}
    elif method == "tools/call":
        params = body.get("params")
        if not isinstance(params, dict) or not isinstance(params.get("name"), str):
            result = mcp.tool_result("Invalid tool call.", error=True)
        else:
            result = execute_tool(
                request_owner(request).uid,
                params["name"],
                params.get("arguments", {}),
            )
    else:
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": "Method not found"},
        }
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


@app.post("/api/say")
def say(body: Say, request: Request) -> dict[str, Any]:
    """One logical assisted request; core work stays usable without providers."""
    owner_id = request_owner(request).uid
    if body.logical_request_id:
        try:
            body.logical_request_id = str(uuid.UUID(body.logical_request_id))
        except ValueError:
            raise HTTPException(422, "logical_request_id must be a UUID") from None
    if body.mode == "ai":
        existing = _existing_ai(owner_id, body)
        if existing:
            return _fresh_ai_response(owner_id, existing[1])
    intent = body.intent or (classify_ask_intent(body.text) if body.mode == "ai" else None)
    if body.mode != "ai" or intent is not None:
        return _say_response(body, owner_id, brain)
    # Deterministic command verbs use no provider allowance. Questions asking for
    # explanation still use the read-only answer branch when AI is available.
    rules = brain.read(body.text, [], use_model=False)
    if rules.verb in {"complete", "drop", "move", "pin", "schedule", "undo"}:
        return _say_response(body, owner_id, brain)
    if not settings.included_ai_enabled or not store.ai_schema_available:
        if body.logical_request_id or looks_like_a_question(body.text):
            return {
                "kind": "question",
                "source": "cooper",
                "message": (
                    "Included AI is unavailable. Basic planning questions and Form still work."
                ),
                "view": today_view(owner_id),
            }
        return _say_response(body, owner_id, brain)
    cost = _ai_cost("gemini", settings.ai_input_token_bound, settings.ai_output_token_bound)
    request_id, replay = _admit_ai(owner_id, body, cost)
    if replay:
        return _fresh_ai_response(owner_id, replay)
    execution = AssistedRequest(
        owner_id, request_id, time.monotonic() + settings.ai_deadline_seconds
    )
    request_brain = Brain(
        model=settings.gemini_model, timezone=settings.timezone, dispatch=execution.dispatch
    )
    try:
        # Parsing and read-only answers happen before a planning transaction.
        result = _say_response(body, owner_id, request_brain, request_id=request_id)
    except HTTPException:
        with store.session() as session:
            row = session.get(AiRequest, request_id)
            if row.allowance_state == "reserved":
                _finish_ai(
                    session,
                    request_id,
                    {
                        "kind": "question",
                        "source": "cooper",
                        "message": (
                            "Assistance stopped safely. Use Form or a basic planning question."
                        ),
                    },
                    useful=False,
                )
        raise
    except Exception:
        # Do not disguise application defects or release ambiguous costs. A
        # request marked applying stays pending until reviewed, never replays.
        with store.session() as session:
            row = session.get(AiRequest, request_id)
            if (
                row.state not in {"completed", "failed", "applying"}
                and row.allowance_state == "reserved"
            ):
                _finish_ai(
                    session,
                    request_id,
                    {
                        "kind": "question",
                        "source": "cooper",
                        "message": "Assistance could not complete. Please use Form.",
                    },
                    useful=False,
                )
        raise
    return _fresh_ai_response(owner_id, result)


def _fresh_ai_response(owner_id: str, result: dict[str, Any]) -> dict[str, Any]:
    payload = {**result, "view": today_view(owner_id)}
    if result.get("kind") == "pending":
        return JSONResponse(payload, status_code=202)
    return payload


def _say_response(
    body: Say, owner_id: str, request_brain: Brain, *, request_id: str | None = None
) -> dict[str, Any]:
    ai = body.mode == "ai"
    intent = body.intent or (classify_ask_intent(body.text) if ai else None)
    if intent is not None:
        view = today_view(owner_id, using_model=request_brain.using_model)
        return {
            "kind": "answered",
            "source": "cooper",
            "intent": intent,
            **answer_planning_intent(intent, body.text, view),
            "view": view,
        }
    with store.session() as session:
        open_items = store.open_items(session, owner_id)
        open_items = [item for item in open_items if _is_local_item(item, owner_id)]
        recent = [item.title for item in reversed(open_items)][:8]
        summaries = [_summarise(item) for item in open_items] if ai else []

    action = request_brain.read(body.text, recent, use_model=ai)

    # Questions are answered as text and never reach the mutation path.
    if ai and (
        action.verb == "show" or (action.verb == "ask" and looks_like_a_question(body.text))
    ):
        tool_answer, tool_steps = answer_with_tools(
            request_brain,
            owner_id,
            body.text,
            summaries,
        )
        if tool_answer:
            return _finish_ai_answer(
                request_id,
                {
                    "kind": "answered",
                    "message": tool_answer,
                    "source": "model",
                    "tools": tool_steps,
                    "view": today_view(owner_id, using_model=request_brain.using_model),
                },
            )
        answered = request_brain.answer(body.text, summaries, _busy_time_context(owner_id))
        if answered:
            return _finish_ai_answer(
                request_id,
                {
                    "kind": "answered",
                    "message": answered,
                    "source": "model",
                    "view": today_view(owner_id, using_model=request_brain.using_model),
                },
            )

    if request_id is not None:
        if action.is_question or action.verb == "show":
            result = run(owner_id, action)
            with store.session() as session:
                _finish_ai(session, request_id, result, useful=False)
            return result
        with store.session() as session:
            claim = session.execute(
                update(AiRequest)
                .where(
                    AiRequest.id == request_id,
                    AiRequest.owner_id == owner_id,
                    AiRequest.state.in_(("admitted", "running")),
                    AiRequest.allowance_state == "reserved",
                )
                .values(state="applying")
            )
            if claim.rowcount != 1:
                raise HTTPException(409, "This request cannot enter the writer again")
        with store.session() as session, store.join(session):
            claim = session.execute(
                update(AiRequest)
                .where(
                    AiRequest.id == request_id,
                    AiRequest.owner_id == owner_id,
                    AiRequest.state == "applying",
                    AiRequest.allowance_state == "reserved",
                )
                .values(updated_at=now())
            )
            if claim.rowcount != 1:
                raise HTTPException(409, "This request was abandoned before execution")
            row = session.get(AiRequest, request_id)
            _lock_ai_accounting(session, row)
            result = _run_with_receipt(owner_id, action)
            _finish_ai(session, request_id, result, useful=True)
        return result
    return _run_with_receipt(owner_id, action)


def _finish_ai_answer(request_id: str | None, result: dict[str, Any]) -> dict[str, Any]:
    if request_id is not None:
        with store.session() as session:
            _finish_ai(session, request_id, result, useful=True)
    return result


def _run_with_receipt(owner_id: str, action: Action) -> dict[str, Any]:
    result = run(owner_id, action)
    view = today_view(owner_id, using_model=action.source == "model")
    item_ids = result.pop("_item_ids", None)
    if result.get("kind") in {"added", "rescheduled", "scheduled"} and (
        item_ids or isinstance(result.get("item"), dict)
    ):
        result = _verified_write_response(
            result,
            view,
            operation={
                "added": "create",
                "rescheduled": "reschedule",
                "scheduled": "schedule",
            }[result["kind"]],
            item_ids=item_ids or [result["item"]["id"]],
        )
    return {**result, "source": action.source, "view": view}


def answer_planning_intent(
    intent: AskIntent, question: str, view: dict[str, Any]
) -> dict[str, Any]:
    """Render common planning answers from the canonical snapshot, never from model opinion."""
    planning = view["planning"]
    tasks = planning["tasks"]
    commitments = planning["commitments"]
    warnings = [
        entry.get("message") or f"{str(entry['source']).title()} calendar is unavailable."
        for entry in planning["source_health"]
        if entry["status"] != "ok"
    ]
    facts: list[str] = []

    if intent == "focus_week":
        if not tasks:
            message = "You have no open COOPER tasks to prioritize this week."
        else:
            task = tasks[0]
            reason = _recommendation_reason(task, view["timezone"])
            message = f"Your highest-priority open task is {task['title']}{reason}."
            if not planning["complete"]:
                message += (
                    " I can't confirm safe placement while a connected calendar is unavailable."
                )
            else:
                message += " This is a priority ranking, not a confirmed time slot."
            facts.append(f"{task['title']} · {reason.removeprefix(' because ')}")
    elif intent == "remaining_today":
        remaining = _commitments_on_day(
            commitments,
            view["today"],
            view["timezone"],
            after=dt.datetime.fromisoformat(view["now"]),
        )
        if not remaining:
            message = "You have no remaining calendar commitments today."
        else:
            facts = [_commitment_fact(entry, view["timezone"]) for entry in remaining]
            message = f"You still have {len(remaining)} today: " + "; ".join(facts) + "."
        pending = [task for task in tasks if task.get("start_at") is None]
        if pending:
            pending_facts = [
                f"Unscheduled · {task['title']} · "
                + (
                    f"{task['minutes']} minutes"
                    if task.get("minutes") is not None
                    else "effort unknown"
                )
                for task in pending
            ]
            message += " Unscheduled work (not all due today): " + "; ".join(pending_facts) + "."
            facts.extend(pending_facts)
    elif intent == "work_next":
        identity = planning["focus"]["now_id"] or planning["focus"]["next_id"]
        commitment = next((entry for entry in commitments if entry["id"] == identity), None)
        task = next((entry for entry in tasks if entry["id"] == identity), None)
        if commitment:
            fact = _commitment_fact(commitment, view["timezone"])
            label = "current" if commitment["id"] == planning["focus"]["now_id"] else "next"
            message = f"Your {label} commitment is {fact}."
            facts.append(fact)
        elif task:
            reason = _recommendation_reason(task, view["timezone"])
            message = f"Work on {task['title']} next{reason}."
            facts.append(f"{task['title']} · {reason.removeprefix(' because ')}")
        else:
            message = "Nothing is waiting in your COOPER plan right now."
    elif intent == "fit_duration":
        requested = _requested_minutes(question)
        free = planning["metrics"]["largest_free_block_minutes"]
        if not planning["complete"]:
            message = "I can’t confirm a free block while a connected calendar is unavailable."
        elif not _supports_today_fit(question):
            message = "Ask for one duration today, for example: Can I fit 30 minutes today?"
        elif requested is None:
            message = (
                f"Your largest remaining calendar gap today is {free} minutes. "
                "This is a gap metric, not a capacity verdict."
            )
            facts.append(f"Largest calendar gap · {free} minutes")
        elif not 1 <= requested <= 1440:
            message = "Use a duration from 1 to 1440 whole minutes today."
        else:
            slot = _fit_duration_slot(view, requested)
            if slot:
                zone = ZoneInfo(view["timezone"])
                start = slot.start.astimezone(zone).strftime("%-I:%M %p")
                end = slot.end.astimezone(zone).strftime("%-I:%M %p")
                message = (
                    f"Yes. An unsaved {requested}-minute candidate fits today at "
                    f"{start}–{end} ({view['timezone']}). It respects availability and "
                    "daily limits. This standalone check does not reserve time or "
                    "outrank unscheduled work."
                )
                facts.append(f"Unsaved candidate · {start}–{end}")
            else:
                message = (
                    f"No legal {requested}-minute slot remains today under your "
                    "availability, existing blocks, breaks, lead time, and daily limits."
                )
    elif intent == "deadline_summary":
        zone = ZoneInfo(view["timezone"])
        today = dt.date.fromisoformat(view["today"])
        deadlines = [
            task
            for task in tasks
            if task.get("due")
            and dt.datetime.fromisoformat(task["due"]).astimezone(zone).date()
            <= today + dt.timedelta(days=7)
        ]
        if not deadlines:
            message = "You have no open deadlines in the next seven days."
        else:
            facts = [
                f"{task['title']} · due "
                f"{dt.datetime.fromisoformat(task['due']).astimezone(zone).strftime('%a %d %b')}"
                for task in deadlines
            ]
            noun = "deadlines" if len(deadlines) != 1 else "deadline"
            message = f"You have {len(deadlines)} {noun}: " + "; ".join(facts) + "."
    else:
        target = (
            dt.date.fromisoformat(view["today"]) + dt.timedelta(days=1)
            if "tomorrow" in question.casefold()
            else dt.date.fromisoformat(view["today"])
        )
        day_commitments = _commitments_on_day(commitments, target.isoformat(), view["timezone"])
        conflicts = _conflict_count(day_commitments)
        occupied = _occupied_minutes(day_commitments, target, view["timezone"])
        label = "tomorrow" if target.isoformat() != view["today"] else "today"
        if not planning["complete"]:
            message = (
                f"I can’t confirm whether {label} is overloaded while a connected calendar "
                "is unavailable."
            )
        else:
            pending = [task for task in tasks if task.get("start_at") is None]
            estimated = sum(task.get("minutes") or 0 for task in pending)
            unknown = sum(task.get("minutes") is None for task in pending)
            message = (
                f"Calendar {label}: {len(day_commitments)} commitments occupy {occupied} minutes, "
                f"with {conflicts} overlapping pair{'s' if conflicts != 1 else ''}. "
                f"You also have {estimated} estimated minutes of unscheduled work and "
                f"{unknown} task{'s' if unknown != 1 else ''} with unknown effort. "
                "That work is not necessarily due on this day. "
                "Calendar occupancy alone cannot confirm workload fits your configured capacity."
            )
        facts.extend([f"Scheduled · {len(day_commitments)}", f"Occupied · {occupied} minutes"])

    return {"message": message, "facts": facts, "warnings": warnings}


def _verified_write_response(
    result: dict[str, Any],
    view: dict[str, Any],
    *,
    operation: Literal["create", "reschedule", "schedule"],
    item_ids: list[str],
) -> dict[str, Any]:
    receipt = _mutation_receipt(view, operation=operation, item_ids=item_ids)
    receipt["warnings"] = list(dict.fromkeys([*receipt["warnings"], *result.pop("_warnings", [])]))
    return {**result, "message": _receipt_message(receipt), "receipt": receipt}


def _mutation_receipt(
    view: dict[str, Any],
    *,
    operation: Literal["create", "reschedule", "schedule"],
    item_ids: list[str],
) -> dict[str, Any]:
    planning = view["planning"]
    tasks = {task["id"]: task for task in planning["tasks"]}
    commitments = {
        commitment["local_item_id"]: commitment
        for commitment in planning["commitments"]
        if commitment.get("local_item_id")
    }
    verified = []
    warnings = [
        health.get("message") or f"{str(health['source']).title()} calendar is unavailable."
        for health in planning["source_health"]
        if health["status"] != "ok"
    ]
    at = dt.datetime.fromisoformat(view["now"])
    for item_id in item_ids:
        task = tasks.get(item_id)
        commitment = commitments.get(item_id)
        if task is None and commitment is None:
            raise HTTPException(
                status_code=500,
                detail=(
                    "COOPER saved the change but could not verify its current state. "
                    "Refresh before trying again."
                ),
            )
        item = task or commitment.get("item") or commitment
        state = task.get("state") if task else _commitment_state(commitment, at)
        waiting_reason = task.get("waiting_reason") if task else None
        if waiting_reason:
            warnings.append(waiting_reason)
        verified.append(
            {
                "id": item_id,
                "title": item["title"],
                "state": state,
                "start_at": task.get("start_at") if task else commitment["start_at"],
                "end_at": task.get("end_at") if task else commitment["end_at"],
            }
        )
    return {
        "operation": operation,
        "items": verified,
        "warnings": list(dict.fromkeys(warnings)),
        "snapshot_generated_at": planning["generated_at"],
    }


def _commitment_state(commitment: dict[str, Any], at: dt.datetime) -> str:
    start = dt.datetime.fromisoformat(commitment["start_at"])
    end = dt.datetime.fromisoformat(commitment["end_at"])
    if start <= at < end:
        return "in_progress"
    if end <= at:
        return "missed_block"
    return "scheduled"


def _receipt_message(receipt: dict[str, Any]) -> str:
    items = receipt["items"]
    operation = receipt["operation"]
    if len(items) != 1:
        verb = {"create": "Added", "reschedule": "Moved", "schedule": "Scheduled"}[operation]
        noun = "tasks" if operation == "create" else "items"
        message = f"{verb} {len(items)} {noun} in COOPER."
    else:
        item = items[0]
        verb = {"create": "Added", "reschedule": "Moved", "schedule": "Scheduled"}[operation]
        message = f"{verb} “{item['title']}” in COOPER."
    if len(items) == 1 and item["start_at"] and item["end_at"]:
        zone = ZoneInfo(settings.timezone)
        start = dt.datetime.fromisoformat(item["start_at"]).astimezone(zone)
        end = dt.datetime.fromisoformat(item["end_at"]).astimezone(zone)
        preposition = "to" if operation == "reschedule" else "for"
        message = (
            f"{verb} “{item['title']}” in COOPER {preposition} "
            f"{start.strftime('%a %-I:%M %p')}–{end.strftime('%-I:%M %p')}."
        )
    warnings = " ".join(receipt["warnings"])
    return f"{message} {warnings}" if warnings else message


def _recommendation_reason(task: dict[str, Any], timezone: str) -> str:
    if task.get("pinned"):
        return " because you pinned it"
    if task.get("due"):
        due = dt.datetime.fromisoformat(task["due"]).astimezone(ZoneInfo(timezone))
        return f" because it is due {due.strftime('%a %d %b')}"
    if task.get("importance", 3) >= 4:
        return " because it is marked important"
    return ""


def _day_bounds(day: str, timezone: str) -> tuple[dt.datetime, dt.datetime]:
    zone = ZoneInfo(timezone)
    local_day = dt.date.fromisoformat(day)
    start = dt.datetime.combine(local_day, dt.time(), tzinfo=zone).astimezone(dt.UTC)
    end = dt.datetime.combine(local_day + dt.timedelta(days=1), dt.time(), tzinfo=zone).astimezone(
        dt.UTC
    )
    return start, end


def _commitments_on_day(
    commitments: list[dict[str, Any]],
    day: str,
    timezone: str,
    *,
    after: dt.datetime | None = None,
) -> list[dict[str, Any]]:
    start, end = _day_bounds(day, timezone)
    threshold = after.astimezone(dt.UTC) if after else start
    return [
        entry
        for entry in commitments
        if dt.datetime.fromisoformat(entry["start_at"]) < end
        and max(start, threshold) < dt.datetime.fromisoformat(entry["end_at"])
    ]


def _commitment_fact(commitment: dict[str, Any], timezone: str) -> str:
    if commitment.get("all_day"):
        return f"{commitment['title']} all day"
    starts = dt.datetime.fromisoformat(commitment["start_at"]).astimezone(ZoneInfo(timezone))
    return f"{commitment['title']} at {starts.strftime('%-I:%M %p')}"


def _supports_today_fit(question: str) -> bool:
    text = question.casefold().replace("’", "'").replace("-", " ").strip().rstrip("?.!")
    amount = r"(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)"
    unit = r"(?:hours?|hrs?|minutes?|mins?)"
    duration = (
        rf"(?:a |an )?{amount}\s*{unit}(?: (?:focus |work |study )?(?:block|session|task))? today"
    )
    return bool(
        re.fullmatch(
            rf"(?:can|could) i fit {duration}|do i have enough time for {duration}"
            r"|(?:what is|what's) my largest free block today",
            text,
        )
    )


def _fit_duration_slot(view: dict[str, Any], minutes: int) -> Slot | None:
    """Probe one unsaved session against the sampled snapshot, without reads or writes."""
    planning = view["planning"]
    at = dt.datetime.fromisoformat(planning["generated_at"])
    _, end = _day_bounds(view["today"], view["timezone"])
    scheduled = [
        Item(
            id=entry["id"],
            kind="task",
            status="open",
            source="me",
            start_at=_parse(entry["start_at"]),
            end_at=_parse(entry["end_at"]),
        )
        for entry in planning["tasks"]
        if entry.get("source", "me") == "me" and entry.get("start_at") and entry.get("end_at")
    ]
    busy = [
        (_parse(entry["start_at"]), _parse(entry["end_at"])) for entry in planning["commitments"]
    ]
    candidate = Item(
        id="fit-probe",
        kind="task",
        status="open",
        source="me",
        title="Unsaved session",
        minutes=minutes,
        importance=3,
        pinned=0,
        created_at=at,
        due=end,
    )
    slots = place(
        rank([candidate], at=at),
        busy=busy,
        hours=Hours.from_setting(view["hours"]),
        at=at,
        days=1,
        until=end,
        scheduled=scheduled,
    )
    return slots[0] if slots else None


def _requested_minutes(question: str) -> int | None:
    lowered = question.casefold().replace("-", " ")
    words = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
        "six": 6,
        "seven": 7,
        "eight": 8,
    }
    match = re.search(
        r"\b(?P<amount>\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight)\s*"
        r"(?P<unit>hours?|hrs?|minutes?|mins?)\b",
        lowered,
    )
    if not match:
        return None
    raw = match.group("amount")
    amount = float(words.get(raw, raw))
    minutes = amount * 60 if match.group("unit").startswith("h") else amount
    return int(minutes) if minutes.is_integer() else 0


def _conflict_count(commitments: list[dict[str, Any]]) -> int:
    count = 0
    for index, first in enumerate(commitments):
        first_start = dt.datetime.fromisoformat(first["start_at"])
        first_end = dt.datetime.fromisoformat(first["end_at"])
        for second in commitments[index + 1 :]:
            if (
                first_start < dt.datetime.fromisoformat(second["end_at"])
                and dt.datetime.fromisoformat(second["start_at"]) < first_end
            ):
                count += 1
    return count


def _occupied_minutes(commitments: list[dict[str, Any]], day: dt.date, timezone: str) -> int:
    start, end = _day_bounds(day.isoformat(), timezone)
    spans = sources.merge_intervals(
        [
            (
                max(start, dt.datetime.fromisoformat(entry["start_at"])),
                min(end, dt.datetime.fromisoformat(entry["end_at"])),
            )
            for entry in commitments
        ]
    )
    return round(
        sum((span_end - span_start).total_seconds() / 60 for span_start, span_end in spans)
    )


def answer_with_tools(
    request_brain: Brain,
    owner_id: str,
    question: str,
    summaries: list[str],
) -> tuple[str | None, list[dict[str, Any]]]:
    declarations = [
        {
            "name": tool["name"],
            "description": tool["description"],
            "parameters": tool["inputSchema"],
        }
        for tool in mcp.TOOLS
        if tool["name"] not in ("apply_plan", "gmail_confirmations")
    ]
    prompt = (
        f"{COOPER_IDENTITY}\n\n"
        "Answer only about the person's tasks and calendar. Use a tool when current availability, "
        "or a proposed work plan is needed. Never claim a write occurred. "
        "Calendar tool output intentionally contains no event titles. Be concise and explain why "
        "suggested times fit.\n\n"
        f"Timezone: {settings.timezone}\n"
        f"Own open items:\n{chr(10).join(summaries[:24]) or '(none)'}\n\n"
        f"Question: {sanitize_for_prompt(question)}"
    )
    contents: list[dict[str, Any]] = [{"role": "user", "parts": [{"text": prompt}]}]
    steps: list[dict[str, Any]] = []
    for _ in range(4):
        turn = request_brain.tool_turn(contents, declarations)
        if turn is None:
            return None, steps
        contents.append(turn.content)
        if turn.text and not turn.calls:
            return turn.text, steps
        if not turn.calls:
            return None, steps
        response_parts: list[dict[str, Any]] = []
        for call in turn.calls[:3]:
            result = (
                execute_tool(owner_id, call.name, call.arguments)
                if call.name in {tool["name"] for tool in declarations}
                else mcp.tool_result("This question cannot change data.", error=True)
            )
            failed = bool(result.get("isError"))
            payload = result.get("structuredContent")
            if payload is None:
                content = result.get("content")
                payload = content[0].get("text") if isinstance(content, list) and content else ""
            steps.append({"name": call.name, "ok": not failed})
            response_parts.append(
                {
                    "functionResponse": {
                        "name": call.name,
                        "response": {"output": payload, "ok": not failed},
                    }
                }
            )
        contents.append({"role": "user", "parts": response_parts})
    return None, steps


def _summarise(item: Item) -> str:
    """One line per item for the answer prompt.

    Deliberately only the facts needed to reason about time and order. No notes, no event
    description, no location, no attendees — rule five of the PRD.

    A title is whatever the user typed to create the item, so it goes through the same guard as
    anything else reaching a prompt as data: `sanitize_for_prompt` flattens the punctuation and
    line breaks an injected instruction would need, before this line is ever built.
    """
    zone = ZoneInfo(settings.timezone)
    bits = [sanitize_for_prompt(item.title), item.category]
    if item.minutes:
        bits.append(f"{item.minutes} min")
    if item.importance != 3:
        bits.append(f"importance {item.importance}")
    if item.due:
        bits.append(f"due {item.due.astimezone(zone).date().isoformat()}")
    if item.start_at:
        bits.append(f"at {item.start_at.astimezone(zone).strftime('%a %d %b %H:%M')}")
    return " · ".join(bits)


def _busy_time_context(owner_id: str) -> list[str]:
    """Give Ask only calendar occupancy, never the contents of external events."""
    availability = _external_availability(owner_id)
    if not availability["complete"]:
        return ["Calendar availability is unavailable. Do not claim any time is free."]
    windows = sources.merge_intervals(
        [
            *availability["busy"],
            *sources.collect_local(store, owner_id, at=now()),
            *sources.collect_gmail(store, owner_id, at=now()),
        ]
    )
    return [f"{start.isoformat()}–{end.isoformat()}" for start, end in windows]


def run(owner_id: str, action: Action) -> dict[str, Any]:
    if action.is_question:
        return {"kind": "question", "message": action.question or "Could you rephrase that?"}

    if action.verb == "show":
        return {"kind": "shown", "message": "Here is what is next."}

    if action.verb == "undo":
        return undo_last(owner_id)

    if action.verb == "schedule":
        placed = schedule_now(owner_id)
        if not placed:
            return {
                "kind": "note",
                "message": "No tasks were placed. Check the waiting tasks for the reason.",
            }
        return {
            "kind": "scheduled",
            "message": f"Placed {len(placed)} into your hours.",
            "chip": [f"{slot.title} · {slot.start.strftime('%a %H:%M')}" for slot in placed],
            "_item_ids": [slot.item_id for slot in placed],
        }

    if action.verb == "add":
        return add(owner_id, action)

    if action.verb == "batch":
        return add_batch(owner_id, action)

    if action.verb == "move":
        return reschedule(owner_id, action)

    return change_existing(owner_id, action)


def add(owner_id: str, action: Action) -> dict[str, Any]:
    with store.session() as session:
        item = Item(
            id=new_id(),
            owner_id=owner_id,
            source="me",
            kind=action.kind,
            title=action.title or "Untitled",
            notes=item_details(
                notes=action.notes, location=action.location, meeting_url=action.meeting_url
            ),
            minutes=action.minutes,
            importance=action.importance or 3,
            category=action.category or "personal",
            due=_as_due(action.due),
            start_at=action.start,
            end_at=action.end,
            created_at=now(),
        )
        session.add(item)
        session.flush()
        store.record(
            session,
            owner_id,
            label=f"Added “{item.title}”",
            item=item,
            before=None,
        )
        payload = item.to_dict()

    # Sized tasks are placed immediately when they have no fixed start.
    if action.kind == "task" and not action.start:
        booked = place_one(owner_id, payload["id"])
        if booked is not None and booked.get("start_at"):
            payload = booked
            when = to_local(booked["start_at"])
            return {
                "kind": "added",
                "message": f"Added “{payload['title']}”, {when}.",
                "item": payload,
            }
        payload = booked or payload
        return {
            "kind": "added",
            "message": (
                f"Saved “{payload['title']}”. "
                f"{payload.get('waiting_reason', 'Waiting for scheduling.')}"
            ),
            "item": payload,
        }

    if payload["start_at"]:
        warnings = _fixed_event_warnings(owner_id, payload)
        return {
            "kind": "added",
            "message": f"Added “{payload['title']}”, {to_local(payload['start_at'])}.",
            "item": payload,
            "_warnings": warnings,
        }

    return {"kind": "added", "message": f"Added “{payload['title']}”.", "item": payload}


def _fixed_event_warnings(owner_id: str, payload: dict[str, Any]) -> list[str]:
    """Report overlaps without moving a fixed appointment or losing it to a source outage."""
    start = dt.datetime.fromisoformat(payload["start_at"])
    end = dt.datetime.fromisoformat(payload["end_at"])
    availability = _external_availability(owner_id)
    with store.session() as session:
        local = [
            (entry.start_at, entry.end_at)
            for entry in store.open_items(session, owner_id)
            if entry.id != payload["id"] and entry.start_at and entry.end_at
        ]
    notices = []
    if any(
        booked_start < end and start < booked_end
        for booked_start, booked_end in [*availability["busy"], *local]
    ):
        notices.append("This overlaps another calendar commitment.")
    if not availability["complete"]:
        notices.append("Connected calendar conflicts could not be checked.")
    elif availability["source_health"] and end > dt.datetime.fromisoformat(
        availability["range_end"]
    ):
        notices.append(
            "Connected calendar conflicts beyond the checked range could not be checked."
        )
    return notices


def _external_availability(owner_id: str, *, days: int = 14) -> dict[str, Any]:
    checked = now()
    spans = []
    health = []
    for name, provider in (
        ("google", connected_calendar(owner_id)),
        ("icloud", icloud_calendar(owner_id)),
    ):
        if provider is None or not provider.connected:
            continue
        try:
            spans.extend(sources.collect_google(provider, days=days))
            health.append({"source": name, "status": "ok"})
        except CalendarError:
            health.append(
                {
                    "source": name,
                    "status": "unavailable",
                    "message": f"{name.title()} calendar could not be checked.",
                }
            )
    return {
        "busy": spans,
        "source_health": health,
        "checked_at": checked.isoformat(),
        "range_start": checked.isoformat(),
        "range_end": (checked + dt.timedelta(days=days)).isoformat(),
        "complete": all(entry["status"] == "ok" for entry in health),
    }


def _locked_hours(session: Any, owner_id: str) -> Hours:
    # Updating the existing settings anchor obtains a write lock on SQLite and a row
    # lock on Postgres, before any local availability is read. No network runs here.
    session.execute(
        update(Setting)
        .where(Setting.owner_id == owner_id, Setting.key == HOURS_SETTING)
        .values(value=Setting.value)
    )
    saved = session.get(Setting, {"owner_id": owner_id, "key": HOURS_SETTING})
    return Hours.from_setting({**(saved.value if saved else {}), "timezone": settings.timezone})


def _ensure_hours(owner_id: str) -> None:
    if store.get_setting(owner_id, HOURS_SETTING) is None:
        from sqlalchemy.exc import IntegrityError

        try:
            with store.session() as session:
                session.add(
                    Setting(
                        owner_id=owner_id,
                        key=HOURS_SETTING,
                        value=current_hours(owner_id).as_setting(),
                    )
                )
        except IntegrityError:
            pass  # Another first request established this owner's anchor.


def _waiting_reason(payload: dict[str, Any], availability: dict[str, Any]) -> str:
    if not payload.get("minutes"):
        return "Add a duration to schedule this task."
    if not availability["complete"]:
        names = ", ".join(
            entry["source"].title()
            for entry in availability["source_health"]
            if entry["status"] == "unavailable"
        )
        return f"Waiting for {names} calendar availability."
    return "No suitable slot within your availability and deadline."


def place_one(
    owner_id: str,
    item_id: str,
    *,
    earliest: dt.datetime | None = None,
    availability: dict[str, Any] | None = None,
    record_undo: bool = False,
) -> dict[str, Any] | None:
    at = max(now(), earliest) if earliest is not None else now()
    availability = availability if availability is not None else _external_availability(owner_id)
    _ensure_hours(owner_id)
    with store.session() as session:
        hours = _locked_hours(session, owner_id)
        item = store.get_item(session, owner_id, item_id)
        if item is None or not _is_local_item(item, owner_id) or item.status != "open":
            return None
        if item.start_at is not None:
            return item.to_dict()
        items = store.open_items(session, owner_id)
        busy = [
            *availability["busy"],
            *((entry.start_at, entry.end_at) for entry in items if entry.start_at and entry.end_at),
        ]
        slots = (
            place(
                rank([item], at=at),
                busy=busy,
                hours=hours,
                at=at,
                days=7,
                scheduled=[entry for entry in items if _is_local_item(entry, owner_id)],
            )
            if availability["complete"]
            else []
        )
        if slots:
            if record_undo:
                store.record(
                    session,
                    owner_id,
                    label=f"Scheduled “{item.title}”",
                    item=item,
                    before=item.to_dict(),
                )
            item.start_at, item.end_at = slots[0].start, slots[0].end
        session.flush()
        payload = item.to_dict()
        if not slots:
            payload["waiting_reason"] = _waiting_reason(payload, availability)
        return payload


def to_local(iso: str) -> str:
    """ "Sun 10:00", in your timezone, from the ISO string an item carries."""
    moment = dt.datetime.fromisoformat(iso).astimezone(ZoneInfo(settings.timezone))
    return moment.strftime("%a %H:%M")


def add_batch(owner_id: str, action: Action) -> dict[str, Any]:
    """Several related tasks from one sentence, created and booked in the order given.

    Mirrors `bulk()`: several items change, but it is recorded as one `Change`, so a single undo
    removes the whole batch rather than leaving three of four steps behind. There is no second
    write path — each step is created through the same `Item` construction `add()` uses, and
    booked through the same `place_one` a lone task goes through.

    Sequencing is time, not a stored relationship. The PRD rules out "dependencies between
    tasks" as a project-management feature this app must never become, so "before X then Y" is
    expressed by flooring Y's earliest start at X's booked end, the same way working hours floor
    every task's earliest start at the moment you asked. Nothing new is stored to make that true.
    """
    steps = action.steps or ()
    created: list[dict[str, Any]] = []
    floor: dt.datetime | None = None

    with store.session() as session:
        for step in steps:
            item = Item(
                id=new_id(),
                owner_id=owner_id,
                source="me",
                kind="task",
                title=step.title or "Untitled",
                minutes=step.minutes,
                importance=step.importance or 3,
                category=step.category or "personal",
                due=_as_due(step.due),
                created_at=now(),
            )
            session.add(item)
            created.append(item.id)
        session.flush()
        # One change row lets undo remove the whole batch.
        store.record(
            session,
            owner_id,
            label=f"Added {len(created)} tasks",
            item=None,
            before={"batch": created},
        )
        payloads = {}
        for item_id in created:
            item = store.get_item(session, owner_id, item_id)
            if item is not None:
                payloads[item_id] = item.to_dict()

    booked: list[dict[str, Any]] = []
    availability = _external_availability(owner_id)
    blocked = False
    for item_id in created:
        result = (
            None
            if blocked
            else place_one(owner_id, item_id, earliest=floor, availability=availability)
        )
        payload = result if result is not None else payloads[item_id]
        if blocked:
            payload["waiting_reason"] = "Waiting for the earlier batch step to be scheduled."
        blocked = blocked or not payload["start_at"]
        booked.append(payload)
        if payload["start_at"]:
            # Sequence the next step after the slot just placed.
            floor = dt.datetime.fromisoformat(payload["end_at"])

    unplaced = sum(1 for payload in booked if not payload["start_at"])
    first = booked[0]
    message = f"Added {len(booked)} tasks, starting with “{first['title']}”"
    message += f", {to_local(first['start_at'])}." if first["start_at"] else "."
    if unplaced:
        message += f" {unplaced} saved and waiting for scheduling."

    return {
        "kind": "added",
        "message": message,
        "item": first,
        "_item_ids": created,
        "chip": [
            f"{payload['title']} · {to_local(payload['start_at'])}"
            if payload["start_at"]
            else f"{payload['title']} · {payload.get('waiting_reason', 'waiting')}"
            for payload in booked
        ],
    }


def change_existing(owner_id: str, action: Action, *, item_id: str | None = None) -> dict[str, Any]:
    with store.session() as session:
        item = (
            store.get_item(session, owner_id, item_id)
            if item_id is not None
            else find(
                session,
                owner_id,
                action.which or "",
                include_external=action.verb == "move",
            )
        )
        if item is None or item.status != "open":
            return {
                "kind": "question",
                "message": f"I could not find “{action.which}”. Which one did you mean?",
            }
        _require_local_item(item, owner_id)

        before = item.to_dict()
        # Each verb gets its own kind rather than a shared "changed", because the interface
        # colours them differently: finishing something is green, dropping it is red.
        if action.verb == "complete":
            item.status = "done"
            item.done_at = now()
            label = f"Completed “{item.title}”"
            kind = "completed"
        elif action.verb == "drop":
            item.status = "dropped"
            label = f"Dropped “{item.title}”"
            kind = "dropped"
        elif action.verb == "move":
            if action.start is None or action.end is None or action.minutes is None:
                raise HTTPException(
                    status_code=422, detail="A move needs an exact time and duration."
                )
            if item.kind == "task":
                availability = _external_availability(owner_id)
                if not availability["complete"]:
                    return {
                        "kind": "question",
                        "message": _waiting_reason(before, availability),
                    }
                _ensure_hours(owner_id)
                hours = _locked_hours(session, owner_id)
                others = store.open_items(session, owner_id)
                busy = [
                    *availability["busy"],
                    *(
                        (entry.start_at, entry.end_at)
                        for entry in others
                        if entry.id != item.id and entry.start_at and entry.end_at
                    ),
                ]
                if not accepts_interval(
                    start=action.start,
                    end=action.end,
                    busy=busy,
                    hours=hours,
                    at=now(),
                    deadline=aware(item.due),
                    scheduled=others,
                    skip_item_id=item.id,
                ):
                    return {
                        "kind": "question",
                        "message": (
                            "That time is outside your working hours or already taken."
                            if availability["complete"]
                            else _waiting_reason(
                                {**before, "minutes": action.minutes},
                                availability,
                            )
                        ),
                    }
            item.start_at = action.start
            item.end_at = action.end
            item.minutes = action.minutes
            label = f"Moved “{item.title}”"
            kind = "rescheduled"
        else:
            item.pinned = 0 if item.pinned else 1
            label = f"{'Pinned' if item.pinned else 'Unpinned'} “{item.title}”"
            kind = "pinned"

        store.record(session, owner_id, label=label, item=item, before=before)
        payload = item.to_dict()
        extra: dict[str, Any] = {}
        if action.verb == "move" and item.kind == "event":
            extra["_warnings"] = _fixed_event_warnings(owner_id, payload)

    return {"kind": kind, "message": label + ".", "item": payload, **extra}


def reschedule(owner_id: str, action: Action, *, item_id: str | None = None) -> dict[str, Any]:
    """Resolve one visible target, then use the single existing-item writer to move it."""
    words = item_id or action.which or ""
    if item_id is not None:
        with store.session() as session:
            item = store.get_item(session, owner_id, item_id)
        if item is None:
            _require_provider_identifier_read_only(owner_id, item_id)
        resolved_id = item.id if item is not None else item_id
    else:
        resolved_id = _resolve_visible_move_target(owner_id, words)
        if resolved_id is None:
            return {
                "kind": "question",
                "message": f"I could not find “{action.which}”. Which one did you mean?",
            }
    return change_existing(owner_id, action, item_id=resolved_id)


def _resolve_visible_move_target(owner_id: str, words: str) -> str | None:
    """Resolve Ask text across local rows and provider-only visible commitments together."""
    needle = words.strip().casefold()
    if not needle:
        return None

    with store.session() as session:
        candidates = [
            {
                "item_id": item.id,
                "title": item.title,
                "identifiers": {item.id.casefold()},
                "provider_only": False,
            }
            for item in store.open_items(session, owner_id)
        ]
    commitments = today_view(owner_id)["planning"]["commitments"]
    candidates.extend(
        {
            "item_id": None,
            "title": str(entry["title"]),
            "identifiers": {
                str(identifier).casefold()
                for identifier in [entry["id"], entry.get("source_id"), *entry["aliases"]]
                if identifier
            },
            "provider_only": True,
        }
        for entry in commitments
        if not entry["editable"] and entry.get("local_item_id") is None
    )

    exact = [
        candidate
        for candidate in candidates
        if needle == candidate["title"].casefold() or needle in candidate["identifiers"]
    ]
    contained = [candidate for candidate in candidates if needle in candidate["title"].casefold()]
    words_in_needle = [word for word in needle.split() if len(word) > 3]
    loose = [
        candidate
        for candidate in candidates
        if words_in_needle
        and all(word in candidate["title"].casefold() for word in words_in_needle)
    ]
    matches = exact or contained or loose
    if len(matches) > 1:
        raise HTTPException(
            status_code=409,
            detail=f"“{words}” matches {len(matches)} items: "
            + ", ".join(candidate["title"] for candidate in matches[:4]),
        )
    if not matches:
        return None
    match = matches[0]
    if match["provider_only"]:
        _raise_provider_read_only()
    return str(match["item_id"])


def _require_provider_identifier_read_only(owner_id: str, identifier: str) -> None:
    """Recognize a provider-only direct target only by its opaque identifiers."""
    needle = identifier.strip().casefold()
    if not needle:
        return
    commitments = today_view(owner_id)["planning"]["commitments"]
    for entry in commitments:
        if entry["editable"]:
            continue
        identifiers = {
            str(value).casefold()
            for value in [entry["id"], entry.get("source_id"), *entry["aliases"]]
            if value
        }
        if needle in identifiers:
            _raise_provider_read_only()


def _raise_provider_read_only() -> None:
    raise HTTPException(
        status_code=409,
        detail=(
            "External calendar items are read-only in COOPER. "
            "Change this event in its source calendar instead."
        ),
    )


def schedule_now(owner_id: str) -> list[Slot]:
    return apply_slots(owner_id, None)


def plan_tasks(
    owner_id: str,
    *,
    item_ids: list[str] | None = None,
    days: int = 7,
    availability: dict[str, Any] | None = None,
) -> list[Slot]:
    availability = (
        availability
        if availability is not None
        else _external_availability(owner_id, days=days + 1)
    )
    if not availability["complete"]:
        return []
    with store.session() as session:
        return _plan_in_session(
            session, owner_id, current_hours(owner_id), availability, item_ids, days
        )


def _plan_in_session(
    session: Any,
    owner_id: str,
    hours: Hours,
    availability: dict[str, Any],
    item_ids: list[str] | None,
    days: int,
) -> list[Slot]:
    at = now()
    items = store.open_items(session, owner_id)
    return project_open_tasks(
        items=items,
        remote_busy=availability["busy"],
        hours=hours,
        at=at,
        days=days,
        item_ids=item_ids,
    )


def apply_slots(owner_id: str, slots: list[Slot] | None, *, days: int = 7) -> list[Slot]:
    if slots == []:
        return []
    availability = _external_availability(owner_id, days=days + 1)
    if not availability["complete"]:
        return []
    _ensure_hours(owner_id)
    with store.session() as session:
        hours = _locked_hours(session, owner_id)
        applied = _plan_in_session(
            session,
            owner_id,
            hours,
            availability,
            [slot.item_id for slot in slots] if slots is not None else None,
            days,
        )
        for slot in applied:
            item = store.get_item(session, owner_id, slot.item_id)
            item.start_at, item.end_at = slot.start, slot.end
        if applied:
            store.record(
                session,
                owner_id,
                label=f"Scheduled {len(applied)} tasks",
                item=None,
                before={"scheduled": [slot.item_id for slot in applied]},
            )
        return applied


# Recovery: re-place missed local blocks. Preview is read-only; apply rereads every input
# under the hours lock and refuses if the result differs from what the person reviewed.
RECOVERY_DAYS = 7
RECOVERY_STALE = "Your plan changed since this preview. Review the updated preview."
RECOVERY_UNCHECKED = "A connected calendar couldn’t be checked, so Cooper won’t move anything."


def _iso(value: dt.datetime | None) -> str | None:
    return aware(value).isoformat() if value else None


def _recovery_fingerprint(
    items: list[Item],
    hours: Hours,
    busy: list[tuple[dt.datetime, dt.datetime]],
    plan: RecoveryPlan,
) -> str:
    """Hash every input that can change the plan, plus the plan itself."""
    payload = {
        "items": sorted(
            [
                item.id,
                _iso(item.start_at),
                _iso(item.end_at),
                item.minutes,
                item.status,
                int(item.pinned or 0),
                _iso(item.due),
            ]
            for item in items
            if (item.source or "me") == "me"
        ),
        "hours": dataclasses.asdict(hours),
        "busy": sorted([_iso(start), _iso(end)] for start, end in busy),
        "moves": [[move.item_id, _iso(move.start), _iso(move.end)] for move in plan.moves],
        "kept": plan.kept,
        "unplaced": plan.unplaced,
    }
    encoded = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(encoded).hexdigest()


def _recovery_in_session(
    session: Any, owner_id: str, hours: Hours, availability: dict[str, Any]
) -> tuple[list[Item], RecoveryPlan, str]:
    items = store.open_items(session, owner_id)
    busy = list(availability["busy"]) if availability["complete"] else []
    plan = (
        preview_recovery(items=items, remote_busy=busy, hours=hours, at=now(), days=RECOVERY_DAYS)
        if availability["complete"]
        else RecoveryPlan(moves=[], kept=[], unplaced=[])
    )
    return items, plan, _recovery_fingerprint(items, hours, busy, plan)


def recovery_preview(owner_id: str) -> dict[str, Any]:
    availability = _external_availability(owner_id, days=RECOVERY_DAYS + 1)
    _ensure_hours(owner_id)
    with store.session() as session:
        items, plan, fingerprint = _recovery_in_session(
            session, owner_id, current_hours(owner_id), availability
        )
        titles = {item.id: item.title for item in items}
        return {
            "fingerprint": fingerprint,
            "complete": bool(availability["complete"]),
            "moves": [
                {
                    "item_id": move.item_id,
                    "title": move.title,
                    "old_start": move.old_start.isoformat(),
                    "old_end": move.old_end.isoformat(),
                    "start": move.start.isoformat(),
                    "end": move.end.isoformat(),
                }
                for move in plan.moves
            ],
            "kept": [
                {"item_id": item_id, "title": titles.get(item_id, ""), "reason": reason}
                for item_id, reason in plan.kept
            ],
            "unplaced": [
                {"item_id": item_id, "title": titles.get(item_id, ""), "reason": reason}
                for item_id, reason in plan.unplaced
            ],
        }


def apply_recovery(owner_id: str, fingerprint: str) -> dict[str, Any]:
    availability = _external_availability(owner_id, days=RECOVERY_DAYS + 1)
    if not availability["complete"]:
        raise HTTPException(status_code=409, detail=RECOVERY_UNCHECKED)
    _ensure_hours(owner_id)
    with store.session() as session:
        hours = _locked_hours(session, owner_id)  # serialize writers before rereading
        _items, plan, current = _recovery_in_session(session, owner_id, hours, availability)
        if not hmac.compare_digest(current, fingerprint):
            raise HTTPException(status_code=409, detail=RECOVERY_STALE)
        if not plan.moves:
            raise HTTPException(status_code=422, detail="Nothing to recover.")
        before: list[dict[str, Any]] = []
        after: list[dict[str, Any]] = []
        for move in plan.moves:
            item = store.get_item(session, owner_id, move.item_id)
            before.append(
                {"id": item.id, "start_at": _iso(move.old_start), "end_at": _iso(move.old_end)}
            )
            item.start_at, item.end_at = move.start, move.end
            after.append({"id": item.id, "start_at": _iso(move.start), "end_at": _iso(move.end)})
        count = len(plan.moves)
        label = f"Recovered {count} missed block{'' if count == 1 else 's'}"
        store.record(
            session,
            owner_id,
            label=label,
            item=None,
            before={"recovery": {"before": before, "after": after}},
        )
    return {
        "kind": "rescheduled",
        "message": f"{label}.",
        "item_ids": [move.item_id for move in plan.moves],
    }


def undo_last(owner_id: str) -> dict[str, Any]:
    with store.session() as session:
        change = store.last_change(session, owner_id)
        if change is None:
            return {"kind": "note", "message": "Nothing to undo."}

        before = change.before or {}
        if change.item_id and not before:
            # The change created the item, so undoing means removing it.
            item = store.get_item(session, owner_id, change.item_id)
            if item is not None:
                session.delete(item)
        elif change.item_id:
            item = store.get_item(session, owner_id, change.item_id)
            if item is not None:
                _restore(item, before)
        elif "scheduled" in before:
            for item_id in before["scheduled"]:
                item = store.get_item(session, owner_id, item_id)
                if item is None:
                    continue
                item.start_at = None
                item.end_at = None
        elif "bulk" in before:
            # A bulk complete or drop, restored item by item to exactly what each was before.
            for snapshot in before["bulk"]:
                item_id = snapshot.get("id")
                if not isinstance(item_id, str):
                    continue
                item = store.get_item(session, owner_id, item_id)
                if item is not None:
                    _restore(item, snapshot)
        elif "batch" in before:
            # A batch create: every step was a new item, so undo removes all of them, the same
            # as undoing a single add removes the one item it created.
            for item_id in before["batch"]:
                item = store.get_item(session, owner_id, item_id)
                if item is None:
                    continue
                session.delete(item)
        elif "recovery" in before:
            # All-or-nothing: restore old slots only if every item still holds exactly the
            # slot recovery wrote. Otherwise change nothing and name what moved.
            recovery = before["recovery"]
            after_rows = recovery.get("after", [])
            current = {
                row["id"]: store.get_item(session, owner_id, row["id"]) for row in after_rows
            }
            diverged = [
                item.title if item is not None else row["id"]
                for row in after_rows
                if (item := current[row["id"]]) is None
                or item.status != "open"
                or _iso(item.start_at) != row["start_at"]
                or _iso(item.end_at) != row["end_at"]
            ]
            if diverged:
                return {
                    "kind": "note",
                    "message": f"Can’t undo recovery: {', '.join(diverged)} changed since. "
                    "Nothing was changed.",
                }
            for row in recovery.get("before", []):
                item = current.get(row["id"])
                if item is not None:
                    item.start_at = _parse(row["start_at"])
                    item.end_at = _parse(row["end_at"])

        change.undone = 1
        label = change.label

    return {"kind": "undone", "message": f"Undid: {label}."}


def _restore(item: Item, before: dict[str, Any]) -> None:
    item.title = before.get("title", item.title)
    item.minutes = before.get("minutes")
    item.importance = before.get("importance", 3)
    item.status = before.get("status", "open")
    item.pinned = 1 if before.get("pinned") else 0
    item.done_at = None
    item.start_at = _parse(before.get("start_at"))
    item.end_at = _parse(before.get("end_at"))


def _parse(value: Any) -> dt.datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return dt.datetime.fromisoformat(value)
    except ValueError:
        return None


def _as_due(day: dt.date | None) -> dt.datetime | None:
    """A due date means end of that day, in your timezone."""
    if day is None:
        return None
    zone = ZoneInfo(settings.timezone)
    return dt.datetime.combine(day, dt.time(23, 59), tzinfo=zone)


def _local(moment: dt.datetime | None) -> dt.datetime | None:
    """Tag a naive datetime as the configured zone; leave an aware one as it was sent.

    The form's date and time inputs are wall-clock in the user's own zone. Pydantic parses them
    to a naive datetime, and storing that as-is means UTC — a 3pm event lands at 3pm UTC, in the
    evening. This mirrors what brain._datetime does for the sentence path, so both entry points
    agree.
    """
    if moment is None:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=ZoneInfo(settings.timezone))


@app.post("/api/items")
def create(body: NewItem, request: Request) -> dict[str, Any]:
    """Manual mode's form: fields in, item out, no parsing and no model.

    It builds an Action by hand and hands it to the same `add` the sentence path uses, so a
    typed task is booked in Cooper exactly like a parsed one and goes through the same undo hook.
    There is deliberately no second write path.
    """
    owner_id = request_owner(request).uid
    action = Action(
        verb="add",
        title=body.title.strip(),
        kind="event" if body.start else body.kind,
        minutes=body.minutes,
        importance=body.importance,
        # Match sentence capture: an omitted category is inferred from the title.
        category=body.category or guess_category(body.title),
        due=body.due,
        # Form times are wall-clock values in the configured zone unless an offset is supplied.
        start=_local(body.start),
        end=_local(body.end),
        notes=body.notes,
        location=body.location.strip() if body.location else None,
        meeting_url=str(body.meeting_url) if body.meeting_url else None,
        source="form",
    )
    # Reject past dates here even when a client omits the input constraint.
    zone = ZoneInfo(settings.timezone)
    today = now().astimezone(zone).date()
    if body.due is not None and body.due < today:
        raise HTTPException(status_code=422, detail="A deadline can't be in the past.")
    if action.start is not None and action.start < now():
        raise HTTPException(status_code=422, detail="That time has already passed.")
    # Form actions use the same validation as model output.
    action = validate(action)
    if action.is_question:
        raise HTTPException(status_code=422, detail=action.question or "That does not add up.")
    result = add(owner_id, action)
    view = today_view(owner_id)
    result = _verified_write_response(
        result,
        view,
        operation="create",
        item_ids=[result["item"]["id"]],
    )
    return {**result, "source": "form", "view": view}


class BulkMatch(BaseModel):
    words: str = Field(min_length=1, max_length=200)


@app.post("/api/bulk/match")
def bulk_match(body: BulkMatch, request: Request) -> dict[str, Any]:
    """Find every open item a phrase matches, so the user sees the list before acting.

    A bulk verb is destructive at a scale undo cannot fix, so it is a two-step reply the way an
    ambiguous single reference is a question: first the list, then the confirmation. This is the
    list. It never writes anything.

    Matching is deliberately looser than `find()`, which asks when a phrase is ambiguous — here
    hitting several items is the intent, not a problem.
    """
    owner_id = request_owner(request).uid
    needle = " ".join(body.words.lower().split())
    with store.session() as session:
        items = [
            item for item in store.open_items(session, owner_id) if _is_local_item(item, owner_id)
        ]
        hits = [item for item in items if needle in item.title.lower()]
        payload = [item.to_dict() for item in hits]
    return {"matched": payload, "count": len(payload)}


@app.post("/api/bulk")
def bulk(body: BulkIn, request: Request) -> dict[str, Any]:
    """Complete or drop several items at once, by the exact ids the user just saw.

    Recorded as one change so a single undo reverses the whole batch, which is the correction a
    bulk verb needs. Ids are matched exactly, never re-parsed, so the confirmation acts on
    precisely what was shown and nothing that arrived since.
    """
    owner_id = request_owner(request).uid
    touched: list[str] = []
    with store.session() as session:
        before: list[dict[str, Any]] = []
        for item_id in body.ids:
            item = store.get_item(session, owner_id, item_id)
            if item is None or item.status != "open" or not _is_local_item(item, owner_id):
                continue
            before.append(item.to_dict())
            if body.verb == "complete":
                item.status = "done"
                item.done_at = now()
            else:
                item.status = "dropped"
            touched.append(item.title)

        if not touched:
            return {
                "kind": "note",
                "message": "Nothing matched to change.",
                "view": today_view(owner_id),
            }

        verb_past = "Completed" if body.verb == "complete" else "Dropped"
        label = f"{verb_past} {len(touched)} item{'s' if len(touched) != 1 else ''}"
        # One change row for the batch: undo puts the whole set back in a single step.
        store.record(session, owner_id, label=label, item=None, before={"bulk": before})

    kind = "completed" if body.verb == "complete" else "dropped"
    return {
        "kind": kind,
        "message": label + ".",
        "chip": touched[:10],
        "view": today_view(owner_id),
    }


@app.patch("/api/items/{item_id}")
def edit(item_id: str, body: ItemIn, request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    with store.session() as session:
        item = store.get_item(session, owner_id, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="No such item.")
        _require_local_item(item, owner_id)
        before = item.to_dict()
        if body.title is not None:
            item.title = body.title.strip() or item.title
        if body.minutes is not None:
            item.minutes = body.minutes
        if body.importance is not None:
            item.importance = body.importance
        if body.notes is not None:
            item.notes = body.notes
        store.record(
            session,
            owner_id,
            label=f"Edited “{item.title}”",
            item=item,
            before=before,
        )
        payload = item.to_dict()
    return {"item": payload, "view": today_view(owner_id)}


@app.post("/api/items/{item_id}/move")
def move_item(item_id: str, body: MoveIn, request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    action = validate(
        Action(
            verb="move",
            which=item_id,
            start=_local(body.start),
            minutes=body.minutes,
            source="form",
        )
    )
    if action.is_question:
        raise HTTPException(status_code=422, detail=action.question or "That does not add up.")
    result = reschedule(owner_id, action, item_id=item_id)
    if result.get("kind") == "question":
        message = str(result["message"])
        if "could not find" in message.casefold():
            raise HTTPException(status_code=404, detail="No such open local item.")
        raise HTTPException(status_code=422, detail=message)
    if result.get("kind") != "rescheduled":
        raise HTTPException(status_code=404, detail="No such open local item.")
    view = today_view(owner_id)
    response = _verified_write_response(result, view, operation="reschedule", item_ids=[item_id])
    return {**response, "view": view}


@app.post("/api/items/{item_id}/{verb}")
def act(item_id: str, verb: str, request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    if verb == "schedule":
        result = place_one(owner_id, item_id, record_undo=True)
        if result is None:
            raise HTTPException(status_code=404, detail="No such open local item.")
        message = (
            f"Scheduled “{result['title']}”, {to_local(result['start_at'])}."
            if result.get("start_at")
            else result["waiting_reason"]
        )
        view = today_view(owner_id)
        response = {
            "kind": "scheduled" if result.get("start_at") else "note",
            "message": message,
            "item": result,
        }
        if response["kind"] == "scheduled":
            response = _verified_write_response(
                response, view, operation="schedule", item_ids=[item_id]
            )
        return {**response, "view": view}
    if verb not in ("complete", "drop", "pin"):
        raise HTTPException(status_code=404, detail="Unknown action.")
    with store.session() as session:
        item = store.get_item(session, owner_id, item_id)
        if item is None:
            raise HTTPException(status_code=404, detail="No such item.")
        _require_local_item(item, owner_id)
        title = item.title
    result = change_existing(owner_id, Action(verb=verb, which=title), item_id=item_id)  # type: ignore[arg-type]
    return {**result, "view": today_view(owner_id)}


@app.post("/api/schedule")
def do_schedule(request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    slots = schedule_now(owner_id)
    view = today_view(owner_id)
    response = {
        "placed": [
            {
                "item_id": slot.item_id,
                "title": slot.title,
                "start": slot.start.isoformat(),
                "end": slot.end.isoformat(),
                "minutes": slot.minutes,
            }
            for slot in slots
        ],
        "view": view,
    }
    if slots:
        receipt = _mutation_receipt(
            view, operation="schedule", item_ids=[slot.item_id for slot in slots]
        )
        response["receipt"] = receipt
    return response


@app.get("/api/review/week")
def do_weekly_review(request: Request) -> dict[str, Any]:
    """Read-only: what got done, what slipped, and the coming week's load."""
    owner_id = request_owner(request).uid
    availability = _external_availability(owner_id, days=8)
    hours = current_hours(owner_id)
    since = now() - dt.timedelta(days=8)  # covers seven local dates in any timezone
    with store.session() as session:
        completed = list(
            session.scalars(
                select(Item).where(
                    Item.owner_id == owner_id, Item.status == "done", Item.done_at >= since
                )
            )
        )
        return weekly_review(
            items=store.open_items(session, owner_id),
            completed=completed,
            remote_busy=list(availability["busy"]),
            hours=hours,
            at=now(),
            complete=bool(availability["complete"]),
        )


@app.post("/api/recovery/preview")
def do_recovery_preview(request: Request) -> dict[str, Any]:
    return recovery_preview(request_owner(request).uid)


class RecoveryApplyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fingerprint: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")


@app.post("/api/recovery/apply")
def do_recovery_apply(body: RecoveryApplyIn, request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    result = apply_recovery(owner_id, body.fingerprint)
    item_ids = result.pop("item_ids")
    view = today_view(owner_id)
    response = _verified_write_response(result, view, operation="reschedule", item_ids=item_ids)
    return {**response, "view": view}


@app.post("/api/undo")
def do_undo(request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    return {**undo_last(owner_id), "view": today_view(owner_id)}


@app.put("/api/hours")
def set_hours(body: HoursIn, request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    if body.windows is None and body.end_hour <= body.start_hour:
        raise HTTPException(status_code=422, detail="Your day has to end after it starts.")
    if body.windows is None and not body.weekdays:
        raise HTTPException(status_code=422, detail="Pick at least one day.")
    if any(day < 0 or day > 6 for day in body.weekdays):
        raise HTTPException(status_code=422, detail="Days must be 0 (Monday) to 6 (Sunday).")
    if body.windows is not None and any(
        day < 0 or day > 6 or start < 0 or start >= 1440 or end < 0 or end > 1440
        for day, start, end in body.windows
    ):
        raise HTTPException(status_code=422, detail="Invalid availability window.")
    previous = store.get_setting(owner_id, HOURS_SETTING) or {}
    if previous.get("windows") is not None and "windows" not in body.model_fields_set:
        raise HTTPException(status_code=409, detail="Reload Settings before changing availability.")
    store.set_setting(owner_id, HOURS_SETTING, body.model_dump())
    return {"view": today_view(owner_id)}


@app.get("/api/changes")
def changes(request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    with store.session() as session:
        rows = list(
            session.scalars(
                select(Change)
                .where(Change.owner_id == owner_id)
                .order_by(Change.at.desc(), Change.id.desc())
                .limit(20)
            )
        )
        return {
            "changes": [
                {
                    "id": row.id,
                    "at": (aware(row.at) or now()).isoformat(),
                    "label": row.label,
                    "undone": bool(row.undone),
                }
                for row in rows
            ]
        }


def _oauth_secret() -> str:
    secret = settings.oauth_secret() or settings.key()
    if len(secret) < KEY_MIN:
        raise HTTPException(status_code=422, detail="COOPER_OAUTH_STATE_SECRET is not configured.")
    return secret


def _sign_oauth_state(state: OAuthState) -> str:
    payload = {
        "owner_id": state.owner_id,
        "nonce": state.nonce,
        "expires_at": state.expires_at.astimezone(dt.UTC).isoformat(),
    }
    encoded = _b64(json.dumps(payload, separators=(",", ":")).encode())
    signature = hmac.new(_oauth_secret().encode(), encoded.encode(), hashlib.sha256).digest()
    return f"{encoded}.{_b64(signature)}"


def _verify_oauth_state(raw: str | None) -> OAuthState:
    if not raw or "." not in raw:
        raise ValueError("missing OAuth state")
    encoded, signature = raw.split(".", 1)
    expected = _b64(hmac.new(_oauth_secret().encode(), encoded.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        raise ValueError("bad OAuth state signature")
    try:
        payload = json.loads(_unb64(encoded))
        owner_id = payload["owner_id"]
        nonce = payload["nonce"]
        expires_at = dt.datetime.fromisoformat(payload["expires_at"]).astimezone(dt.UTC)
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("bad OAuth state payload") from error
    if not isinstance(owner_id, str) or not owner_id:
        raise ValueError("bad OAuth state owner")
    if not isinstance(nonce, str) or not nonce:
        raise ValueError("bad OAuth state nonce")
    if expires_at <= now():
        raise ValueError("expired OAuth state")
    return OAuthState(owner_id=owner_id, nonce=nonce, expires_at=expires_at)


def _oauth_browser_digest(secret: str) -> str:
    return hashlib.sha256(secret.encode()).hexdigest()


def _consume_oauth_nonce(state: OAuthState, browser_secret: str | None) -> bool:
    if not browser_secret:
        return False
    consumed = update(Setting).where(
        Setting.owner_id == state.owner_id,
        Setting.key == GOOGLE_OAUTH_NONCE_SETTING,
        Setting.value["nonce"].as_string() == state.nonce,
        Setting.value["browser_binding"].as_string() == _oauth_browser_digest(browser_secret),
    )
    with store.session() as session:
        result = session.execute(
            consumed.values(value={}).execution_options(synchronize_session=False)
        )
        return result.rowcount == 1


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _unb64(raw: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    except (binascii.Error, ValueError) as error:
        raise ValueError("bad base64") from error


@app.post("/api/google/connect")
def connect(request: Request, response: Response) -> dict[str, str]:
    owner_id = request_owner(request).uid
    nonce = secrets.token_urlsafe(24)
    browser_secret = secrets.token_urlsafe(32)
    expires_at = now() + dt.timedelta(seconds=OAUTH_STATE_SECONDS)
    state = _sign_oauth_state(OAuthState(owner_id=owner_id, nonce=nonce, expires_at=expires_at))
    calendar = google_calendar(owner_id)
    try:
        url = calendar.consent_url(state)
    except CalendarError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    store.set_setting(
        owner_id,
        GOOGLE_OAUTH_NONCE_SETTING,
        {
            "nonce": nonce,
            "expires_at": expires_at.isoformat(),
            "browser_binding": _oauth_browser_digest(browser_secret),
        },
    )
    response.set_cookie(
        GOOGLE_OAUTH_BROWSER_COOKIE,
        browser_secret,
        expires=expires_at,
        httponly=True,
        samesite="lax",
        secure=settings.auth_mode == "firebase",
        path="/api/google/callback",
    )
    return {"url": url}


@app.post("/api/icloud/connect")
def connect_icloud(payload: ICloudCredentials, request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    calendar = icloud_calendar(owner_id)
    if not calendar.configured:
        raise HTTPException(
            status_code=409,
            detail="Server encryption must be configured before connecting iCloud.",
        )
    try:
        sealed = calendar.connect(payload.email, payload.password)
    except CalendarError as error:
        store.set_setting(owner_id, ICLOUD_STATUS_SETTING, {"error": str(error)})
        raise HTTPException(status_code=422, detail=str(error)) from error
    store.set_setting(owner_id, ICLOUD_SETTING, {"credential": sealed})
    store.set_setting(owner_id, ICLOUD_STATUS_SETTING, {"error": None})
    return {"view": today_view(owner_id)}


@app.post("/api/icloud/disconnect")
def disconnect_icloud(request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    store.set_setting(owner_id, ICLOUD_SETTING, {})
    store.set_setting(owner_id, ICLOUD_STATUS_SETTING, {})
    return {"view": today_view(owner_id)}


@app.get("/api/google/callback")
def callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
) -> HTMLResponse:
    if error and not state:
        return _page("Not connected", f"Google said: {error}")
    if not code and not error:
        return _page("Nothing to do", "Google sent no authorization code.")
    try:
        owner_state = _verify_oauth_state(state)
    except ValueError:
        return _page("Wrong origin", "That callback did not come from Cooper.")
    if not _consume_oauth_nonce(owner_state, request.cookies.get(GOOGLE_OAUTH_BROWSER_COOKIE)):
        return _page("Wrong origin", "That callback did not come from Cooper.")

    if error:
        response = _page("Not connected", f"Google said: {error}")
    else:
        calendar = google_calendar(owner_state.owner_id)
        try:
            token, email = calendar.exchange(code)
            sealed = calendar.seal_token(token)
            store.set_setting(owner_state.owner_id, GOOGLE_SETTING, {"token": sealed})
            store.set_setting(
                owner_state.owner_id,
                GOOGLE_CONNECTED_SETTING,
                {"connected": True, "email": email, "connected_at": now().isoformat()},
            )
            response = _page(
                "Calendar connected · Gmail connected",
                f"Cooper can now use {email or 'your Google Calendar and Gmail'}.",
            )
        except CalendarError as failure:
            response = _page("Could not connect", str(failure))
    response.delete_cookie(GOOGLE_OAUTH_BROWSER_COOKIE, path="/api/google/callback")
    return response


@app.post("/api/google/disconnect")
def disconnect(request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    calendar = connected_calendar(owner_id)
    if calendar is not None:
        with contextlib.suppress(CalendarError):
            calendar.revoke()
    store.set_setting(owner_id, GOOGLE_SETTING, {})
    store.set_setting(
        owner_id,
        GOOGLE_CONNECTED_SETTING,
        {"connected": False, "email": None, "disconnected_at": now().isoformat()},
    )
    store.set_setting(owner_id, GOOGLE_OAUTH_NONCE_SETTING, {})
    return {"view": today_view(owner_id)}


@app.post("/api/google/sync")
def sync_google(request: Request) -> dict[str, Any]:
    owner_id = request_owner(request).uid
    summary = sync_gmail_once(owner_id)
    return {"summary": dataclasses.asdict(summary), "view": today_view(owner_id)}


def google_owner_ids() -> list[str]:
    """Owners with a stored Google grant, without reading or returning token material."""
    with store.session() as session:
        rows = list(session.scalars(select(Setting).where(Setting.key == GOOGLE_SETTING)))
    owners: list[str] = []
    for row in rows:
        value = row.value if isinstance(row.value, dict) else {}
        if isinstance(value.get("token"), str) and value["token"]:
            owners.append(row.owner_id)
    return sorted(set(owners))


def _check_sync_secret(request: Request) -> None:
    expected = settings.sync_key()
    supplied = request.headers.get("X-Cooper-Sync-Secret", "")
    if not expected or not secrets.compare_digest(supplied, expected):
        raise HTTPException(status_code=403, detail="Wrong or missing sync secret.")


@app.post("/api/internal/google/sync")
def sync_all_google(request: Request) -> dict[str, int]:
    _check_sync_secret(request)
    totals = {
        "owners": 0,
        "imported": 0,
        "updated": 0,
        "cancelled": 0,
        "skipped": 0,
        "failed": 0,
    }
    for owner_id in google_owner_ids():
        totals["owners"] += 1
        try:
            summary = sync_gmail_once(owner_id)
        except Exception:
            totals["failed"] += 1
            continue
        if summary.error:
            totals["failed"] += 1
            continue
        totals["imported"] += summary.created
        totals["updated"] += summary.updated
        totals["cancelled"] += summary.dropped
        totals["skipped"] += summary.skipped
    return totals


def _page(title: str, message: str) -> HTMLResponse:
    return HTMLResponse(
        f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Cooper</title><style>
body{{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Rounded',system-ui,sans-serif;
background:#F5F5F7;color:#1D1D1F;display:grid;place-items:center;height:100vh;margin:0}}
main{{max-width:30rem;background:#fff;padding:2rem;border-radius:20px;
box-shadow:0 12px 40px rgba(0,0,0,.08);text-align:center}}
h1{{font-size:1.35rem;margin:0 0 .5rem}}p{{color:#6E6E73;margin:0;line-height:1.5}}
</style></head><body><main><h1>{title}</h1><p>{message}</p></main></body></html>"""
    )
