"""Ollama chat client that returns a validated, role-aware tool call.

Flow per the spec:
  * POST to OLLAMA_URL/api/chat with the model, the role-specific JSON-Schema
    ``format``, options.temperature=0 and stream=false.
  * Parse the assistant message content as JSON; validate the envelope, then the
    per-tool arguments.
  * On a validation failure, do ONE retry that appends the validation error to
    the prompt. If it still fails, fall back to tool="none".
"""

from __future__ import annotations

import json
import logging

import httpx
from pydantic import ValidationError

from .config import settings
from .schemas import (
    ToolCall,
    ToolName,
    build_messages,
    format_for_role,
    validate_arguments,
)

logger = logging.getLogger(__name__)


class OllamaUnavailableError(RuntimeError):
    """Raised when Ollama is unreachable, times out, or returns a bad HTTP status."""


def _build_payload(messages: list[dict[str, str]], fmt: dict) -> dict:
    return {
        "model": settings.ollama_model,
        "messages": messages,
        "format": fmt,
        "stream": False,
        "options": {"temperature": 0},
    }


def _extract_content(data: dict) -> str:
    """Pull the assistant text out of an Ollama /api/chat response."""

    message = data.get("message")
    if not isinstance(message, dict):
        raise ValueError("ollama response missing 'message' object")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("ollama response has empty message content")
    return content.strip()


def _parse_and_validate(content: str) -> tuple[ToolName, dict, float]:
    """Parse model JSON -> validated (tool, arguments, confidence)."""

    try:
        raw = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"model output was not valid JSON: {exc.msg}") from exc

    if not isinstance(raw, dict):
        raise ValueError("model output JSON must be an object")

    envelope = ToolCall.model_validate(raw)
    clean_args = validate_arguments(envelope.tool, envelope.arguments)
    return envelope.tool, clean_args, envelope.confidence


def _post(client: httpx.Client, messages: list[dict[str, str]], fmt: dict) -> str:
    """Make one POST to Ollama and return the raw assistant content string."""

    try:
        resp = client.post(settings.ollama_chat_endpoint, json=_build_payload(messages, fmt))
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        raise OllamaUnavailableError(f"cannot reach Ollama at {settings.ollama_url}: {exc}") from exc
    except httpx.TimeoutException as exc:
        raise OllamaUnavailableError(f"Ollama request timed out: {exc}") from exc
    except httpx.HTTPError as exc:
        raise OllamaUnavailableError(f"Ollama request failed: {exc}") from exc

    if resp.status_code >= 500:
        raise OllamaUnavailableError(
            f"Ollama returned server error {resp.status_code}: {resp.text[:300]}"
        )
    if resp.status_code >= 400:
        raise OllamaUnavailableError(
            f"Ollama rejected the request ({resp.status_code}): {resp.text[:300]}"
        )

    try:
        data = resp.json()
    except ValueError as exc:
        raise OllamaUnavailableError(f"Ollama returned non-JSON body: {exc}") from exc

    return _extract_content(data)


def classify(transcript: str, role: str = "barber") -> tuple[ToolName, dict, float]:
    """Turn a transcript + speaker role into a validated (tool, arguments, confidence) triple.

    At most two Ollama calls (initial + one corrective retry). Never raises on a
    *validation* problem (returns the ``none`` tool). Raises ``OllamaUnavailableError``
    only when Ollama itself cannot be reached.
    """

    transcript = (transcript or "").strip()
    if not transcript:
        return ToolName.NONE, {}, 0.0

    fmt = format_for_role(role)
    timeout = httpx.Timeout(settings.ollama_timeout_s)
    with httpx.Client(timeout=timeout) as client:
        # --- Attempt 1 ---
        messages = build_messages(transcript, role)
        content = _post(client, messages, fmt)
        try:
            return _parse_and_validate(content)
        except (ValueError, ValidationError) as first_err:
            logger.info("ollama output failed validation, retrying once: %s", first_err)

        # --- Attempt 2 (corrective retry) ---
        retry_messages = build_messages(transcript, role, validation_error=str(first_err))
        try:
            content = _post(client, retry_messages, fmt)
            return _parse_and_validate(content)
        except (ValueError, ValidationError) as second_err:
            logger.warning("ollama output still invalid after retry: %s", second_err)
            return ToolName.NONE, {}, 0.0
