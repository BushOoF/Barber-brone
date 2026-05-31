"""Ollama integration: turn a transcript into exactly one structured tool call.

We POST to ``OLLAMA_URL/api/chat`` with:
  * model       = OLLAMA_MODEL (gemma4:e4b)
  * format       = the JSON Schema from schemas.OLLAMA_FORMAT (structured output)
  * options.temperature = 0, stream = false

The model is instructed (see SYSTEM_PROMPT) to emit ONLY the JSON object for the single best tool.
We parse + validate with pydantic; on validation failure we do exactly ONE retry that appends the
validation error to the conversation; if it still fails we fall back to ``tool="none"``.

Ollama being unreachable / timing out raises :class:`OllamaUnavailable` (mapped to 503 upstream).
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx
from pydantic import ValidationError

from .config import get_settings
from .schemas import OLLAMA_FORMAT, ToolCall, ToolName

logger = logging.getLogger("local_ai_worker.ollama")


class OllamaUnavailable(Exception):
    """Raised when Ollama cannot be reached or times out (=> 503)."""


# The system prompt is deliberately strict. The speaker is an Uzbek barber who mixes Russian in
# (especially numbers/times). We force 24h HH:MM shop-local times and a single bare JSON object.
SYSTEM_PROMPT = """You are a strict intent parser for a barbershop scheduling bot.

The speaker is an Uzbek barber talking about his own workday. He speaks formal or conversational
Uzbek and FREQUENTLY mixes in Russian words — especially numbers and times are often spoken in
Russian (for example "в два часа", "полдвенадцатого", "пятнадцать тридцать"). Understand both
Uzbek and Russian.

You must choose EXACTLY ONE of these tools and output ONLY its JSON object:

1. add_client — the barber dictates a CLIENT'S phone number (optionally a name) so it can be saved.
   arguments: { "phone": "<digits, keep + and leading zeros>", "name": "<optional>" }

2. create_break — the barber will be BUSY for a reason that is NOT a client (lunch, errand, prayer,
   personal time, leaving early, etc.). He gives a time range.
   arguments: { "start_time": "HH:MM", "end_time": "HH:MM", "note": "<optional short reason>" }

3. add_walkin — the barber is having, or is about to have, a CLIENT (a walk-in / someone just came).
   arguments: { "start_time": "HH:MM (optional, omit if 'now')", "duration_min": <integer minutes,
   default 30>, "note": "<optional>" }

4. none — the intent does not match any tool, or you are unsure.
   arguments: {}

RULES:
- Normalize EVERY time to 24-hour HH:MM in shop local time. "half past two" / "полтретьего" => 14:30
  when clearly afternoon; use the most natural shop-hours interpretation.
