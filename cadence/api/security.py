from hmac import compare_digest

from starlette.datastructures import Headers
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

SHARED_SECRET_HEADER = "X-Cadence-Secret"


class LocalSecurityMiddleware:
    """Enforce assumptions that make the localhost-only API safe."""

    def __init__(
        self,
        app: ASGIApp,
        *,
        shared_secret: str,
        allowed_origin: str,
        allowed_hosts: tuple[str, ...],
    ) -> None:
        self.app = app
        self.shared_secret = shared_secret
        self.allowed_origin = allowed_origin
        self.allowed_hosts = frozenset(allowed_hosts)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        headers = Headers(scope=scope)
        host = headers.get("host", "").partition(":")[0]
        if host not in self.allowed_hosts:
            await self._refuse(scope, receive, send, status_code=400, detail="Unexpected Host")
            return

        origin = headers.get("origin")
        if origin is not None and origin != self.allowed_origin:
            await self._refuse(scope, receive, send, status_code=403, detail="Origin refused")
            return

        if scope["method"] != "OPTIONS":
            supplied_secret = headers.get(SHARED_SECRET_HEADER, "")
            if not compare_digest(supplied_secret, self.shared_secret):
                await self._refuse(
                    scope,
                    receive,
                    send,
                    status_code=403,
                    detail="Shared secret required",
                )
                return

        await self.app(scope, receive, send)

    @staticmethod
    async def _refuse(
        scope: Scope,
        receive: Receive,
        send: Send,
        *,
        status_code: int,
        detail: str,
    ) -> None:
        response = JSONResponse({"detail": detail}, status_code=status_code)
        await response(scope, receive, send)
