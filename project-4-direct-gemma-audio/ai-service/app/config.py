"""Environment configuration.

All settings come from environment variables (optionally loaded from a local
.env file via python-dotenv). Values are read once at import time and exposed
through a frozen ``settings`` singleton so the rest of the app never touches
``os.environ`` directly.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

from dotenv import load_dotenv

# Load a sibling .env if present. In production (Docker) real env vars win
# because load_dotenv does not override already-set variables by default.
load_dotenv()


def _get_str(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip()


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw.strip())
    except ValueError as exc:  # pragma: no cover - defensive
        raise ValueError(f"Environment variable {name} must be an integer, got {raw!r}") from exc


@dataclass(frozen=True)
class Settings:
    """Immutable runtime configuration."""

    # HTTP server
    port: int

    # Whisper / STT
    whisper_model: str
    whisper_device: str
    whisper_compute: str
    # Blank string means auto-detect language; we normalise that to None.
    whisper_language: str | None

    # Ollama / LLM
    ollama_url: str
    ollama_model: str
    ollama_timeout_s: float

    # ffmpeg binary (overridable for non-standard installs)
    ffmpeg_bin: str

    @property
    def ollama_chat_endpoint(self) -> str:
        return f"{self.ollama_url.rstrip('/')}/api/chat"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Build the settings singleton from the environment."""

    language = _get_str("WHISPER_LANGUAGE", "")
    return Settings(
        port=_get_int("PORT", 8000),
        whisper_model=_get_str("WHISPER_MODEL", "small"),
        whisper_device=_get_str("WHISPER_DEVICE", "cpu"),
        whisper_compute=_get_str("WHISPER_COMPUTE", "int8"),
        whisper_language=language or None,
        ollama_url=_get_str("OLLAMA_URL", "http://localhost:11434"),
        ollama_model=_get_str("OLLAMA_MODEL", "gemma4:e4b"),
        ollama_timeout_s=float(_get_int("OLLAMA_TIMEOUT_MS", 60000)) / 1000.0,
        ffmpeg_bin=_get_str("FFMPEG_BIN", "ffmpeg"),
    )


# Convenience module-level singleton for ergonomic imports.
settings = get_settings()
