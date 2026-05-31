# Local AI Worker — container image.
#
# Multi-arch friendly (works on amd64 and arm64 / Raspberry Pi 5). ffmpeg is installed from the
# distro. faster-whisper pulls CTranslate2 wheels for the target arch automatically.
#
# NOTE: this image runs ONLY the worker. Ollama runs separately (on the same host or another
# machine) and is reached via OLLAMA_URL — see the README. The Whisper model is downloaded on
# first use into the cache dir; mount a volume there to avoid re-downloading on each container.

FROM python:3.11-slim

# ffmpeg is required to transcode the incoming OGG/Opus voice notes to WAV.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    # Keep faster-whisper/HuggingFace model downloads in a predictable, mountable location.
    HF_HOME=/models \
    PORT=8000

WORKDIR /app

# Install dependencies first for better layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code.
COPY app ./app

# Run as a non-root user.
RUN useradd --create-home --uid 10001 worker \
    && mkdir -p /models \
    && chown -R worker:worker /app /models
USER worker

EXPOSE 8000

# Simple healthcheck against the unauthenticated liveness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import os,urllib.request,sys; \
        port=os.environ.get('PORT','8000'); \
        sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{port}/healthz', timeout=4).status==200 else 1)"

# Use shell form so $PORT is expanded at runtime.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
