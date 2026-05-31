"""Audio handling: persist the incoming voice note and convert it for Whisper.

Telegram voice notes arrive as Opus-in-OGG. faster-whisper wants a mono 16 kHz
PCM stream, so we shell out to ffmpeg exactly as the spec dictates:

    ffmpeg -y -i IN.ogg -ar 16000 -ac 1 -c:a pcm_f32le OUT.wav
"""

from __future__ import annotations

import logging
import subprocess
import tempfile
import uuid
from pathlib import Path

from .config import settings

logger = logging.getLogger(__name__)


class FfmpegError(RuntimeError):
    """Raised when ffmpeg exits non-zero. Carries a trimmed stderr summary."""

    def __init__(self, message: str, stderr: str = "") -> None:
        super().__init__(message)
        self.stderr = stderr


def _summarize_stderr(stderr: str, limit: int = 600) -> str:
    """Return a compact, single-block tail of ffmpeg stderr for error responses."""

    text = (stderr or "").strip()
    if len(text) <= limit:
        return text
    return "...(truncated)... " + text[-limit:]


def write_temp_input(data: bytes, suffix: str = ".ogg") -> Path:
    """Write raw audio bytes to a uniquely named temp file and return its path.

    The caller is responsible for deleting the file (do it in a finally block).
    """

    if not data:
        raise ValueError("empty audio payload")
    # Normalise the suffix; default to .ogg which is what Telegram sends.
    if not suffix.startswith("."):
        suffix = "." + suffix
    tmp_dir = Path(tempfile.gettempdir())
    path = tmp_dir / f"barber-voice-{uuid.uuid4().hex}{suffix}"
    path.write_bytes(data)
    return path


def convert_to_wav(input_path: Path) -> Path:
    """Convert any input audio to mono 16 kHz 32-bit float PCM WAV.

    Returns the output WAV path (caller deletes it). Raises ``FfmpegError`` on a
    non-zero exit so the API layer can surface a 422.
    """

    output_path = input_path.with_name(f"{input_path.stem}-16k.wav")
    cmd = [
        settings.ffmpeg_bin,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(input_path),
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_f32le",
        str(output_path),
    ]
    try:
        proc = subprocess.run(  # noqa: S603 - fixed argv, no shell
            cmd,
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError as exc:
        # ffmpeg binary missing entirely.
        raise FfmpegError(
            f"ffmpeg binary not found ({settings.ffmpeg_bin!r}); install ffmpeg",
            stderr=str(exc),
        ) from exc

    if proc.returncode != 0:
        summary = _summarize_stderr(proc.stderr)
        logger.warning("ffmpeg failed (exit %s): %s", proc.returncode, summary)
        # Best-effort cleanup of any partial output.
        _safe_unlink(output_path)
        raise FfmpegError(f"ffmpeg exited with code {proc.returncode}", stderr=summary)

    if not output_path.exists() or output_path.stat().st_size == 0:
        _safe_unlink(output_path)
        raise FfmpegError("ffmpeg produced no output", stderr=_summarize_stderr(proc.stderr))

    return output_path


def _safe_unlink(path: Path | None) -> None:
    """Delete a file if it exists, swallowing any error."""

    if path is None:
        return
    try:
        path.unlink(missing_ok=True)
    except OSError as exc:  # pragma: no cover - defensive
        logger.debug("could not delete temp file %s: %s", path, exc)


def cleanup(*paths: Path | None) -> None:
    """Delete every provided temp file, ignoring missing ones."""

    for path in paths:
        _safe_unlink(path)
