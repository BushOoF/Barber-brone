"""Pydantic v2 schemas for the voice tool surface and API responses.

The voice model (Ollama gemma) must emit EXACTLY ONE tool call as strict JSON. The three real
tools and the escape hatch ``none`` are defined here, together with:

  * ``ToolCall``        — the validated shape returned by the model.
  * ``ProcessResponse`` — what POST /process-voice returns to the cloud bot.
  * ``OLLAMA_FORMAT``   — the JSON Schema passed to Ollama as the ``format`` field so the model is
                          constrained to structured output.

Tool catalogue (HH:MM are 24h, shop-local time):
  1. add_client   { phone: str (required), name?: str }
  2. create_break { start_time: "HH:MM", end_time: "HH:MM", note?: str }
  3. add_walkin   { start_time?: "HH:MM", duration_min?: int (default 30), note?: str }
  4. none         {}  — intent unclear / no tool matched
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ToolName(str, Enum):
    """Closed set of tools the model may select."""

    ADD_CLIENT = "add_client"
    CREATE_BREAK = "create_break"
    ADD_WALKIN = "add_walkin"
    NONE = "none"


# --------------------------------------------------------------------------- argument models

_HHMM_PATTERN = r"^([01]\d|2[0-3]):[0-5]\d$"


class AddClientArgs(BaseModel):
    """Arguments for ``add_client`` — the barber dictates a client's phone (and maybe a name)."""

    model_config = ConfigDict(extra="ignore")

    phone: str = Field(min_length=3, max_length=32)
    name: Optional[str] = Field(default=None, max_length=120)

    @field_validator("phone")
    @classmethod
    def _clean_phone(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("phone must not be empty")
        return v

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


class CreateBreakArgs(BaseModel):
    """Arguments for ``create_break`` — barber is busy for a reason that is NOT a client."""

    model_config = ConfigDict(extra="ignore")

    start_time: str = Field(pattern=_HHMM_PATTERN)
    end_time: str = Field(pattern=_HHMM_PATTERN)
    note: Optional[str] = Field(default=None, max_length=200)

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


class AddWalkinArgs(BaseModel):
    """Arguments for ``add_walkin`` — barber has / is about to have a walk-in client."""

    model_config = ConfigDict(extra="ignore")

    start_time: Optional[str] = Field(default=None, pattern=_HHMM_PATTERN)
    duration_min: int = Field(default=30, ge=1, le=600)
    note: Optional[str] = Field(default=None, max_length=200)

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        v = v.strip()
        return v or None


# Map each concrete tool to its argument model so we can validate ``arguments`` precisely.
_ARG_MODELS: dict[ToolName, type[BaseModel] | None] = {
    ToolName.ADD_CLIENT: AddClientArgs,
    ToolName.CREATE_BREAK: CreateBreakArgs,
    ToolName.ADD_WALKIN: AddWalkinArgs,
    ToolName.NONE: None,
}


class ToolCall(BaseModel):
    """A single validated tool call as emitted by the model.

    ``arguments`` is validated against the matching argument model in :meth:`validate_arguments`.
    We keep it permissive at parse time (so a wrong-shaped ``arguments`` triggers our own clear
    error / retry path) and tighten it explicitly afterwards.
    """

    model_config = ConfigDict(extra="ignore")

    tool: ToolName
    arguments: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(ge=0.0, le=1.0)

    def validate_arguments(self) -> BaseModel | None:
        """Validate ``arguments`` against the tool-specific schema.

        Returns the parsed argument model (or ``None`` for ``tool == none``). Raises
        ``pydantic.ValidationError`` if the arguments do not fit the selected tool — callers use
        this to drive the single-retry-then-give-up logic.
        """
        model = _ARG_MODELS[self.tool]
        if model is None:
            return None
        return model.model_validate(self.arguments)


# --------------------------------------------------------------------------- API response

class ProcessResponse(BaseModel):
    """Response body for POST /process-voice."""

    transcript: str
    tool: ToolName
    arguments: dict[str, Any]
    confidence: float


class JsonAudioRequest(BaseModel):
    """Alternative JSON body for /process-voice: base64-encoded audio."""

    model_config = ConfigDict(extra="ignore")

    audio_base64: str = Field(min_length=1)
    mime: Optional[str] = Field(default=None)


# --------------------------------------------------------------------------- Ollama format

# JSON Schema handed to Ollama via the request "format" field. It constrains the model to emit an
# object with exactly {tool, arguments, confidence}. We intentionally keep ``arguments`` loose at
# the schema level (just an object) because Ollama's structured-output enforcement is strongest on
# the top-level shape; the precise per-tool argument validation happens in Python via the argument
# models above (with a one-shot retry on failure).
OLLAMA_FORMAT: dict[str, Any] = {
    "type": "object",
    "required": ["tool", "arguments", "confidence"],
    "properties": {
        "tool": {
            "type": "string",
            "enum": [
                ToolName.ADD_CLIENT.value,
                ToolName.CREATE_BREAK.value,
                ToolName.ADD_WALKIN.value,
                ToolName.NONE.value,
            ],
        },
        "arguments": {"type": "object"},
        "confidence": {"type": "number"},
    },
}
