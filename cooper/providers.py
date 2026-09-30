"""One provider call, normalized content and measured usage; no storage or retries."""

from __future__ import annotations

import copy
import dataclasses
import http.client
import json
import math
import re
import urllib.error
import urllib.request
from typing import Any, Literal

FailureKind = Literal[
    "unavailable", "timeout", "refusal", "invalid_credentials", "invalid_response"
]


@dataclasses.dataclass(frozen=True)
class ProviderReply:
    envelope: dict[str, Any]
    input_tokens: int
    output_tokens: int


class ProviderFailure(Exception):
    def __init__(
        self,
        kind: FailureKind,
        *,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
    ) -> None:
        super().__init__(kind)
        self.kind = kind
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens


def _count(value: Any) -> int:
    if type(value) is not int or value < 0:
        raise ValueError("invalid usage")
    return value


def _strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(schema)
    if result.get("type") == "object":
        properties = result.get("properties", {})
        required = result.get("required", [])
        result["additionalProperties"] = False
        result["required"] = list(properties)
        for name, child in properties.items():
            converted = _strict_schema(child)
            if name not in required:
                converted = (
                    {"anyOf": [converted, {"type": "null"}]}
                    if "enum" in converted
                    else {**converted, "type": [converted["type"], "null"]}
                )
            properties[name] = converted
    elif result.get("type") == "array":
        result["items"] = _strict_schema(result["items"])
    return result


def _groq_body(model: str, body: dict[str, Any]) -> dict[str, Any]:
    messages: list[dict[str, Any]] = []
    pending: list[tuple[str, str]] = []
    call_number = 0
    for turn in body["contents"]:
        role = "assistant" if turn.get("role") == "model" else "user"
        texts: list[str] = []
        calls: list[dict[str, Any]] = []
        for part in turn["parts"]:
            if "text" in part and not part.get("thought"):
                if not isinstance(part["text"], str):
                    raise ValueError("invalid text")
                texts.append(part["text"])
            elif "functionCall" in part:
                if role != "assistant":
                    raise ValueError("invalid call role")
                call = part["functionCall"]
                if not isinstance(call["name"], str) or not isinstance(call.get("args", {}), dict):
                    raise ValueError("invalid call")
                call_number += 1
                call_id = f"cooper_call_{call_number}"
                pending.append((call["name"], call_id))
                calls.append(
                    {
                        "id": call_id,
                        "type": "function",
                        "function": {
                            "name": call["name"],
                            "arguments": json.dumps(call.get("args", {})),
                        },
                    }
                )
            elif "functionResponse" in part:
                response = part["functionResponse"]
                match = next((entry for entry in pending if entry[0] == response["name"]), None)
                if match is None:
                    raise ValueError("unmatched tool response")
                pending.remove(match)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": match[1],
                        "content": json.dumps(response["response"]),
                    }
                )
            else:
                raise ValueError("unsupported content")
        if texts or calls:
            message: dict[str, Any] = {"role": role, "content": "\n".join(texts) or None}
            if calls:
                message["tool_calls"] = calls
            messages.append(message)
    config = body.get("generationConfig", {})
    result: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": config.get("temperature", 0),
        "max_completion_tokens": config.get("maxOutputTokens", 384),
        "stream": False,
    }
    if body.get("tools"):
        declarations = [
            declaration for group in body["tools"] for declaration in group["functionDeclarations"]
        ]
        result["tools"] = [
            {"type": "function", "function": declaration} for declaration in declarations
        ]
        result["tool_choice"] = "auto"
    elif "responseSchema" in config:
        result["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "cooper_action",
                "strict": True,
                "schema": _strict_schema(config["responseSchema"]),
            },
        }
    return result


