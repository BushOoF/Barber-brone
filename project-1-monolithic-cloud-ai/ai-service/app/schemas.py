"""Pydantic models, the role-aware Ollama structured-output schema, and system prompts.

The voice tool surface depends on WHO is speaking (passed as ``role``):

* ``customer``               -> book_appointment
* ``staff`` (barber/apprentice) -> create_break, add_walkin
* ``barber`` (legacy default, the standalone Project-1 bot) -> create_break, add_walkin, add_client

Every role also has the ``none`` escape hatch. Gemma must emit EXACTLY ONE tool
call as strict JSON and nothing else. Defaulting ``role`` to ``barber`` keeps the
original Project-1 behaviour unchanged.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

# 24-hour HH:MM, e.g. 09:05, 23:45. Single source of truth for time validation.
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ToolName(str, Enum):
    """The full tool surface across all roles."""

    ADD_CLIENT = "add_client"
    CREATE_BREAK = "create_break"
    ADD_WALKIN = "add_walkin"
    BOOK_APPOINTMENT = "book_appointment"
    NONE = "none"


# --------------------------------------------------------------------------- #
# Per-tool argument models (second-pass validation once the tool is known).    #
# --------------------------------------------------------------------------- #
class AddClientArgs(BaseModel):
    """Barber dictates a client phone number (optionally a name)."""

    model_config = {"extra": "ignore"}

    phone: str = Field(..., min_length=1)
    name: str | None = None

    @field_validator("phone")
    @classmethod
    def _phone_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("phone must not be empty")
        return v

    @field_validator("name")
    @classmethod
    def _clean_name(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class CreateBreakArgs(BaseModel):
    """Barber will be busy and it is NOT because of a client."""

    model_config = {"extra": "ignore"}

    start_time: str
    end_time: str
    note: str | None = None

    @field_validator("start_time", "end_time")
    @classmethod
    def _valid_time(cls, v: str) -> str:
        v = v.strip()
        if not _TIME_RE.match(v):
            raise ValueError("time must be 24h HH:MM")
        return v

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _end_after_start(self) -> "CreateBreakArgs":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class AddWalkinArgs(BaseModel):
    """Barber is having / about to have a walk-in client."""

    model_config = {"extra": "ignore"}

    start_time: str | None = None
    duration_min: int = 30
    note: str | None = None

    @field_validator("start_time")
    @classmethod
    def _valid_optional_time(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if not _TIME_RE.match(v):
            raise ValueError("start_time must be 24h HH:MM")
        return v

    @field_validator("duration_min")
    @classmethod
    def _positive_duration(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("duration_min must be a positive integer")
        if v > 600:
            raise ValueError("duration_min is unrealistically large")
        return v

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None


class BookAppointmentArgs(BaseModel):
    """A CUSTOMER wants to book a haircut for themselves."""

    model_config = {"extra": "ignore"}

    # "asap" => the earliest available slot. "time" => a specific time the customer named.
    when: Literal["asap", "time"] = "asap"
    time: str | None = None  # 24h HH:MM, required when when == "time"
    date: str | None = None  # "today" | "tomorrow" | "YYYY-MM-DD"
    note: str | None = None

    @field_validator("time")
    @classmethod
    def _valid_optional_time(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        if not v:
            return None
        if not _TIME_RE.match(v):
            raise ValueError("time must be 24h HH:MM")
        return v

    @field_validator("date")
    @classmethod
    def _valid_date(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().lower()
        if not v:
            return None
        if v in ("today", "tomorrow") or _DATE_RE.match(v):
            return v
        raise ValueError("date must be 'today', 'tomorrow' or YYYY-MM-DD")

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip()
        return v or None

    @model_validator(mode="after")
    def _time_required_when_specific(self) -> "BookAppointmentArgs":
        if self.when == "time" and not self.time:
            raise ValueError("time is required when when='time'")
        return self


# Maps each real tool to the model that validates its arguments.
_ARG_MODELS: dict[ToolName, type[BaseModel]] = {
    ToolName.ADD_CLIENT: AddClientArgs,
    ToolName.CREATE_BREAK: CreateBreakArgs,
    ToolName.ADD_WALKIN: AddWalkinArgs,
    ToolName.BOOK_APPOINTMENT: BookAppointmentArgs,
}


def validate_arguments(tool: ToolName, arguments: dict[str, Any]) -> dict[str, Any]:
    """Validate/normalise ``arguments`` for the chosen tool. NONE -> {}.

    Raises ``pydantic.ValidationError`` (a ValueError subclass) on bad input.
    """

    if tool is ToolName.NONE:
        return {}
    model_cls = _ARG_MODELS[tool]
    parsed = model_cls.model_validate(arguments or {})
    return parsed.model_dump(exclude_none=False)


class ToolCall(BaseModel):
    """First-pass validation of the raw model output envelope."""

    model_config = {"extra": "ignore"}

    tool: ToolName
    arguments: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(..., ge=0.0, le=1.0)

    @field_validator("arguments", mode="before")
    @classmethod
    def _coerce_arguments(cls, v: Any) -> dict[str, Any]:
        if v is None:
            return {}
        if not isinstance(v, dict):
            raise ValueError("arguments must be a JSON object")
        return v


class ProcessVoiceResponse(BaseModel):
    transcript: str
    tool: ToolName
    arguments: dict[str, Any] = Field(default_factory=dict)
    confidence: float


class JsonAudioRequest(BaseModel):
    """Alternative JSON body for /process-voice (instead of multipart)."""

    audio_base64: str = Field(..., min_length=1)
    mime: str | None = None


# --------------------------------------------------------------------------- #
# Role -> allowed tools.                                                        #
# --------------------------------------------------------------------------- #
ROLE_TOOLS: dict[str, list[ToolName]] = {
    "customer": [ToolName.BOOK_APPOINTMENT],
    "staff": [ToolName.CREATE_BREAK, ToolName.ADD_WALKIN],
    "barber": [ToolName.CREATE_BREAK, ToolName.ADD_WALKIN, ToolName.ADD_CLIENT],
}


def tools_for_role(role: str | None) -> list[ToolName]:
    return ROLE_TOOLS.get((role or "barber").strip().lower(), ROLE_TOOLS["barber"])


def format_for_role(role: str | None) -> dict[str, Any]:
    """Build the Ollama ``format`` JSON Schema, constraining ``tool`` to this role's set."""

    allowed = [t.value for t in tools_for_role(role)] + [ToolName.NONE.value]
    return {
        "type": "object",
        "required": ["tool", "arguments", "confidence"],
        "properties": {
            "tool": {"type": "string", "enum": allowed},
            "arguments": {"type": "object"},
            "confidence": {"type": "number"},
        },
    }


