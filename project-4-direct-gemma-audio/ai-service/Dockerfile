# Barber voice AI sidecar — Project 1 (monolithic).
# python:3.11-slim + ffmpeg (for audio conversion) + pinned pip deps.
FROM python:3.11-slim

# Avoid interactive prompts; keep Python output unbuffered for clean logs.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PORT=8000

# System dependency: ffmpeg (used via subprocess to transcode ogg -> wav).
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for better layer caching.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Application code.
COPY app ./app

# faster-whisper downloads model weights into this cache on first use; keep it
# on a stable path so a mounted volume can persist it across restarts.
ENV HF_HOME=/app/.cache/huggingface \
    XDG_CACHE_HOME=/app/.cache
RUN mkdir -p /app/.cache

EXPOSE 8000

# Simple container healthcheck hitting the liveness endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD python -c "import os,urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.getenv(\"PORT\",\"8000\")}/healthz').read()" || exit 1

# Bind to all interfaces inside the container; reached over localhost by the bot.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