- Output ONLY the JSON object. No prose, no explanation, no markdown, no code fences.
- The JSON must have exactly these keys: "tool", "arguments", "confidence" (a number 0..1).
- If several intents are present, pick the single PRIMARY one.
- If nothing matches or it is small-talk/unclear, return {"tool":"none","arguments":{},"confidence":0}.
"""


def _build_messages(transcript: str) -> list[dict[str, str]]:
    """Build the base [system, user] message list for the chat call."""
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": transcript},
    ]


async def _chat(messages: list[dict[str, str]]) -> str:
    """Call Ollama /api/chat once and return the raw assistant message content.

    Raises :class:`OllamaUnavailable` on connection / timeout errors and for non-2xx responses.
    """
    settings = get_settings()
    url = f"{settings.OLLAMA_URL}/api/chat"
    payload: dict[str, Any] = {
        "model": settings.OLLAMA_MODEL,
        "messages": messages,
        "format": OLLAMA_FORMAT,
        "stream": False,
        "options": {"temperature": 0},
    }

    try:
        async with httpx.AsyncClient(timeout=settings.OLLAMA_TIMEOUT_S) as client:
            resp = await client.post(url, json=payload)
    except (httpx.ConnectError, httpx.ConnectTimeout) as exc:
        raise OllamaUnavailable(f"Cannot reach Ollama at {settings.OLLAMA_URL}: {exc}") from exc
    except httpx.TimeoutException as exc:
        raise OllamaUnavailable(f"Ollama timed out after {settings.OLLAMA_TIMEOUT_S}s.") from exc
    except httpx.HTTPError as exc:  # any other transport-level error
        raise OllamaUnavailable(f"Ollama request error: {exc}") from exc

    if resp.status_code >= 400:
        # A 404 here almost always means the model has not been pulled.
        hint = ""
        if resp.status_code == 404:
            hint = f" (is the model pulled? run: ollama pull {settings.OLLAMA_MODEL})"
        raise OllamaUnavailable(
            f"Ollama returned HTTP {resp.status_code}{hint}: {resp.text[:200]}"
        )

    try:
        body = resp.json()
        # /api/chat returns {"message": {"role": "assistant", "content": "..."}, ...}
        return body["message"]["content"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise OllamaUnavailable(f"Unexpected Ollama response shape: {exc}") from exc


def _parse_tool_call(content: str) -> ToolCall:
    """Parse + validate the assistant content into a :class:`ToolCall`.

    Performs both JSON parsing and the tool-specific argument validation. Raises
    ``pydantic.ValidationError`` or ``ValueError`` on any problem so the retry logic can react.
    """
    content = (content or "").strip()
    # Be tolerant of an accidental ```json fence even though we asked the model not to add one.
    if content.startswith("```"):
        content = content.strip("`")
        # Drop a leading "json" language tag if present.
        if content[:4].lower() == "json":
            content = content[4:]
        content = content.strip()

    data = json.loads(content)  # may raise JSONDecodeError
    call = ToolCall.model_validate(data)  # top-level shape
    call.validate_arguments()  # tool-specific args; raises on mismatch
    return call


async def infer_tool_call(transcript: str) -> ToolCall:
    """Run the full transcript -> tool-call inference with one validation retry.

    Strategy:
      1. Ask Ollama, parse + validate.
      2. On parse/validation failure, ask ONCE more, appending the error so the model can self-fix.
      3. If it still fails, return ``tool="none"`` with confidence 0 (never raise for bad content).

    Ollama being unreachable still propagates as :class:`OllamaUnavailable`.
    """
    if not transcript.strip():
        # Empty transcript (e.g. silence) — nothing to infer.
        return ToolCall(tool=ToolName.NONE, arguments={}, confidence=0.0)

    messages = _build_messages(transcript)

    # --- attempt 1 -----------------------------------------------------------------------------
    content = await _chat(messages)
    try:
        return _parse_tool_call(content)
    except (ValidationError, ValueError, json.JSONDecodeError) as first_err:
        logger.info("Tool-call validation failed on first attempt; retrying. Error: %s", first_err)

    # --- attempt 2 (single retry, error fed back) ----------------------------------------------
    messages = messages + [
        {"role": "assistant", "content": content},
        {
            "role": "user",
            "content": (
                "Your previous reply was not valid. Error: "
                f"{first_err}. "
                "Reply again with ONLY a single valid JSON object having keys "
                '"tool", "arguments", "confidence". No markdown, no prose.'
            ),
        },
    ]
    content = await _chat(messages)
    try:
        return _parse_tool_call(content)
    except (ValidationError, ValueError, json.JSONDecodeError) as second_err:
        logger.warning("Tool-call still invalid after retry; returning none. Error: %s", second_err)
        return ToolCall(tool=ToolName.NONE, arguments={}, confidence=0.0)


async def ping() -> bool:
    """Lightweight reachability check for /healthz — returns True if Ollama answers /api/tags."""
    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{settings.OLLAMA_URL}/api/tags")
        return resp.status_code < 400
    except httpx.HTTPError:
        return False
