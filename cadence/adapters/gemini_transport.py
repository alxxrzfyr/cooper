"""The only place a Gemini HTTP call is made.

Isolated deliberately. The provider above it is pure translation and is fully tested with a
fake; this file is the thin, untested-by-unit-test edge that talks to Google. Keeping it
this small is what makes that acceptable.

No SDK dependency: the REST endpoint is stable and one function is cheaper than a vendor
library that pulls a dependency tree behind it.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from collections.abc import Mapping
from typing import Any

from cadence.adapters.gemini_provider import JsonTransport
from cadence.core.errors import ProviderError, QuotaExhaustedError

API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models"
REQUEST_TIMEOUT_SECONDS = 30


def build_gemini_transport(
    api_key: str, *, timeout: int = REQUEST_TIMEOUT_SECONDS
) -> JsonTransport:
    """Return a transport that asks for structured JSON output."""

    def transport(
        model_id: str,
        prompt: str,
        schema: Mapping[str, Any],
    ) -> Mapping[str, Any]:
        body = json.dumps(
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0,
                    "responseMimeType": "application/json",
                    "responseSchema": schema,
                },
            }
        ).encode()
        request = urllib.request.Request(  # noqa: S310 - fixed https endpoint
            f"{API_ROOT}/{model_id}:generateContent",
            data=body,
            headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
                payload = json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise QuotaExhaustedError("Gemini quota exhausted") from error
            raise ProviderError(f"Gemini returned HTTP {error.code}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise ProviderError(f"Gemini unreachable: {error}") from error
        except json.JSONDecodeError as error:
            raise ProviderError("Gemini response was not JSON") from error

        return _extract(payload)

    return transport


def _extract(payload: Mapping[str, Any]) -> Mapping[str, Any]:
    """Pull the model's JSON object out of the response envelope."""
    candidates = payload.get("candidates")
    if not candidates:
        raise ProviderError("Gemini returned no candidates")
    try:
        text = candidates[0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as error:
        raise ProviderError("Gemini response had an unexpected shape") from error
    try:
        decoded = json.loads(text)
    except json.JSONDecodeError as error:
        raise ProviderError("Gemini did not return a JSON object") from error
    if not isinstance(decoded, Mapping):
        raise ProviderError("Gemini returned JSON that was not an object")
    return decoded
