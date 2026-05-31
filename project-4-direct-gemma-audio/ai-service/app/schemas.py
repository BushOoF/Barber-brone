"""Pydantic models, role-aware Ollama format schema, and system prompts for the
DIRECT-AUDIO variant (Project 4) — audio goes straight to Gemma 4 (no STT).

Tool surface by role:
  * customer -> book_appointment, cancel_booking
  * staff (barber/apprentice) -> create_break, add_walkin, cancel_break,
        cancel_booking, make_announcement, update_service, update_hours, add_vacation
  * barber (legacy default) -> create_break, add_walkin, add_client
Plus the ``none`` escape hatch. Gemma must emit EXACTLY ONE JSON object.

Relative dates are emitted as a token (today | tomorrow | a weekday | YYYY-MM-DD)
and resolved by the Node side, which has reliable date arithmetic. The current
date is also injected into the prompt as an anchor.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_WEEKDAYS = {"monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}


def _norm_relative_date(v: str | None) -> str | None:
    """Accept today | tomorrow | weekday-name | YYYY-MM-DD (resolved on the Node side)."""
    if v is None:
        return None
    v = v.strip().lower()
    if not v:
        return None
    if v in ("today", "tomorrow") or v in _WEEKDAYS or _DATE_RE.match(v):
        return v
    raise ValueError("date must be 'today', 'tomorrow', a weekday, or YYYY-MM-DD")


def _norm_time(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    if not v:
        return None
    if not _TIME_RE.match(v):
        raise ValueError("time must be 24h HH:MM")
    return v


class ToolName(str, Enum):
    ADD_CLIENT = "add_client"
    CREATE_BREAK = "create_break"
    ADD_WALKIN = "add_walkin"
    BOOK_APPOINTMENT = "book_appointment"
    CANCEL_BREAK = "cancel_break"
    CANCEL_BOOKING = "cancel_booking"
    MAKE_ANNOUNCEMENT = "make_announcement"
    UPDATE_SERVICE = "update_service"
    UPDATE_HOURS = "update_hours"
    ADD_VACATION = "add_vacation"
    NONE = "none"


def _clean_opt(v: str | None) -> str | None:
    return (v.strip() or None) if v is not None else None


class AddClientArgs(BaseModel):
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
    def _cn(cls, v: str | None) -> str | None:
        return _clean_opt(v)


class CreateBreakArgs(BaseModel):
    model_config = {"extra": "ignore"}
    start_time: str
    end_time: str
    date: str | None = None  # today (default) | tomorrow | weekday | YYYY-MM-DD
    note: str | None = None

    @field_validator("start_time", "end_time")
    @classmethod
    def _vt(cls, v: str) -> str:
        v = v.strip()
        if not _TIME_RE.match(v):
            raise ValueError("time must be 24h HH:MM")
        return v

    @field_validator("date")
    @classmethod
    def _vd(cls, v: str | None) -> str | None:
        return _norm_relative_date(v)

    @field_validator("note")
    @classmethod
    def _cn(cls, v: str | None) -> str | None:
        return _clean_opt(v)

    @model_validator(mode="after")
    def _end_after_start(self) -> "CreateBreakArgs":
        if self.end_time <= self.start_time:
            raise ValueError("end_time must be later than start_time")
        return self


class AddWalkinArgs(BaseModel):
    model_config = {"extra": "ignore"}
    start_time: str | None = None
    duration_min: int = 30
    note: str | None = None

    @field_validator("start_time")
    @classmethod
    def _vt(cls, v: str | None) -> str | None:
        return _norm_time(v)

    @field_validator("duration_min")
    @classmethod
    def _vdur(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("duration_min must be positive")
        if v > 600:
            raise ValueError("duration_min unrealistically large")
        return v

    @field_validator("note")
    @classmethod
    def _cn(cls, v: str | None) -> str | None:
        return _clean_opt(v)


class BookAppointmentArgs(BaseModel):
    model_config = {"extra": "ignore"}
    when: Literal["asap", "time"] = "asap"
    time: str | None = None
    date: str | None = None
    note: str | None = None

    @field_validator("time")
    @classmethod
    def _vt(cls, v: str | None) -> str | None:
        return _norm_time(v)

    @field_validator("date")
    @classmethod
    def _vd(cls, v: str | None) -> str | None:
        return _norm_relative_date(v)

    @field_validator("note")
    @classmethod
    def _cn(cls, v: str | None) -> str | None:
        return _clean_opt(v)

    @model_validator(mode="after")
    def _time_required(self) -> "BookAppointmentArgs":
        if self.when == "time" and not self.time:
            raise ValueError("time required when when='time'")
        return self


class CancelBreakArgs(BaseModel):
    """Cancel a break. time/date narrow which one; omit to cancel the only break that day."""
    model_config = {"extra": "ignore"}
    start_time: str | None = None
    date: str | None = None

    @field_validator("start_time")
    @classmethod
    def _vt(cls, v: str | None) -> str | None:
        return _norm_time(v)

    @field_validator("date")
    @classmethod
    def _vd(cls, v: str | None) -> str | None:
        return _norm_relative_date(v)


class CancelBookingArgs(BaseModel):
    """Cancel a booking. time/date narrow which one; omit to cancel the only/soonest upcoming."""
    model_config = {"extra": "ignore"}
    time: str | None = None
    date: str | None = None

    @field_validator("time")
    @classmethod
    def _vt(cls, v: str | None) -> str | None:
        return _norm_time(v)

    @field_validator("date")
    @classmethod
    def _vd(cls, v: str | None) -> str | None:
        return _norm_relative_date(v)


class MakeAnnouncementArgs(BaseModel):
    """Broadcast a message to all customers."""
    model_config = {"extra": "ignore"}
    message: str = Field(..., min_length=1)

    @field_validator("message")
    @classmethod
    def _vm(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be empty")
        return v


class UpdateServiceArgs(BaseModel):
    """Change a service's price and/or duration. ``service`` is a free description
    ('adult haircut', 'child', 'beard', 'wash', ...) mapped on the Node side."""
    model_config = {"extra": "ignore"}
    service: str = Field(..., min_length=1)
    price: int | None = None  # whole currency units (e.g. 60000 for 60 ming so'm)
    duration_min: int | None = None

    @field_validator("service")
    @classmethod
    def _vs(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("service must not be empty")
        return v

    @field_validator("price")
    @classmethod
    def _vp(cls, v: int | None) -> int | None:
        if v is None:
            return None
        if v <= 0 or v > 100_000_000:
            raise ValueError("price out of range")
        return v

    @field_validator("duration_min")
    @classmethod
    def _vdur(cls, v: int | None) -> int | None:
        if v is None:
            return None
        if v <= 0 or v > 600:
            raise ValueError("duration_min out of range")
        return v

    @model_validator(mode="after")
    def _at_least_one(self) -> "UpdateServiceArgs":
        if self.price is None and self.duration_min is None:
            raise ValueError("provide price and/or duration_min")
        return self


class UpdateHoursArgs(BaseModel):
    """Change shop open and/or close time."""
    model_config = {"extra": "ignore"}
    open: str | None = None
    close: str | None = None

    @field_validator("open", "close")
    @classmethod
    def _vt(cls, v: str | None) -> str | None:
        return _norm_time(v)

    @model_validator(mode="after")
    def _at_least_one(self) -> "UpdateHoursArgs":
        if not self.open and not self.close:
            raise ValueError("provide open and/or close")
        if self.open and self.close and self.close <= self.open:
            raise ValueError("close must be after open")
        return self


class AddVacationArgs(BaseModel):
    """Mark a full day closed (day off)."""
    model_config = {"extra": "ignore"}
    date: str = Field(...)
    note: str | None = None

    @field_validator("date")
    @classmethod
    def _vd(cls, v: str) -> str:
        out = _norm_relative_date(v)
        if out is None:
            raise ValueError("date is required")
        return out

    @field_validator("note")
    @classmethod
    def _cn(cls, v: str | None) -> str | None:
        return _clean_opt(v)


_ARG_MODELS: dict[ToolName, type[BaseModel]] = {
    ToolName.ADD_CLIENT: AddClientArgs,
    ToolName.CREATE_BREAK: CreateBreakArgs,
    ToolName.ADD_WALKIN: AddWalkinArgs,
    ToolName.BOOK_APPOINTMENT: BookAppointmentArgs,
    ToolName.CANCEL_BREAK: CancelBreakArgs,
    ToolName.CANCEL_BOOKING: CancelBookingArgs,
    ToolName.MAKE_ANNOUNCEMENT: MakeAnnouncementArgs,
    ToolName.UPDATE_SERVICE: UpdateServiceArgs,
    ToolName.UPDATE_HOURS: UpdateHoursArgs,
    ToolName.ADD_VACATION: AddVacationArgs,
}


def validate_arguments(tool: ToolName, arguments: dict[str, Any]) -> dict[str, Any]:
    if tool is ToolName.NONE:
        return {}
    parsed = _ARG_MODELS[tool].model_validate(arguments or {})
    return parsed.model_dump(exclude_none=False)


class ToolCall(BaseModel):
    model_config = {"extra": "ignore"}
    tool: ToolName
    arguments: dict[str, Any] = Field(default_factory=dict)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)

    @field_validator("arguments", mode="before")
    @classmethod
    def _coerce(cls, v: Any) -> dict[str, Any]:
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


ROLE_TOOLS: dict[str, list[ToolName]] = {
    "customer": [ToolName.BOOK_APPOINTMENT, ToolName.CANCEL_BOOKING],
    "staff": [
        ToolName.CREATE_BREAK,
        ToolName.ADD_WALKIN,
        ToolName.CANCEL_BREAK,
        ToolName.CANCEL_BOOKING,
        ToolName.MAKE_ANNOUNCEMENT,
        ToolName.UPDATE_SERVICE,
        ToolName.UPDATE_HOURS,
        ToolName.ADD_VACATION,
    ],
    "barber": [ToolName.CREATE_BREAK, ToolName.ADD_WALKIN, ToolName.ADD_CLIENT],
}


def tools_for_role(role: str | None) -> list[ToolName]:
    return ROLE_TOOLS.get((role or "barber").strip().lower(), ROLE_TOOLS["barber"])


def format_for_role(role: str | None) -> dict[str, Any]:
    allowed = [t.value for t in tools_for_role(role)] + [ToolName.NONE.value]
    return {
        "type": "object",
        "required": ["tool", "arguments"],
        "properties": {
            "tool": {"type": "string", "enum": allowed},
            "arguments": {"type": "object"},
            "confidence": {"type": "number"},
            "transcript": {"type": "string"},
        },
    }


_TOOL_DOCS: dict[ToolName, str] = {
    ToolName.BOOK_APPOINTMENT: (
        'book_appointment - the customer wants to book a haircut. Earliest/soonest -> {"when":"asap"}. '
        'Specific time -> {"when":"time","time":"HH:MM","date":<date>}. Args: {when, time?, date?, note?}.'
    ),
    ToolName.CANCEL_BOOKING: (
        'cancel_booking - the speaker wants to CANCEL an existing booking. If they name a time/day, '
        'include it. Args: {time?:"HH:MM", date?:<date>}.'
    ),
    ToolName.CREATE_BREAK: (
        'create_break - the barber will be BUSY for a stretch (NOT a client). Args: '
        '{start_time:"HH:MM", end_time:"HH:MM", date?:<date, default today>, note?}.'
    ),
    ToolName.ADD_WALKIN: (
        'add_walkin - the barber is having a walk-in client. Args: {start_time?:"HH:MM" (omit for now), '
        'duration_min? (default 30), note?}.'
    ),
    ToolName.CANCEL_BREAK: (
        'cancel_break - the barber wants to CANCEL/remove a break. Args: {start_time?:"HH:MM", date?:<date>}.'
    ),
    ToolName.MAKE_ANNOUNCEMENT: (
        'make_announcement - the barber wants to ANNOUNCE/broadcast a message to all customers. '
        'Capture the message text. Args: {message: string}.'
    ),
    ToolName.UPDATE_SERVICE: (
        'update_service - change a service PRICE and/or DURATION. service is a short description '
        '("adult haircut"/"child haircut"/"beard"/"wash"). price is the whole-number amount spoken '
        '(e.g. "60 ming" -> 60000). Args: {service: string, price?: integer, duration_min?: integer}.'
    ),
    ToolName.UPDATE_HOURS: (
        'update_hours - change shop OPEN and/or CLOSE time. Args: {open?:"HH:MM", close?:"HH:MM"}.'
    ),
    ToolName.ADD_VACATION: (
        'add_vacation - mark a full day CLOSED / day off. Args: {date:<date, required>, note?}.'
    ),
    ToolName.ADD_CLIENT: (
        'add_client - the barber dictates a CLIENT PHONE NUMBER (optionally a name). '
        'Args: {phone: string (required), name?}.'
    ),
}

_ROLE_INTRO: dict[str, str] = {
    "customer": (
        "The AUDIO is a CUSTOMER of the barbershop speaking. They speak Uzbek and/or Russian "
        "(often mixed in one sentence), sometimes English."
    ),
    "staff": (
        "The AUDIO is the BARBER (or an apprentice) speaking, managing the shop by voice. "
        "They speak Uzbek and/or Russian (often mixed), sometimes English."
    ),
    "barber": (
        "The AUDIO is the BARBER speaking, managing their own day by voice. They speak Uzbek "
        "and/or Russian (often mixed), sometimes English."
    ),
}


def _shared_rules(today: str | None) -> str:
    anchor = f"- Today is {today}. Resolve relative dates from this.\n" if today else ""
    return (
        "TIME & DATE RULES:\n"
        "- Normalise EVERY time to 24-hour HH:MM in local time (e.g. 09:05, 14:30).\n"
        '- Russian half-hour idioms: "polovina pyatogo"/"yarim besh" = 04:30 (half BEFORE five). '
        '"v dva"/"soat ikkida" in working hours = 14:00.\n'
        f"{anchor}"
        "- For any DATE, output one of: \"today\", \"tomorrow\", a weekday name "
        "(monday..sunday), or \"YYYY-MM-DD\". Prefer the weekday word when the speaker names a day.\n\n"
        "OUTPUT RULES (critical):\n"
        "- Output ONLY a single JSON object. No prose, no markdown, no code fences.\n"
        '- Keys: "tool", "arguments", "confidence" (0..1), and "transcript".\n'
        '- "transcript" = EXACTLY what you heard the speaker say, in their own language.\n'
        '- "arguments" contains only the fields for the chosen tool (empty {} when tool is "none").\n'
        '- If unclear, use {"tool": "none", "arguments": {}}.'
    )


def system_prompt_for_role(role: str | None, today: str | None = None) -> str:
    role_key = (role or "barber").strip().lower()
    if role_key not in ROLE_TOOLS:
        role_key = "barber"
    intro = _ROLE_INTRO.get(role_key, _ROLE_INTRO["barber"])
    tools = tools_for_role(role_key)
    tool_lines = "\n".join(f"{i + 1}. {_TOOL_DOCS[t]}" for i, t in enumerate(tools))
    return (
        f"You are the intent parser for a single barbershop's scheduling bot. {intro}\n\n"
        "Listen to the audio, then choose the single best-matching tool and return its arguments.\n\n"
        f"TOOLS (choose exactly one, or \"none\"):\n{tool_lines}\n\n"
        f"{_shared_rules(today)}"
    )
