"""Audio handling: persist the incoming voice note and convert it to whisper-friendly PCM WAV.

Telegram voice notes arrive as OGG/Opus. faster-whisper wants a 16 kHz mono float32 WAV, so we
shell out to ffmpeg exactly as the build spec dictates::

    ffmpeg -y -i IN.ogg -ar 16000 -ac 1 -c:a pcm_f32le OUT.wav

Errors are surfaced as :class:`AudioError` with an HTTP-status hint and a short stderr summary so
the API layer can return a precise status code (422 for bad/undecodable audio) rather than a
silent 500.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
import uuid
from dataclasses import dataclass

from .config import get_settings

logger = logging.getLogger("local_ai_worker.audio")


@dataclass
class AudioError(Exception):
    """Raised when audio cannot be persisted or decoded.

    ``http_status`` lets the route map this to the right response code (typically 422).
    """

    message: str
    http_status: int = 422

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.message


def _new_temp_path(suffix: str) -> str:
    """Return a unique path inside the OS temp dir with the given suffix.

    We build the name ourselves (rather than NamedTemporaryFile) so ffmpeg can own/overwrite the
    output file and we control cleanup explicitly in a finally block.
    """
    name = f"baw_{uuid.uuid4().hex}{suffix}"
    return os.path.join(tempfile.gettempdir(), name)


def write_temp_audio(data: bytes, suffix: str = ".ogg") -> str:
    """Write raw audio bytes to a temp file and return its path.

    Enforces the configured maximum size to defend against memory/disk exhaustion.
    """
    settings = get_settings()
    if not data:
        raise AudioError("Empty audio payload.", http_status=422)
    if len(data) > settings.MAX_AUDIO_BYTES:
        raise AudioError(
            f"Audio too large ({len(data)} bytes > {settings.MAX_AUDIO_BYTES} limit).",
            http_status=413,
        )

    path = _new_temp_path(suffix)
    with open(path, "wb") as fh:
        fh.write(data)
    return path


async def convert_to_wav(src_path: str) -> str:
    """Convert ``src_path`` to 16 kHz mono float32 WAV via ffmpeg; return the output path.

    Runs ffmpeg as an async subprocess so the event loop is never blocked. On a non-zero exit we
    raise :class:`AudioError` (422) with a trimmed stderr summary; the caller is responsible for
    deleting the produced file.
    """
    settings = get_settings()
    out_path = _new_temp_path(".wav")

    cmd = [
        settings.FFMPEG_BIN,
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-i", src_path,
        "-ar", "16000",
        "-ac", "1",
        "-c:a", "pcm_f32le",
        out_path,
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except FileNotFoundError as exc:
        # ffmpeg binary missing — this is an operator/deployment problem, not a client problem.
        raise AudioError(
            f"ffmpeg binary not found ({settings.FFMPEG_BIN}). Install ffmpeg on the host.",
            http_status=503,
        ) from exc

    _, stderr = await proc.communicate()

    if proc.returncode != 0:
        # Clean up a possibly-empty output file before raising.
        cleanup_file(out_path)
        summary = _summarise_stderr(stderr)
        raise AudioError(
            f"ffmpeg failed (exit {proc.returncode}): {summary}",
            http_status=422,
        )

    if not os.path.exists(out_path) or os.path.getsize(out_path) == 0:
        cleanup_file(out_path)
        raise AudioError("ffmpeg produced no output audio.", http_status=422)

    return out_path


def _summarise_stderr(stderr: bytes, max_len: int = 300) -> str:
    """Return a short, single-line summary of ffmpeg stderr for error messages/logs."""
    text = (stderr or b"").decode("utf-8", errors="replace").strip()
    # Collapse to the last meaningful line(s); ffmpeg prints the real error last.
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    tail = " | ".join(lines[-3:]) if lines else "no stderr output"
    return tail[:max_len]


def cleanup_file(path: str | None) -> None:
    """Best-effort removal of a temp file; never raises."""
    if not path:
        return
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as exc:  # pragma: no cover - rare
        logger.warning("Could not remove temp file %s: %s", path, exc)
