"""Firebase identity checks for hosted deployments.

This module stays import-safe. Firebase Admin is only imported and initialized inside the
verification path so local mode keeps working without credentials.
"""

from __future__ import annotations

import dataclasses
import time
from typing import Any


@dataclasses.dataclass(frozen=True, slots=True)
class AuthIdentity:
    uid: str
    email: str


class AuthFailure(Exception):
    __slots__ = ("status_code", "detail")

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def _deny(status_code: int, detail: str) -> None:
    raise AuthFailure(status_code=status_code, detail=detail)


def _firebase_app(project_id: str) -> Any:
    import firebase_admin

    try:
        return firebase_admin.get_app()
    except ValueError:
        return firebase_admin.initialize_app(options={"projectId": project_id})


def _string_claim(claims: dict[str, Any], key: str) -> str | None:
    value = claims.get(key)
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def verify_firebase_token(token: str, *, project_id: str) -> AuthIdentity:
    import firebase_admin.auth as firebase_auth

    try:
        claims = firebase_auth.verify_id_token(token, app=_firebase_app(project_id))
    except Exception:
        # The caller only needs to know that the token was invalid, not why.
        _deny(401, "Invalid authentication token")

    if not isinstance(claims, dict):
        _deny(401, "Invalid authentication token")

    audience = _string_claim(claims, "aud")
    issuer = _string_claim(claims, "iss")
    if audience != project_id or issuer != f"https://securetoken.google.com/{project_id}":
        _deny(401, "Invalid authentication token")

    expires_at = claims.get("exp")
    if not isinstance(expires_at, (int, float)) or expires_at <= time.time():
        _deny(401, "Invalid authentication token")

    if claims.get("email_verified") is not True:
        _deny(401, "Invalid authentication token")

    uid = _string_claim(claims, "uid")
    email = _string_claim(claims, "email")
    if uid is None or email is None:
        _deny(401, "Invalid authentication token")

    return AuthIdentity(uid=uid, email=email.casefold())
