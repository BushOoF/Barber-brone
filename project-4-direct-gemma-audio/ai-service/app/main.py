"""FastAPI entrypoint for the DIRECT-AUDIO voice AI sidecar (Project 4).

Pipeline (no speech-to-text middleman):
  voice bytes -> ffmpeg (16 kHz mono WAV) -> Gemma 4 via Ollama (audio in images[])
              -> single tool call + transcript.

Endpoints:
  * GET  /healthz       - liveness.
  * POST /process-voice - multipart ``audio`` OR JSON {audio_base64, mime}; optional
                          ?role=customer|staff|barber (default barber).

Errors map to deterministic status codes (never a silent 500):
  * ffmpeg non-zero exit -> 422
  * Ollama unreachable   -> 503
"""

from __future__ import annotations

import base64
import binascii
import logging
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from . import audio
from .config import settings
from .ollama_client import OllamaUnavailableError, classify_audio
from .schemas import JsonAudioRequest, ProcessVoiceResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("ai-service")

MAX_AUDIO_BYTES = 25 * 1024 * 1024


app = FastAPI(
    title="Barber Voice AI Sidecar — Direct Audio (Project 4)",
    version="1.0.0",
    summary="Sends voice straight to Gemma 4 (no Whisper). Stateless STT+intent in one call.",
)


@app.get("/healthz")
async def healthz() -> dict:
    return {"status": "ok", "mode": "direct-audio", "ollama_model": settings.ollama_model}


def _suffix_from_filename(filename: str | None) -> str | None:
    if not filename:
        return None
    return Path(filename).suffix.lower() or None


def _suffix_from_mime(mime: str | None) -> str:
    if not mime:
        return ".ogg"
    mime = mime.split(";", 1)[0].strip().lower()
    return {
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
    }.get(mime, ".ogg")


async def _read_audio_payload(request: Request, audio_file: UploadFile | None) -> tuple[bytes, str]:
    if audio_file is not None:
        data = await audio_file.read()
        if not data:
            raise HTTPException(status_code=400, detail="uploaded 'audio' file is empty")
        if len(data) > MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413, detail="audio file too large")
        return data, _suffix_from_filename(audio_file.filename) or ".ogg"

    try:
        body = await request.json()
    except Exception:
        raise HTTPException(
            status_code=400,
            detail="provide an 'audio' multipart file or a JSON body with 'audio_base64'",
        ) from None

    try:
        parsed = JsonAudioRequest.model_validate(body)
    except Exception as exc:
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


@app.post("/process-voice", response_model=ProcessVoiceResponse)
async def process_voice(
    request: Request,
    audio_file: UploadFile | None = File(default=None, alias="audio"),
    role: str = "barber",
    today: str | None = None,
) -> ProcessVoiceResponse:
    audio_bytes, suffix = await _read_audio_payload(request, audio_file)

    input_path: Path | None = None
    wav_path: Path | None = None
    try:
        input_path = audio.write_temp_input(audio_bytes, suffix=suffix)
        try:
            wav_path = audio.convert_to_wav(input_path)
        except audio.FfmpegError as exc:
            raise HTTPException(status_code=422, detail=f"could not decode audio: {exc} ({exc.stderr})".strip()) from exc

        wav_bytes = Path(wav_path).read_bytes()

        try:
            tool, arguments, confidence, transcript = classify_audio(wav_bytes, role, today)
        except OllamaUnavailableError as exc:
            raise HTTPException(status_code=503, detail=f"language model unavailable: {exc}") from exc

        return ProcessVoiceResponse(
            transcript=transcript,
            tool=tool,
            arguments=arguments,
            confidence=confidence,
        )
    finally:
        audio.cleanup(input_path, wav_path)


@app.exception_handler(Exception)
async def _unhandled(_request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error in AI sidecar: %s", exc)
    return JSONResponse(status_code=500, content={"detail": "internal error in AI sidecar"})


def main() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.port, log_level="info")  # noqa: S104


if __name__ == "__main__":
    main()
