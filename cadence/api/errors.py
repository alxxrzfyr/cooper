"""Domain error to HTTP status mapping.

Registered once on the app. Routes therefore never translate errors themselves, so a new
route cannot invent a different status code for the same failure.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from cadence.core.errors import (
    AmbiguousReferenceError,
    DomainValidationError,
    TaskNotFoundError,
)


async def _validation(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=422)


async def _not_found(_: Request, exc: Exception) -> JSONResponse:
    return JSONResponse({"detail": str(exc)}, status_code=404)


async def _ambiguous(_: Request, exc: Exception) -> JSONResponse:
    candidates = getattr(exc, "candidates", ())
    return JSONResponse(
        {"detail": str(exc), "candidates": list(candidates)},
        status_code=409,
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(DomainValidationError, _validation)
    app.add_exception_handler(TaskNotFoundError, _not_found)
    app.add_exception_handler(AmbiguousReferenceError, _ambiguous)
