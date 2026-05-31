# Project 1 — Monolithic (single box)

A voice-scheduling Telegram bot for a single barbershop, deployed as **one
stack on one machine**. The barber manages their day by text commands and voice
notes; voice notes are transcribed and turned into a single confirmed action.

This is one of three independent reference implementations of the same shared
spec. **Project 1 keeps everything together** — the Telegram bot, its Postgres
database, and the local AI service all run side by side and talk over the
internal Docker network. The bot never exposes a public port (it uses Telegram
long-polling), and there is no network authentication between the bot and the AI
service because they share `localhost`.

## Architecture

```
                 Telegram
                    │  (long-polling)
                    ▼
            ┌──────────────┐        POST /process-voice        ┌──────────────┐
            │     bot      │ ───────────────────────────────▶ │  ai-service  │
            │ (Node 20 +   │ ◀─────────────────────────────── │ (FastAPI +   │
            │  grammY +    │     { transcript, tool, args }    │  Whisper +   │
            │  Prisma)     │                                   │  Ollama call)│
            └──────┬───────┘                                   └──────┬───────┘
                   │ SQL                                              │ HTTP
                   ▼                                                  ▼
            ┌──────────────┐                                   ┌──────────────┐
            │   postgres   │                                   │    ollama    │
            └──────────────┘                                   │ (gemma4:e4b) │
                                                               └──────────────┘
```

## Subfolders

- [`bot/`](./bot) — **owned by this project.** The Node/TypeScript Telegram bot +
  Postgres manager (grammY, Prisma, node-cron reminders, zod env validation). It
  downloads voice notes, calls the AI service, shows a Confirm/Cancel summary, and
  only then writes to the DB. See [`bot/README.md`](./bot/README.md) for the full
  env table and run steps.
- `ai-service/` — **owned by a separate unit** (not built here). A stateless
  Python FastAPI service that accepts an audio upload at `POST /process-voice`,
  transcribes it with faster-whisper, asks Ollama/Gemma for exactly one tool call,
  and returns `{ transcript, tool, arguments, confidence }`. It also serves
  `GET /healthz`. This project's `docker-compose.yml` builds it from
  `./ai-service` and wires the bot to it at `http://ai:8000`.

## Quick start

```bash
cp .env.example .env       # fill in TELEGRAM_BOT_TOKEN + ADMIN_TELEGRAM_IDS
./setup.sh                 # build, migrate, seed, and start the stack
```

If you use the bundled Ollama, pull the model once after it is up:

```bash
docker compose exec ollama ollama pull gemma4:e4b
```

Then message your bot: `/start`, `/today`, or send a voice note.

`setup.sh` is idempotent — it (re)builds images, waits for Postgres, runs
`prisma migrate deploy`, seeds the admin barber(s), and brings up `bot`, `ai`,
and `ollama`.

## Resource note

Running Postgres + Node + Whisper + Gemma together is **tight on 8 GB RAM**. The
defaults use `WHISPER_MODEL=small`. If the box thrashes or the AI service OOMs:

- drop `WHISPER_MODEL` to `base` or `tiny`, and/or
- point `OLLAMA_URL` at a **hosted** Ollama and comment out the bundled `ollama`
  service in `docker-compose.yml`, and/or
- move to a bigger box (16 GB+ recommended for `small` + Gemma).

## Environment

The root `.env` is consumed by `docker-compose.yml` (Telegram, Postgres, and AI
settings). The `bot` service derives its own `DATABASE_URL` and `AI_SERVICE_URL`
from these compose variables, so you do not set them twice. See
[`.env.example`](./.env.example) here and [`bot/.env.example`](./bot/.env.example)
for the bot's variables when running it standalone (outside compose).

## How this fits the deployment strategy

Project 1 is the **simplest topology**: one box, one `docker compose up`. It is
ideal when you control a single VPS/Lightsail box and want everything in one place
with no inter-service auth to manage. The trade-off is that the heavy AI workload
(Whisper + Gemma) competes for the same RAM/CPU as the bot and DB. The other
reference projects explore alternatives — e.g. splitting the bot to the cloud and
the AI to a worker guarded by a shared secret — but each is fully independent and
shares no code with this one.
