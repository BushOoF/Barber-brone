"""Barber voice-scheduling AI sidecar (Project 1, monolithic).

Stateless FastAPI service: receives a barber's voice note, transcribes it
with faster-whisper, and asks a local Gemma model (via Ollama) to emit exactly
one structured scheduling tool call. No database access lives here.
"""
