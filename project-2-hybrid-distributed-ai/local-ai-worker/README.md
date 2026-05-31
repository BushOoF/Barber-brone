# Local AI Worker — Project 2 (Hybrid, distributed AI)

A **standalone Python FastAPI service** that turns a barber's Telegram **voice note** into a single
structured **tool call** (`add_client` / `create_break` / `add_walkin` / `none`).

It runs **on a local machine** — a Raspberry Pi 5 or a local PC sitting in the barbershop / at home —
and is reached by the **cloud-hosted bot** over a **secure tunnel** (cloudflared or ngrok). Because
that tunnel is public, every request must present a shared secret in the `X-Worker-Secret` header;
anything else gets `401`.

Pipeline (identical audio path to Project 1's `ai-service`, but auth-gated):

```
voice (.ogg/opus)  ──►  ffmpeg (16 kHz mono f32 WAV)  ──►  faster-whisper (STT)  ──►  Ollama gemma4:e4b
                                                                                          │ structured output
                                                                                          ▼
                                                  { transcript, tool, arguments, confidence }
```

> **Self-contained.** This folder has its own `requirements.txt`, `app/*`, `Dockerfile`,
> `.env.example`, and this README. It imports nothing from sibling projects. Copy this folder to a
> Pi/PC and it runs with only the steps below.

---

## How this fits the deployment strategy

Project 2 is the **hybrid / distributed** design: cheap, always-on **cloud bot** (handles Telegram,
DB, reminders) + a **heavy AI brain that lives locally** where you already have a capable CPU/GPU and
don't pay per-minute cloud GPU costs.

- The **cloud bot** receives the voice note, downloads the `.ogg`, and `POST`s it to this worker at
  `AI_SERVICE_URL/process-voice` **with the `X-Worker-Secret` header**.
- This worker (private machine) does the expensive STT + LLM work and returns the tool call JSON.
- The bot shows a **Confirm / Cancel** inline keyboard and only commits on Confirm.

The worker has **no database** and stores nothing between requests — it is a stateless AI endpoint.
The shared secret + tunnel are what make it safe to expose a home machine to the cloud bot.

---

## Prerequisites

- **Python 3.11**
- **ffmpeg** on `PATH` (`ffmpeg -version` should work)
- **Ollama** running locally with the `gemma4:e4b` model pulled (see below)
- A tunnel tool to expose the port publicly: **cloudflared** or **ngrok**
- First run downloads the Whisper model weights (a few hundred MB for `small`) — needs internet once

---

## 1. Pull the model with Ollama

Install Ollama from <https://ollama.com/download>, then:

```bash
ollama pull gemma4:e4b      # the model this worker calls (matches OLLAMA_MODEL)
ollama serve                # if not already running as a service; listens on :11434
```

Sanity check:

```bash
ollama list                 # gemma4:e4b should appear
curl http://localhost:11434/api/tags   # should return JSON
```

If `gemma4:e4b` is not available in your Ollama registry, pull the closest Gemma variant you have
access to and set `OLLAMA_MODEL` in `.env` accordingly — nothing else changes.

---

## 2. Configure

```bash
cp .env.example .env
```

Edit `.env` and set at least:

- `WORKER_SHARED_SECRET` — a long random string. Generate one with `openssl rand -hex 32`.
  **This must be identical** to the cloud bot's `WORKER_SHARED_SECRET`.
- `WHISPER_MODEL` — `small` on a PC; `base`/`tiny` on a Pi 5 (see model-size notes below).

### Environment variables

| Variable               | Default                  | Description                                                                 |
| ---------------------- | ------------------------ | --------------------------------------------------------------------------- |
| `WORKER_SHARED_SECRET` | _(required, min 8)_      | Secret required in the `X-Worker-Secret` header. Must match the cloud bot.  |
| `PORT`                 | `8000`                   | HTTP port the worker listens on.                                            |
| `HOST`                 | `0.0.0.0`                | Bind address.                                                               |
| `WHISPER_MODEL`        | `small`                  | faster-whisper model size (`tiny`/`base`/`small`/`medium`/`large-v3`).      |
| `WHISPER_DEVICE`       | `cpu`                    | `cpu` or `cuda`.                                                            |
| `WHISPER_COMPUTE`      | `int8`                   | CTranslate2 compute type (`int8`, `int8_float16`, `float16`, …).            |
| `WHISPER_LANGUAGE`     | _(blank = auto)_         | Force a language code (e.g. `uz`, `ru`) or leave blank to auto-detect.      |
| `OLLAMA_URL`           | `http://localhost:11434` | Base URL of the Ollama server (reachable **from this worker**).             |
| `OLLAMA_MODEL`         | `gemma4:e4b`             | Model name passed to Ollama `/api/chat`.                                    |
| `OLLAMA_TIMEOUT_S`     | `120`                    | Per-request timeout for Ollama (seconds). Bump up on slow ARM CPUs.         |
| `FFMPEG_BIN`           | `ffmpeg`                 | ffmpeg binary path/name.                                                    |
| `MAX_AUDIO_BYTES`      | `26214400` (25 MiB)      | Reject uploads larger than this.                                            |
| `LOG_LEVEL`            | `INFO`                   | `DEBUG` also logs transcripts (may contain phone numbers — avoid in prod).  |

---

## 3. Run

### Local dev

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Health check (no auth):

```bash
curl http://localhost:8000/healthz
# {"status":"ok","version":"1.0.0","whisper_model":"small","ollama_model":"gemma4:e4b","ollama_reachable":true}
```

Send a voice note (multipart) **with the secret**:

```bash
curl -X POST http://localhost:8000/process-voice \
  -H "X-Worker-Secret: <your WORKER_SHARED_SECRET>" \
  -F "audio=@sample.ogg"
# { "transcript": "...", "tool": "add_walkin", "arguments": {"duration_min":30}, "confidence": 0.9 }
```

Without the header (or wrong value) you get `401`:

```bash
curl -i -X POST http://localhost:8000/process-voice -F "audio=@sample.ogg"
# HTTP/1.1 401 Unauthorized
```

JSON / base64 alternative:

```bash
curl -X POST http://localhost:8000/process-voice \
  -H "X-Worker-Secret: <secret>" \
  -H "Content-Type: application/json" \
  -d "{\"audio_base64\":\"$(base64 -w0 sample.ogg)\",\"mime\":\"audio/ogg\"}"
```

### Docker

```bash
docker build -t barber-local-ai-worker .

# Ollama on the host: Linux can use --network host; otherwise point OLLAMA_URL at the host gateway.
docker run --rm -p 8000:8000 \
  --env-file .env \
  -e OLLAMA_URL=http://host.docker.internal:11434 \
  -v "$(pwd)/models:/models" \
  barber-local-ai-worker
```

- `-v .../models:/models` persists the downloaded Whisper weights between container restarts
  (the image sets `HF_HOME=/models`).
- On **Linux**, reach a host-local Ollama with `--add-host=host.docker.internal:host-gateway`
  (or run with `--network host` and `OLLAMA_URL=http://localhost:11434`).
- The image is multi-arch: it builds and runs on **arm64** (Raspberry Pi 5) as-is.

---

## 4. Expose it via a secure tunnel

The cloud bot needs a public HTTPS URL pointing at this worker's `PORT`. The `X-Worker-Secret`
header is what protects the endpoint — keep that secret strong.

### Option A — cloudflared (recommended for an always-on box)

Quick (ephemeral) tunnel for testing:

```bash
cloudflared tunnel --url http://localhost:8000
# prints https://<random>.trycloudflare.com  -> use this as AI_SERVICE_URL on the bot
```

Named, durable tunnel (survives restarts, stable hostname):

```bash
cloudflared tunnel login
cloudflared tunnel create barber-ai
# Map a hostname to the local service:
cloudflared tunnel route dns barber-ai ai.example.com
cloudflared tunnel run --url http://localhost:8000 barber-ai
```

Then on the **cloud bot** set:

```
AI_SERVICE_URL=https://ai.example.com        # or the trycloudflare URL
WORKER_SHARED_SECRET=<same secret as here>
```

### Option B — ngrok

```bash
ngrok config add-authtoken <your-token>
ngrok http 8000
# Forwarding https://<id>.ngrok-free.app -> http://localhost:8000
```

Use the `https://…ngrok…` URL as the bot's `AI_SERVICE_URL`.

> Whichever tunnel you use, the bot calls `POST <AI_SERVICE_URL>/process-voice` and **must** send the
> `X-Worker-Secret` header. The tunnel only provides transport; the shared secret provides auth.

---

## Raspberry Pi 5 (ARM) model-size notes

The Pi 5 is a capable ARM64 board but has **no GPU usable for these models** and limited RAM
(4 GB / 8 GB / 16 GB). Pick sizes that keep latency reasonable on CPU.

**Whisper (`WHISPER_MODEL`, `WHISPER_COMPUTE=int8`):**

| Model     | RAM (int8) | Quality (uz/ru) | Pi 5 latency (short clip) | Recommendation                  |
| --------- | ---------- | --------------- | ------------------------- | ------------------------------- |
| `tiny`    | ~0.2 GB    | rough           | ~1–2 s                    | fastest; OK for clear speech    |
| `base`    | ~0.3 GB    | decent          | ~2–4 s                    | **good Pi 5 default**           |
| `small`   | ~0.6 GB    | good            | ~5–10 s                   | use on 8 GB+ if you want quality |
| `medium`+ | ≥1.5 GB    | best            | slow on Pi                | prefer a PC for these           |

Keep `WHISPER_COMPUTE=int8` on the Pi — it's the fastest/lightest path and quantization barely hurts
short command-style utterances.

**Ollama / `gemma4:e4b`:** small Gemma variants run on the Pi 5 CPU but are noticeably slower than on
a PC. Mitigations:

- Bump `OLLAMA_TIMEOUT_S` (e.g. `180`) so the bot doesn't give up mid-inference.
- An **8 GB or 16 GB** Pi 5 is strongly recommended; 4 GB is tight once Whisper + Ollama coexist.
- If the LLM is the bottleneck, run **Ollama on a separate, beefier machine** and point this worker's
  `OLLAMA_URL` at it — the worker and Ollama do **not** have to be on the same host.

For a **local PC**: `WHISPER_MODEL=small` (or `medium` on a GPU with `WHISPER_DEVICE=cuda`,
`WHISPER_COMPUTE=float16`) and the defaults are a good starting point.

---

## API reference

### `GET /healthz`
Unauthenticated liveness probe. Returns `200` with `{status, version, whisper_model, ollama_model,
ollama_reachable}`. `ollama_reachable` is `false` if Ollama isn't answering, but the worker itself
still reports healthy.

### `POST /process-voice` (requires `X-Worker-Secret`)
Accepts **either**:
- `multipart/form-data` with a file field named **`audio`**, **or**
- `application/json` body `{ "audio_base64": "<base64>", "mime": "audio/ogg" }`

Returns:

```json
{
  "transcript": "raqami nol to'qson tort ...",
  "tool": "add_client",
  "arguments": { "phone": "+998901234567", "name": "Akmal" },
  "confidence": 0.92
}
```

**Tool surface** (the model emits exactly one; times are 24h `HH:MM`, shop-local):

| tool           | arguments                                                        | meaning                                   |
| -------------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `add_client`   | `phone` (required), `name?`                                      | barber dictates a client phone number     |
| `create_break` | `start_time`, `end_time`, `note?`                                | barber busy for a non-client reason       |
| `add_walkin`   | `start_time?`, `duration_min?` (default 30), `note?`             | barber has / about to have a walk-in       |
| `none`         | `{}`                                                             | intent unclear / no tool matched          |

**Status codes:**

| Code  | When                                                                 |
| ----- | -------------------------------------------------------------------- |
| `200` | Success (including `tool: "none"` when intent is unclear).            |
| `401` | Missing or wrong `X-Worker-Secret`.                                  |
| `413` | Audio larger than `MAX_AUDIO_BYTES`.                                 |
| `415` | Body is neither multipart `audio` nor JSON `audio_base64`.           |
| `422` | ffmpeg could not decode the audio / bad base64 / empty audio.        |
| `503` | Whisper failed, or Ollama unreachable / timed out / model not pulled.|

---

## Notes & internals

- **One tool call, strict JSON.** Ollama is called with `format=<JSON Schema>`, `temperature=0`,
  `stream=false`. The model output is validated with pydantic; on failure the worker does **one**
  retry feeding the validation error back, then falls back to `tool: "none"` (it never 500s on
  unparseable model output).
- **Uzbek + Russian.** The system prompt expects formal/conversational Uzbek with Russian mixed in
  (especially numbers/times) and normalizes everything to 24h `HH:MM` shop-local.
- **Privacy.** Phone numbers are never logged. Transcripts are logged **only at `DEBUG`**. Keep
  `LOG_LEVEL=INFO` in production.
- **Temp files.** Every request writes a temp `.ogg`/`.wav`; both are deleted in a `finally` block
  even on error.
- **Smart-shift out of scope.** This worker only proposes a tool call; conflict checks and the full
  auto-move-later-clients cascade live in the bot/scheduling layer, intentionally not here.
