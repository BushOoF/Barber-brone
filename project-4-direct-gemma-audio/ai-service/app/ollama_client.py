"""Direct audio -> Gemma client (Project 4). NO speech-to-text middleman.

The WAV bytes are base64-encoded and sent to Ollama /api/chat in the message
``images`` field (Gemma 4's audio encoder is invoked for audio payloads). Gemma
returns the tool call + a transcript in one request, constrained by the
role-specific ``format`` JSON Schema at temperature 0. ``today`` (the shop-local
date) is injected into the prompt so relative dates resolve.
"""

from __future__ import annotations

import base64
import json
import logging

import httpx
from pydantic import ValidationError

from .config import settings
from .schemas import (
    ToolCall,
    ToolName,
    format_for_role,
    system_prompt_for_role,
    validate_arguments,
)

logger = logging.getLogger(__name__)


class OllamaUnavailableError(RuntimeError):
    """Raised when Ollama is unreachable, times out, or returns a bad HTTP status."""


def _audio_messages(
    b64_wav: str, role: str, today: str | None = None, validation_error: str | None = None
) -> list[dict]:
    user = "Listen to the attached audio and respond with the JSON object only."
    if validation_error:
        user += (
            f"\nYour previous answer was rejected: {validation_error}. "
            "Reply again with ONLY the corrected JSON object."
        )
    return [
        {"role": "system", "content": system_prompt_for_role(role, today)},
        {"role": "user", "content": user, "images": [b64_wav]},
    ]


def _payload(messages: list[dict], fmt: dict) -> dict:
    return {
        "model": settings.ollama_model,
        "messages": messages,
        "format": fmt,
        "stream": False,
        "options": {"temperature": 0},
    }


def _extract_content(data: dict) -> str:
    message = data.get("message")
    if not isinstance(message, dict):
        raise ValueError("ollama response missing 'message' object")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("ollama response has empty message content")
    return content.strip()


def _parse(content: str) -> tuple[ToolName, dict, float, str]:
    try:
        raw = json.loads(content)
    except json.JSONDecodeError as exc:
        raise ValueError(f"model output was not valid JSON: {exc.msg}") from exc
    if not isinstance(raw, dict):
        raise ValueError("model output JSON must be an object")
    envelope = ToolCall.model_validate(raw)
    clean_args = validate_arguments(envelope.tool, envelope.arguments)
    transcript = raw.get("transcript")
    transcript = transcript if isinstance(transcript, str) else ""
    return envelope.tool, clean_args, envelope.confidence, transcript


def _post(client: httpx.Client, messages: list[dict], fmt: dict) -> str:
    try:
        resp = client.post(settings.ollama_chat_endpoint, json=_payload(messages, fmt))
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        raise OllamaUnavailableError(f"cannot reach Ollama at {settings.ollama_url}: {exc}") from exc
    except httpx.TimeoutException as exc:
        raise OllamaUnavailableError(f"Ollama request timed out: {exc}") from exc
    except httpx.HTTPError as exc:
        raise OllamaUnavailableError(f"Ollama request failed: {exc}") from exc

    if resp.status_code >= 500:
        raise OllamaUnavailableError(f"Ollama server error {resp.status_code}: {resp.text[:300]}")
    if resp.status_code >= 400:
        raise OllamaUnavailableError(f"Ollama rejected the request ({resp.status_code}): {resp.text[:300]}")

    try:
        data = resp.json()
    except ValueError as exc:
        raise OllamaUnavailableError(f"Ollama returned non-JSON body: {exc}") from exc
    return _extract_content(data)


def classify_audio(
    wav_bytes: bytes, role: str = "barber", today: str | None = None
) -> tuple[ToolName, dict, float, str]:
    """Send audio straight to Gemma and return (tool, arguments, confidence, transcript).

    At most two Ollama calls (initial + one corrective retry). Never raises on a
    *validation* problem (returns ``none``). Raises ``OllamaUnavailableError`` only
    when Ollama itself cannot be reached.
    """

    if not wav_bytes:
        return ToolName.NONE, {}, 0.0, ""

    b64 = base64.b64encode(wav_bytes).decode("ascii")
    fmt = format_for_role(role)
    timeout = httpx.Timeout(settings.ollama_timeout_s)
    with httpx.Client(timeout=timeout) as client:
        content = _post(client, _audio_messages(b64, role, today), fmt)
        try:
            return _parse(content)
        except (ValueError, ValidationError) as first_err:
            logger.info("gemma audio output failed validation, retrying once: %s", first_err)
        content = _post(client, _audio_messages(b64, role, today, str(first_err)), fmt)
        try:
            return _parse(content)
        except (ValueError, ValidationError) as second_err:
            logger.warning("gemma audio output still invalid after retry: %s", second_err)
            return ToolName.NONE, {}, 0.0, ""
