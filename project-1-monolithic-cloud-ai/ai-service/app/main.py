"""FastAPI entrypoint for the barber voice-scheduling AI sidecar.

Endpoints:
  * GET  /healthz        - liveness probe.
  * POST /process-voice  - accept a voice note (multipart field ``audio`` OR a
                           JSON body {audio_base64, mime}) and return the
                           transcript plus the single best-matching tool call.

The whole pipeline is stateless. Temp files are always removed in a finally
block. Errors map to deterministic status codes (never a silent 500):
  * ffmpeg non-zero exit -> 422
  * whisper failure      -> 503
  * Ollama unreachable   -> 503
"""

from __future__ import annotations

import base64
import binascii
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from . import audio, transcribe
from .config import settings
from .ollama_client import OllamaUnavailableError, classify
from .schemas import JsonAudioRequest, ProcessVoiceResponse

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("ai-service")

# Telegram voice notes are small; cap accepted payloads to avoid abuse. 25 MB is
# generous (a few minutes of Opus). Mirrors Telegram's own bot file ceiling.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Warm the Whisper model so the first real request is not penalised. Failure
    # here is non-fatal; the first /process-voice call will surface a 503 if the
    # model truly cannot load.
    transcribe.warmup()
    yield


app = FastAPI(
    title="Barber Voice Scheduling AI Sidecar",
    version="1.0.0",
    summary="Stateless STT + intent extraction for the barbershop bot (Project 1).",
    lifespan=lifespan,
)


# --------------------------------------------------------------------------- #
# Health                                                                       #
# --------------------------------------------------------------------------- #
@app.get("/healthz")
async def healthz() -> dict:
    return {
        "status": "ok",
        "whisper_model": settings.whisper_model,
        "ollama_model": settings.ollama_model,
    }


# --------------------------------------------------------------------------- #
# Voice processing                                                             #
# --------------------------------------------------------------------------- #
async def _read_audio_payload(
    request: Request, audio_file: UploadFile | None
) -> tuple[bytes, str]:
    """Return (audio_bytes, file_suffix) from either multipart or JSON body."""

    if audio_file is not None:
        data = await audio_file.read()
        if not data:
            raise HTTPException(status_code=400, detail="uploaded 'audio' file is empty")
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio file too large")
        suffix = _suffix_from_filename(audio_file.filename) or ".ogg"
        return data, suffix

    # No multipart file -> try JSON {audio_base64, mime}.
    try:
        body = await request.json()
    except Exception:  # noqa: BLE001 - not JSON and no file => bad request
        raise HTTPException(
            status_code=400,
            detail="provide an 'audio' multipart file or a JSON body with 'audio_base64'",
        ) from None

    try:
        parsed = JsonAudioRequest.model_validate(body)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail=f"invalid JSON body: {exc}") from exc

    try:
        data = base64.b64decode(parsed.audio_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"audio_base64 is not valid base64: {exc}") from exc

    if not data:
        raise HTTPException(status_code=400, detail="decoded audio is empty")
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="audio payload too large")

    return data, _suffix_from_mime(parsed.mime)


def _suffix_from_filename(filename: str | None) -> str | None:
    if not filename:
        return None
    suffix = Path(filename).suffix.lower()
    return suffix or None


def _suffix_from_mime(mime: str | None) -> str:
    """Best-effort container suffix from a mime type; defaults to .ogg."""

    if not mime:
        return ".ogg"
    mime = mime.split(";", 1)[0].strip().lower()
    mapping = {
        "audio/ogg": ".ogg",
        "audio/opus": ".ogg",
        "audio/oga": ".ogg",
        "audio/mpeg": ".mp3",
        "audio/mp3": ".mp3",
        "audio/mp4": ".m4a",
        "audio/x-m4a": ".m4a",
        "audio/aac": ".aac",
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/webm": ".webm",
    }
    # ffmpeg sniffs the real format anyway; the suffix is just a hint.
    return mapping.get(mime, ".ogg")


@app.post("/process-voice", response_model=ProcessVoiceResponse)
async def process_voice(
    request: Request,
    audio_file: UploadFile | None = File(default=None, alias="audio"),
    role: str = "barber",
) -> ProcessVoiceResponse:
    audio_bytes, suffix = await _read_audio_payload(request, audio_file)

    input_path: Path | None = None
    wav_path: Path | None = None
    try:
        # 1) Persist incoming audio to a temp file.
        input_path = audio.write_temp_input(audio_bytes, suffix=suffix)

        # 2) Convert to 16 kHz mono PCM WAV via ffmpeg.
        try:
            wav_path = audio.convert_to_wav(input_path)
        except audio.FfmpegError as exc:
            # Bad/undecodable audio -> 422 with a stderr summary.
            raise HTTPException(
                status_code=422,
                detail=f"could not decode audio: {exc} ({exc.stderr})".strip(),
            ) from exc

        # 3) Transcribe with faster-whisper.
        try:
            transcript = transcribe.transcribe(wav_path)
        except transcribe.TranscriptionError as exc:
            raise HTTPException(status_code=503, detail=f"transcription unavailable: {exc}") from exc

        # 4) Classify into a single tool call via Ollama (with one retry inside).
        try:
            tool, arguments, confidence = classify(transcript, role)
        except OllamaUnavailableError as exc:
            raise HTTPException(status_code=503, detail=f"language model unavailable: {exc}") from exc

        return ProcessVoiceResponse(
            transcript=transcript,
            tool=tool,
            arguments=arguments,
            confidence=confidence,
        )
    finally:
        # 5) Always clean up temp files, success or failure.
        audio.cleanup(input_path, wav_path)


# --------------------------------------------------------------------------- #
# Make sure unexpected errors are still structured JSON (never a bare 500 page) #
# --------------------------------------------------------------------------- #
@app.exception_handler(Exception)
async def _unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    # HTTPException is handled by FastAPI itself; this catches genuinely
    # unexpected errors so the bot always receives JSON.
    logger.exception("unhandled error in AI sidecar: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "internal error in AI sidecar"})


def main() -> None:
    """Run the service with uvicorn (used by ``python -m app.main``)."""

    import uvicorn

    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",  # noqa: S104 - bound inside the container/VM; reached over localhost
        port=settings.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