# Per-tool description blocks reused when assembling the role-specific prompt.
_TOOL_DOCS: dict[ToolName, str] = {
    ToolName.BOOK_APPOINTMENT: (
        'book_appointment - the customer wants to book a haircut for themselves. '
        'If they want the EARLIEST/soonest slot (e.g. "hozir", "imkoni boricha tez", '
        '"bugun bo\'sh vaqt", "kak mojno skoreye", "today if possible"), set '
        '{"when": "asap"}. If they name a SPECIFIC time, set {"when": "time", '
        '"time": "HH:MM", "date": "today"|"tomorrow"|"YYYY-MM-DD"}. Default date to '
        '"today" when they give only a time. Arguments: {"when": "asap"|"time", '
        '"time": "HH:MM" (only if when=time), "date": string (optional), "note": string (optional)}.'
    ),
    ToolName.CREATE_BREAK: (
        'create_break - the barber will be BUSY for a stretch of time and it is NOT '
        'because of a client (lunch, prayer, errand, personal break). Arguments: '
        '{"start_time": "HH:MM", "end_time": "HH:MM", "note": string (optional)}.'
    ),
    ToolName.ADD_WALKIN: (
        'add_walkin - the barber IS HAVING or is ABOUT TO HAVE a walk-in client right '
        'now or soon, without dictating a phone number. Arguments: {"start_time": '
        '"HH:MM" (optional, omit for "now"), "duration_min": integer (optional, default 30), '
        '"note": string (optional)}.'
    ),
    ToolName.ADD_CLIENT: (
        'add_client - the barber dictates a CLIENT\'S PHONE NUMBER (optionally a name) '
        'to save the client. Arguments: {"phone": string (required), "name": string (optional)}. '
        'Keep a leading "+" if spoken.'
    ),
}

