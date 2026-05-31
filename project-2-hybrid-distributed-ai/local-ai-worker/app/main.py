"""FastAPI application for the Local AI Worker (Project 2, hybrid).

Endpoints:
  * GET  /healthz        — liveness + Ollama reachability (no auth, no secrets).
  * POST /process-voice  — protected by X-Worker-Secret. Accepts either:
        - multipart/form-data with file field "audio", OR
        - application/json {"audio_base64": "...", "mime": "audio/ogg"}.
      Runs ffmpeg -> faster-whisper -> Ollama and returns
      {transcript, tool, arguments, confidence}.

Error mapping (never a silent 500):
  * ffmpeg / bad audio        -> 422 (or 413 when too large)
  * whisper failure           -> 503
  * Ollama unreachable/timeout -> 503
  * missing/bad worker secret -> 401
"""

from __future__ import annotations

import base64
import binascii
import logging

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.responses import JSONResponse

from . import __version__
from .audio import AudioError, cleanup_file, convert_to_wav, write_temp_audio
from .auth import require_worker_secret
from .config import get_settings
from .ollama_client import OllamaUnavailable, infer_tool_call, ping
from .schemas import JsonAudioRequest, ProcessResponse, ToolName
from .transcribe import TranscriptionError, transcribe_file, warm_up

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("local_ai_worker")

app = FastAPI(
    title="Barber Local AI Worker",
    version=__version__,
    description=(
        "Standalone voice -> tool-call worker for the barber bot (Project 2, hybrid). "
        "Protected by the X-Worker-Secret header."
    ),
)


@app.on_event("startup")
async def _on_startup() -> None:
    """Log config (without secrets) and optionally warm the Whisper model."""
    logger.info(
        "Starting Local AI Worker v%s — whisper=%s/%s/%s, ollama=%s model=%s",
        __version__,
        settings.WHISPER_MODEL,
        settings.WHISPER_DEVICE,
        settings.WHISPER_COMPUTE,
        settings.OLLAMA_URL,
        settings.OLLAMA_MODEL,
    )
    # Warm the model so the first real request isn't penalised by a multi-second load. Non-fatal.
    warm_up()


@app.get("/healthz")
async def healthz() -> dict[str, object]:
    """Liveness + dependency check. Returns 200 even if Ollama is down, but reports its status."""
    ollama_ok = await ping()
    return {
        "status": "ok",
        "version": __version__,
        "whisper_model": settings.WHISPER_MODEL,
        "ollama_model": settings.OLLAMA_MODEL,
        "ollama_reachable": ollama_ok,
    }


async def _read_audio_bytes(request: Request, audio: UploadFile | None) -> tuple[bytes, str]:
    """Extract raw audio bytes + a file suffix from either a multipart upload or a JSON body.

    Returns ``(data, suffix)``. Raises ``HTTPException(400/415/422)`` for malformed input.
    """
    # Path A: multipart file field "audio".
    if audio is not None:
        data = await audio.read()
        suffix = _suffix_from_name_or_mime(audio.filename, audio.content_type)
        return data, suffix

    # Path B: JSON body with base64 audio.
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            body = await request.json()
        except Exception as exc:  # malformed JSON
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid JSON body: {exc}") from exc
        try:
            parsed = JsonAudioRequest.model_validate(body)
        except Exception as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"JSON body must include audio_base64: {exc}",
            ) from exc
        try:
            data = base64.b64decode(parsed.audio_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"audio_base64 is not valid base64: {exc}"
            ) from exc
        suffix = _suffix_from_name_or_mime(None, parsed.mime)
        return data, suffix

    raise HTTPException(
        status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
        'Send multipart/form-data with field "audio", or application/json with "audio_base64".',
    )


def _suffix_from_name_or_mime(filename: str | None, mime: str | None) -> str:
    """Best-effort file suffix for the temp input. ffmpeg sniffs content, so this is only a hint."""
    if filename and "." in filename:
        return "." + filename.rsplit(".", 1)[-1].lower()
    if mime:
        mime = mime.lower()
        if "ogg" in mime or "opus" in mime:
            return ".ogg"
        if "mpeg" in mime or "mp3" in mime:
            return ".mp3"
        if "wav" in mime or "x-wav" in mime:
            return ".wav"
        if "m4a" in mime or "mp4" in mime or "aac" in mime:
            return ".m4a"
    # Telegram voice notes are OGG/Opus; default accordingly.
    return ".ogg"


@app.post(
    "/process-voice",
    response_model=ProcessResponse,
    dependencies=[Depends(require_worker_secret)],
)
async def process_voice(
    request: Request,
    audio: UploadFile | None = File(default=None),
) -> ProcessResponse:
    """Full pipeline: decode audio -> ffmpeg -> whisper -> Ollama structured tool call.

    Authenticated via the X-Worker-Secret header (see :func:`require_worker_secret`). Temp files
    are always cleaned up in the finally block.
    """
    import asyncio

    data, suffix = await _read_audio_bytes(request, audio)

    src_path: str | None = None
    wav_path: str | None = None
    try:
        # 1) Persist the upload to a temp file (size-checked).
        try:
            src_path = write_temp_audio(data, suffix=suffix)
        except AudioError as exc:
            raise HTTPException(exc.http_status, str(exc)) from exc

        # 2) Convert to 16k mono f32 WAV.
        try:
            wav_path = await convert_to_wav(src_path)
        except AudioError as exc:
            raise HTTPException(exc.http_status, str(exc)) from exc

        # 3) Transcribe (CPU-bound -> run in a thread so we don't block the event loop).
        try:
            transcript = await asyncio.to_thread(transcribe_file, wav_path)
        except TranscriptionError as exc:
            logger.error("Transcription error: %s", exc)
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, f"Transcription failed: {exc}"
            ) from exc

        # 4) Infer the tool call (with internal single retry; returns 'none' on unparseable output).
        try:
            call = await infer_tool_call(transcript)
        except OllamaUnavailable as exc:
            logger.error("Ollama unavailable: %s", exc)
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, f"AI model unavailable: {exc}"
            ) from exc

        return ProcessResponse(
            transcript=transcript,
            tool=call.tool,
            arguments=call.arguments if call.tool != ToolName.NONE else {},
            confidence=call.confidence,
        )
    finally:
        # Always clean up temp files, even on error.
        cleanup_file(src_path)
        cleanup_file(wav_path)


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all so an unexpected error becomes a clean JSON 500 (logged), never a bare stack."""
    # HTTPException is handled by FastAPI's own handler; this only catches the truly unexpected.
    logger.exception("Unhandled error processing %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error."},
    )
