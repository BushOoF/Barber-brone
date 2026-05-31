# Project 2 — Hybrid / Distributed AI

A barbershop voice-scheduling Telegram bot split across **two environments** that are
connected by a **secure tunnel**. This split lets the always-on, cheap part live on a
tiny VPS while the heavy AI (speech-to-text + LLM) runs on hardware that is too
expensive to rent in the cloud (a workstation, a home server, a GPU box, etc.).

```
                Telegram                         secure tunnel (HTTPS)
   Barber ───────────────▶  ┌───────────────┐   X-Worker-Secret header   ┌────────────────────┐
   (voice note)             │   cloud-bot    │ ─────────────────────────▶ │  local-ai-worker   │
                            │  (this folder) │                            │  (sibling folder)  │
   Barber ◀───────────────  │  Node + grammY │ ◀───────────────────────── │  FastAPI + Whisper │
   (confirm keyboard)       │  + Postgres    │   {transcript, tool, ...}  │  + Ollama (Gemma)  │
                            └───────────────┘                            └────────────────────┘
                              cheap 2 GB VPS                                local / on-prem box
```

## The two units

| Folder | What it is | Where it runs | Stores data? |
| --- | --- | --- | --- |
| [`cloud-bot/`](./cloud-bot) | Lean Node Telegram bot + Postgres manager. Handles `/start`, `/today`, voice notes, inline-keyboard confirmation, scheduling core and barber reminders. | A cheap always-on **2 GB VPS**. | **Yes** — owns the Postgres database. |
| `local-ai-worker/` *(sibling, not built here)* | Stateless Python AI service: `ffmpeg` → faster-whisper STT → Ollama (Gemma) tool-calling. Exposes `POST /process-voice`. | A **local / on-prem machine** with enough RAM/CPU/GPU for Whisper + an LLM. | **No** — fully stateless. |

Each unit is **completely self-contained** (its own `package.json` / `requirements.txt`,
its own `.env.example`, `Dockerfile`, README). There is **zero shared code** between
them — they communicate only over HTTP/JSON.

## Why split it?

- **Cost.** Running Whisper + a 4B-parameter LLM needs several GB of RAM (and ideally a
  GPU). Renting that 24/7 in the cloud is expensive. A 2 GB VPS that only runs Node +
  Postgres costs a few dollars a month.
- **The bot must always be online** so Telegram long-polling never misses a message and
  reminders fire on time. The AI box can be a machine at the shop or at home that you
  already own.
- **Privacy.** Raw audio and transcripts are processed on hardware you control; only the
  small structured tool-call JSON crosses the network.

## How they connect (the secure tunnel)

The AI worker usually lives behind NAT / a home router with no public IP, so the
**worker side opens an outbound tunnel** and the cloud-bot calls the resulting public
HTTPS URL. Any of these works:

- **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:8000`) — free, gives
  an `https://<name>.trycloudflare.com` URL.
- **Tailscale Funnel** or a Tailscale tailnet IP.
- **ngrok** (`ngrok http 8000`).
- A reverse SSH tunnel to the VPS.

Whichever you choose, you end up with one HTTPS URL. Put it in the cloud-bot's
`AI_SERVICE_URL`.

### Authenticating the tunnel

The tunnel URL is reachable from the public internet, so the request is authenticated
with a shared secret:

1. Generate one secret, e.g. `openssl rand -hex 32`.
2. Set the **same** value as `WORKER_SHARED_SECRET` in **both** units' `.env`.
3. The cloud-bot sends it on every request as the `X-Worker-Secret` header.
4. The worker rejects any request whose header does not match with **401**.

The cloud-bot also enforces `AI_REQUEST_TIMEOUT_MS`; if the worker (or the tunnel) is
unreachable or slow, the barber gets a clear "AI service unavailable, please try again"
message instead of a hang.

## Deployment order

1. **On the local AI box** (`local-ai-worker/`): start Ollama, pull the model, run the
   FastAPI worker, then open the tunnel. Note the public HTTPS URL. (See that folder's
   README.)
2. **On the VPS** (`cloud-bot/`): set `AI_SERVICE_URL` to that URL and the matching
   `WORKER_SHARED_SECRET`, run `docker compose up -d`, then `migrate` + `seed`. (See
   [`cloud-bot/README.md`](./cloud-bot/README.md).)

If the tunnel URL changes (free Cloudflare quick-tunnels rotate on restart), update
`AI_SERVICE_URL` on the VPS and restart the bot. For a stable URL use a named
Cloudflare tunnel or a Tailscale Funnel hostname.

> **Scope note.** These are reference implementations of the shared build spec. The full
> smart-shift cascade (auto-moving later clients when something runs long) is
> intentionally out of scope here and can be layered on later.
