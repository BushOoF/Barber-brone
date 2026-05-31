"""Local AI Worker — standalone voice-to-tool-call service for the Barber bot (Project 2, hybrid).

Pipeline: ogg -> ffmpeg (16k mono f32 wav) -> faster-whisper STT -> Ollama (gemma) structured tool call.
Runs on a local machine (Raspberry Pi 5 / local PC) and is exposed to the cloud bot via a secure
tunnel (cloudflared / ngrok). Every request must carry a valid X-Worker-Secret header.
"""

__version__ = "1.0.0"
