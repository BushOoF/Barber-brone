"""Environment-driven configuration, validated with pydantic-settings.

All values come from environment variables (loaded from a local .env in development via
python-dotenv). Fail fast at import time if something required is missing or malformed so the
process never starts in a half-configured state.
"""

from __future__ import annotations

from functools import lru_cache

from dotenv import load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load a local .env if present. In production (Docker / systemd) the variables are usually injected
# by the runtime, and load_dotenv is then a harmless no-op.
load_dotenv()


class Settings(BaseSettings):
    """Strongly-typed application settings.

    Reads from the process environment. Unknown variables are ignored so the same .env can be
    shared with sibling tooling without breaking startup.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    # --- Security -----------------------------------------------------------------------------
    # Shared secret the cloud bot/worker dispatcher must send in the X-Worker-Secret header.
    # REQUIRED and must be non-trivial; we refuse to boot with an empty value.
    WORKER_SHARED_SECRET: str = Field(min_length=8)

    # --- HTTP server --------------------------------------------------------------------------
    PORT: int = Field(default=8000, ge=1, le=65535)
    HOST: str = Field(default="0.0.0.0")

    # --- Whisper (faster-whisper / CTranslate2) -----------------------------------------------
    WHISPER_MODEL: str = Field(default="small")
    WHISPER_DEVICE: str = Field(default="cpu")
    WHISPER_COMPUTE: str = Field(default="int8")
    # Blank => auto-detect language. Otherwise an ISO code like "uz", "ru", "en".
    WHISPER_LANGUAGE: str = Field(default="")

    # --- Ollama -------------------------------------------------------------------------------
    OLLAMA_URL: str = Field(default="http://localhost:11434")
    OLLAMA_MODEL: str = Field(default="gemma4:e4b")
    # Total timeout (seconds) for a single Ollama /api/chat call. CPU inference on a Pi can be
    # slow, so this is generous by default.
    OLLAMA_TIMEOUT_S: float = Field(default=120.0, gt=0)

    # --- Audio / ffmpeg -----------------------------------------------------------------------
    FFMPEG_BIN: str = Field(default="ffmpeg")
    # Hard cap on accepted upload size (bytes) to avoid memory blowups from hostile clients.
    MAX_AUDIO_BYTES: int = Field(default=25 * 1024 * 1024, gt=0)

    # --- Logging ------------------------------------------------------------------------------
    LOG_LEVEL: str = Field(default="INFO")

    @field_validator("WHISPER_LANGUAGE")
    @classmethod
    def _normalise_language(cls, v: str) -> str:
        return v.strip()

    @field_validator("OLLAMA_URL")
    @classmethod
    def _strip_trailing_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @field_validator("LOG_LEVEL")
    @classmethod
    def _upper_log_level(cls, v: str) -> str:
        return v.strip().upper()

    @property
    def whisper_language(self) -> str | None:
        """Return None when the language is blank so faster-whisper auto-detects."""
        return self.WHISPER_LANGUAGE or None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return a cached Settings instance.

    Cached so the (potentially expensive) validation runs exactly once and every module observes
    the same configuration object.
    """
    return Settings()  # type: ignore[call-arg]  # values supplied via environment
