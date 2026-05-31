"""Speech-to-text using faster-whisper (CTranslate2).

The :class:`WhisperModel` is heavy to construct, so we build it lazily and keep a single shared
instance for the process lifetime. Transcription itself is synchronous/CPU-bound, so the API layer
runs it in a worker thread to avoid blocking the event loop.
"""

from __future__ import annotations

import logging
import threading

from .config import get_settings

logger = logging.getLogger("local_ai_worker.transcribe")

# Lazily-initialised singleton + a lock so concurrent first-requests don't load the model twice.
_model = None
_model_lock = threading.Lock()


class TranscriptionError(Exception):
    """Raised when STT fails (model load error or decode error)."""


def get_model():
    """Return the shared WhisperModel, constructing it on first use.

    Importing faster-whisper is deferred to here so the module imports cheaply (useful for tests
    and for the /healthz path that must not pay model-load cost).
    """
    global _model
    if _model is not None:
        return _model

    with _model_lock:
        if _model is not None:  # re-check inside the lock
            return _model

        settings = get_settings()
        try:
            from faster_whisper import WhisperModel  # imported lazily; large dependency
        except ImportError as exc:  # pragma: no cover - environment problem
            raise TranscriptionError(
                "faster-whisper is not installed. Run: pip install -r requirements.txt"
            ) from exc

        logger.info(
            "Loading Whisper model '%s' (device=%s, compute=%s) — first load may take a while…",
            settings.WHISPER_MODEL,
            settings.WHISPER_DEVICE,
            settings.WHISPER_COMPUTE,
        )
        try:
            _model = WhisperModel(
                settings.WHISPER_MODEL,
                device=settings.WHISPER_DEVICE,
                compute_type=settings.WHISPER_COMPUTE,
            )
        except Exception as exc:  # broad: surface any CTranslate2/model issue as our error
            raise TranscriptionError(f"Failed to load Whisper model: {exc}") from exc

        logger.info("Whisper model loaded.")
        return _model


def transcribe_file(wav_path: str) -> str:
    """Transcribe a 16 kHz mono WAV file to text (blocking; run me in a thread).

    Uses VAD filtering to drop silence and the configured language (or auto-detect when blank).
    Returns the concatenated, stripped transcript.
    """
    settings = get_settings()
    model = get_model()

    try:
        segments, info = model.transcribe(
            wav_path,
            vad_filter=True,
            language=settings.whisper_language,  # None => auto-detect
            beam_size=5,
        )
        # ``segments`` is a generator; materialise it (this is where decoding actually happens).
        text = "".join(segment.text for segment in segments).strip()
    except Exception as exc:  # broad: any decode failure should be a 503, not a crash
        raise TranscriptionError(f"Transcription failed: {exc}") from exc

    # Transcripts may contain phone numbers etc. — log only at debug level, never higher.
    logger.debug(
        "Transcribed (lang=%s, p=%.2f): %r",
        getattr(info, "language", "?"),
        getattr(info, "language_probability", 0.0),
        text,
    )
    return text


def warm_up() -> None:
    """Eagerly load the model (called optionally at startup) so the first request is fast.

    Failures here are logged but not fatal — the worker can still boot and report errors per
    request, which is friendlier for deployment troubleshooting.
    """
    try:
        get_model()
    except TranscriptionError as exc:  # pragma: no cover - startup convenience
        logger.warning("Whisper warm-up failed (will retry on first request): %s", exc)
