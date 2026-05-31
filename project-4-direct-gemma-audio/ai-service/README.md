# Barber Voice AI Sidecar — Project 1 (monolithic)

Stateless Python service that turns a barber's Telegram **voice note** into a
single structured **scheduling tool call**. It does the speech-to-text and the
intent extraction; it has **no database** and stores nothing.

It is one half of Project 1: the Node/grammY bot owns Telegram, Postgres and the
scheduling logic, and calls this sidecar over **localhost** for every voice note.

## What it does

```
voice note (.ogg)
  → ffmpeg  : transcode to 16 kHz mono PCM WAV
  → whisper : faster-whisper transcription (VAD filtered)
  → Ollama  : Gemma emits ONE tool call as strict JSON (temperature 0)
  → returns : { transcript, tool, arguments, confidence }
```

### Tool surface

The model must return **exactly one** of these (or `none`):

| tool           | meaning                                             | arguments |
|----------------|-----------------------------------------------------|-----------|
| `add_client`   | barber dictates a client's phone number             | `phone` (required, string), `name?` |
| `create_break` | barber is busy and it is **not** for a client       | `start_time` "HH:MM", `end_time` "HH:MM", `note?` |
| `add_walkin`   | barber is having / about to have a walk-in client   | `start_time?` "HH:MM", `duration_min?` int (default 30), `note?` |
| `none`         | intent unclear                                      | `{}` |

The barber speaks Uzbek, frequently code-switching into Russian (especially for
numbers and times). All times are normalised to 24h `HH:MM` in shop local time.
The Node bot is responsible for resolving those clock times against the current
date/timezone and for the **Confirm/Cancel** step — this sidecar never commits
anything.

## API

### `GET /healthz`
Liveness probe. Returns `{"status":"ok", ...}`.

### `POST /process-voice`
Accepts the audio two ways:

* **multipart/form-data** with a file field named `audio` (what the bot uses), or
* **application/json** body `{ "audio_base64": "...", "mime": "audio/ogg" }`.

Response:

```json
{
  "transcript": "soat ikkida mijoz keladi yarim soatga",
  "tool": "add_walkin",
  "arguments": { "start_time": "14:00", "duration_min": 30, "note": null },
  "confidence": 0.82
}
```

Error codes (never a silent 500):

| status | when |
|--------|------|
| 400    | no audio supplied / empty payload |
| 413    | audio larger than 25 MB |
| 422    | base64 invalid, or **ffmpeg** could not decode the audio (stderr summary included) |
| 503    | **whisper** failed, or **Ollama** unreachable / timed out / errored |

On a *validation* failure of the model output the service does **one** corrective
retry; if that still fails it returns `tool: "none"` (HTTP 200) rather than erroring.

## Prerequisites

- **Python 3.11**
- **ffmpeg** on `PATH` (audio transcoding)
- A running **Ollama** with the configured model pulled, e.g.
  `ollama pull gemma4:e4b`
- First run downloads the faster-whisper weights for `WHISPER_MODEL` (cached
  afterwards). CPU + `int8` is the default and needs no GPU.

## Run locally (dev)

```bash
cd project-1-monolithic-cloud-ai/ai-service

python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env          # adjust if needed

# make sure ffmpeg + ollama are available:
ffmpeg -version
ollama list

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
# or: python -m app.main
```

Smoke test:

```bash
curl http://localhost:8000/healthz
curl -F "audio=@sample.ogg" http://localhost:8000/process-voice
```

## Run with Docker

The image bundles ffmpeg; it still needs to reach an Ollama instance.

```bash
cd project-1-monolithic-cloud-ai/ai-service
docker build -t barber-ai-sidecar .

# Ollama running on the host (Linux): use host networking so localhost works.
docker run --rm -p 8000:8000 \
  --env-file .env \
  -e OLLAMA_URL=http://host.docker.internal:11434 \
  -v barber_whisper_cache:/app/.cache \
  barber-ai-sidecar
```

> On Linux without `host.docker.internal`, either add
> `--add-host=host.docker.internal:host-gateway` or run with `--network host`
> and set `OLLAMA_URL=http://localhost:11434`.
> The named volume persists the downloaded Whisper weights across restarts.

## Environment variables

| Variable           | Default                   | Description |
|--------------------|---------------------------|-------------|
| `PORT`             | `8000`                    | HTTP port the sidecar listens on (called over localhost by the bot). |
| `WHISPER_MODEL`    | `small`                   | faster-whisper model size (`tiny`…`large-v3`). |
| `WHISPER_DEVICE`   | `cpu`                     | `cpu` or `cuda`. |
| `WHISPER_COMPUTE`  | `int8`                    | Compute type (`int8` on CPU; `float16`/`int8_float16` on GPU). |
| `WHISPER_LANGUAGE` | *(blank)*                 | Force a language code (`uz`, `ru`); blank = auto-detect. |
| `OLLAMA_URL`       | `http://localhost:11434`  | Base URL of the Ollama server. |
| `OLLAMA_MODEL`     | `gemma4:e4b`              | Model used for intent extraction. |
| `OLLAMA_TIMEOUT_MS`| `60000`                   | Per-request timeout for the Ollama call (ms). |
| `FFMPEG_BIN`       | `ffmpeg`                  | Override the ffmpeg binary path if not on `PATH`. |

No secrets are required by this service; do not commit a real `.env`.

## How this fits the deployment strategy

Project 1 is the **monolithic, cloud-AI** strategy: the Node bot **and** this
Python sidecar run **on the same host** (one VM / one box), and the bot talks to
the sidecar over `localhost`. Whisper + Ollama therefore run wherever that host
is — typically a cloud VM with enough CPU/RAM (or a GPU) to host the models.
Because the sidecar is stateless, it can be restarted freely, scaled by running
more copies behind the bot, and contains no database credentials. (Project 2
splits this same sidecar onto a separate worker behind a shared-secret header;
here it is intentionally trust-on-localhost with no auth.)

## Layout

```
ai-service/
├─ app/
│  ├─ __init__.py
│  ├─ config.py          # env parsing → frozen settings singleton
│  ├─ schemas.py         # pydantic models, Ollama format schema, system prompt
│  ├─ audio.py           # temp file + ffmpeg ogg→wav conversion
│  ├─ transcribe.py      # lazy faster-whisper model singleton
│  ├─ ollama_client.py   # /api/chat call, format schema, one validation retry
│  └─ main.py            # FastAPI app: /healthz, /process-voice
├─ requirements.txt      # pinned
├─ Dockerfile            # python:3.11-slim + ffmpeg
├─ .dockerignore
├─ .gitignore
├─ .env.example
└─ README.md
```