_ROLE_INTRO: dict[str, str] = {
    "customer": (
        "The speaker is a CUSTOMER of the barbershop, booking an appointment by voice. "
        "They speak formal or conversational Uzbek and FREQUENTLY mix in Russian, "
        "especially for numbers and times."
    ),
    "staff": (
        "The speaker is the BARBER (or an apprentice barber) managing their own schedule "
        "by voice. They speak formal or conversational Uzbek and FREQUENTLY mix in Russian, "
        "especially for numbers and times."
    ),
    "barber": (
        "The speaker is the BARBER managing their own appointment day by voice. They speak "
        "formal or conversational Uzbek and FREQUENTLY mix in Russian, especially for numbers and times."
    ),
}

_SHARED_RULES = """\
TIME RULES:
- Normalise EVERY time to 24-hour HH:MM in the shop's local time (zero-padded, e.g. 09:05, 14:30, 18:00).
- Russian half-hour idioms: "polovina pyatogo" / "yarim besh" mean 04:30 (half BEFORE five), not 05:30.
  "bez pyatnadtsati shest" means 17:45. "v dva (chasa)" / "soat ikkida" in working hours means 14:00.

OUTPUT RULES (critical):
- Output ONLY a single JSON object. No prose, no explanation, no markdown, no code fences.
- The object MUST have exactly these keys: "tool", "arguments", "confidence".
- "arguments" contains only the fields defined for the chosen tool (empty object {} when tool is "none").
- "confidence" is a number from 0 to 1.
- If several intents are present, pick the single PRIMARY one.
- If the request does not clearly match an available tool, return {"tool": "none", "arguments": {}, "confidence": <low>}.
"""


def system_prompt_for_role(role: str | None) -> str:
    role_key = (role or "barber").strip().lower()
    if role_key not in ROLE_TOOLS:
        role_key = "barber"
    intro = _ROLE_INTRO.get(role_key, _ROLE_INTRO["barber"])
    tools = tools_for_role(role_key)
    tool_lines = "\n".join(f"{i + 1}. {_TOOL_DOCS[t]}" for i, t in enumerate(tools))
    return (
        f"You are the intent parser for a single barbershop's scheduling bot. {intro}\n\n"
        "Choose the single best-matching tool for what was just said and return its arguments.\n\n"
        f"TOOLS (choose exactly one, or \"none\"):\n{tool_lines}\n\n"
        f"{_SHARED_RULES}"
    )


def build_messages(
    transcript: str, role: str | None = "barber", *, validation_error: str | None = None
) -> list[dict[str, str]]:
    """Construct the chat messages for Ollama, tailored to the speaker's role."""

    user_content = transcript.strip()
    if validation_error:
        user_content = (
            f"{user_content}\n\n"
            "Your previous answer was rejected by the schema validator with this error:\n"
            f"{validation_error}\n"
            'Reply again with ONLY the corrected JSON object '
            '(keys: "tool", "arguments", "confidence"), nothing else.'
        )
    return [
        {"role": "system", "content": system_prompt_for_role(role)},
        {"role": "user", "content": user_content},
    ]