def _parts(provider: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    if provider == "gemini":
        candidate = payload["candidates"][0]
        if candidate.get("finishReason") not in (None, "STOP"):
            raise ValueError("unfinished response")
        for part in candidate["content"]["parts"]:
            if part.get("thought"):
                continue
            if "text" in part and isinstance(part["text"], str):
                parts.append({"text": part["text"]})
            elif "functionCall" in part:
                call = part["functionCall"]
                if not isinstance(call["name"], str) or not isinstance(call.get("args", {}), dict):
                    raise ValueError("invalid function call")
                parts.append({"functionCall": {"name": call["name"], "args": call.get("args", {})}})
            else:
                raise ValueError("invalid part")
    else:
        choice = payload["choices"][0]
        if choice.get("finish_reason") not in ("stop", "tool_calls"):
            raise ValueError("unfinished response")
        message = choice["message"]
        if message.get("content") is not None:
            if not isinstance(message["content"], str):
                raise ValueError("invalid text")
            parts.append({"text": message["content"]})
        for tool in message.get("tool_calls", []):
            call = tool["function"]
            arguments = json.loads(call["arguments"])
            if not isinstance(call["name"], str) or not isinstance(arguments, dict):
                raise ValueError("invalid function call")
            parts.append({"functionCall": {"name": call["name"], "args": arguments}})
    if not parts or not any(
        part.get("text", "").strip() or part.get("functionCall") for part in parts
    ):
        raise ValueError("empty response")
    return parts


def generate(
    provider: str, key: str, model: str, body: dict[str, Any], timeout: float
) -> ProviderReply:
    """Dispatch once. Failure messages contain only categories, never provider bodies.

    Measured failures carry token counts for settlement. Missing counts require
    conservative reservation retention by the caller.
    """
    if not key or not model:
        raise ProviderFailure("invalid_credentials")
    if (
        provider not in ("gemini", "groq")
        or not re.fullmatch(r"[A-Za-z0-9._/-]+", model)
        or not math.isfinite(timeout)
        or timeout <= 0
    ):
        raise ProviderFailure("invalid_response")
    try:
        if provider == "gemini":
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
            headers = {"x-goog-api-key": key}
            request_body = body
        else:
            url = "https://api.groq.com/openai/v1/chat/completions"
            headers = {"Authorization": f"Bearer {key}"}
            request_body = _groq_body(model, body)
        request = urllib.request.Request(
            url,
            data=json.dumps(request_body).encode(),
            headers={**headers, "Content-Type": "application/json"},
            method="POST",
        )  # noqa: S310
    except (ValueError, TypeError, KeyError, AttributeError, IndexError):
        raise ProviderFailure("invalid_response") from None
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            payload = json.loads(response.read())
    except urllib.error.HTTPError as error:
        kind: FailureKind = (
            "invalid_credentials"
            if error.code in (401, 403)
            else "unavailable"
            if error.code == 429 or error.code in (500, 502, 503, 504)
            else "invalid_response"
        )
        raise ProviderFailure(kind) from None
    except TimeoutError:
        raise ProviderFailure("timeout") from None
    except urllib.error.URLError as error:
        raise ProviderFailure(
            "timeout" if isinstance(error.reason, TimeoutError) else "unavailable"
        ) from None
    except (OSError, http.client.HTTPException):
        raise ProviderFailure("unavailable") from None
    except (ValueError, UnicodeError):
        raise ProviderFailure("invalid_response") from None
    try:
        if provider == "gemini":
            usage = payload["usageMetadata"]
            input_tokens = _count(usage["promptTokenCount"])
            output_tokens = _count(usage["candidatesTokenCount"]) + _count(
                usage.get("thoughtsTokenCount", 0)
            )
        else:
            usage = payload["usage"]
            input_tokens = _count(usage["prompt_tokens"])
            output_tokens = _count(usage["completion_tokens"])
    except (ValueError, TypeError, KeyError, AttributeError):
        raise ProviderFailure("invalid_response") from None
    try:
        if provider == "gemini":
            refused = bool(payload.get("promptFeedback", {}).get("blockReason")) or any(
                candidate.get("finishReason")
                in (
                    "SAFETY",
                    "RECITATION",
                    "BLOCKLIST",
                    "PROHIBITED_CONTENT",
                    "SPII",
                    "IMAGE_SAFETY",
                )
                for candidate in payload.get("candidates", [])
            )
        else:
            refused = any(
                choice.get("finish_reason") == "content_filter"
                or choice.get("message", {}).get("refusal")
                for choice in payload.get("choices", [])
            )
        if refused:
            raise ProviderFailure("refusal", input_tokens=input_tokens, output_tokens=output_tokens)
        parts = _parts(provider, payload)
    except (ValueError, TypeError, KeyError, AttributeError, IndexError):
        raise ProviderFailure(
            "invalid_response", input_tokens=input_tokens, output_tokens=output_tokens
        ) from None
    return ProviderReply(
        {"candidates": [{"content": {"role": "model", "parts": parts}}]},
        input_tokens,
        output_tokens,
    )
