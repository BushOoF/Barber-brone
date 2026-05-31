"""Speech-to-text via faster-whisper.

The ``WhisperModel`` is expensive to construct (it loads CTranslate2 weights), so
we build it lazily on first use and cache the single instance for the process.
Loading is guarded by a lock so concurrent first requests don't race.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path

from faster_whisper import WhisperModel

from .config import settings

logger = logging.getLogger(__name__)


class TranscriptionError(RuntimeError):
    """Raised when Whisper fails to load or to transcribe."""


_model: WhisperModel | None = None
_model_lock = threading.Lock()


def get_model() -> WhisperModel:
    """Return the process-wide WhisperModel, constructing it on first call."""

    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is None:  # double-checked locking
            logger.info(
                "loading whisper model=%s device=%s compute=%s",
                settings.whisper_model,
                settings.whisper_device,
                settings.whisper_compute,
            )
            try:
                _model = WhisperModel(
                    settings.whisper_model,
                    device=settings.whisper_device,
                    compute_type=settings.whisper_compute,
                )
            except Exception as exc:  # noqa: BLE001 - surface as a clear 503 upstream
                raise TranscriptionError(f"failed to load whisper model: {exc}") from exc
    return _model


def warmup() -> None:
    """Eagerly load the model (used at startup so the first request is fast)."""

    try:
        get_model()
    except TranscriptionError as exc:
        # Non-fatal at startup: log and let the first real request retry/surface it.
        logger.warning("whisper warmup skipped: %s", exc)


def transcribe(wav_path: Path) -> str:
    """Transcribe a 16 kHz mono WAV file and return the joined transcript text.

    Uses VAD filtering. Language is taken from config (blank => auto-detect).
    Raises ``TranscriptionError`` on failure.
    """

    model = get_model()
    try:
        segments, info = model.transcribe(
            str(wav_path),
            vad_filter=True,
            language=settings.whisper_language,
        )
        # ``segments`` is a generator; consuming it runs the actual inference.
        text = "".join(segment.text for segment in segments).strip()
    except Exception as exc:  # noqa: BLE001 - surface as 503 upstream
        raise TranscriptionError(f"whisper transcription failed: {exc}") from exc

    logger.debug(
        "transcription complete (lang=%s, prob=%.2f): %s",
        getattr(info, "language", "?"),
        getattr(info, "language_probability", 0.0),
        text,
    )
    return text
