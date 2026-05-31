# Voice Scheduling — Three Deployment Strategies

A barber manages his day by **sending a Telegram voice note** ("Soat 13 dan 14 gacha tanaffus", "client raqami 90 123 45 67", "hozir mijoz keldi"). The bot transcribes it, turns it into a structured scheduling action, **shows a Confirm/Cancel card**, and only writes to the database when the barber confirms. It also DMs the barber when a client is coming up.

This folder set contains **three fully independent implementations** of that idea, each a different deployment strategy. They share **zero code** — copy any one folder to a server and it runs on its own.

> These are standalone reference projects for the voice feature. They are **separate** from the main Barber-brone Mini App platform (`apps/`), which is the production product. See [PROMPT.md](PROMPT.md) for the platform.

---

## The shared design (same in every AI project)

```
Telegram voice (.ogg)
  → download
  → ffmpeg: 16 kHz mono float32 WAV
  → faster-whisper  (Uzbek/Russian → transcript)
  → Ollama / Gemma 4 (gemma4:e4b)  →  strict JSON tool call  (temp 0, schema-constrained, 1 retry)
  → Node bot shows a Confirm / Cancel card        ← never auto-commits
  → on Confirm → Node scheduling logic writes to Postgres + barber reminders
```

**Two decisions baked in (from the research in this session):**

1. **Python is a stateless AI worker** — it never touches the database. The Node bot owns Postgres, the scheduling rules, and the commit. This avoids Prisma `cuid()`/`updatedAt` pitfalls and keeps all business logic in one place.
2. **Confirm-before-commit on every voice action.** Uzbek↔Russian speech + a 4B model will occasionally mis-hear, so nothing is written until the barber taps ✅.

**The three voice tools** the model can emit:

| Tool | Spoken trigger | Writes |
|---|---|---|
| `add_client` | barber dictates a client's phone number | a `Client` row (phone-only allowed) |
| `create_break` | "I'll be busy 13:00–14:00" (not a client) | a `Block` of type `BREAK` |
| `add_walkin` | "I've got a client now / at 15:00" | a walk-in `Appointment` |

---

## Pick a strategy

| | **1 · Monolithic** | **2 · Hybrid (distributed)** | **3 · Standard CRUD** |
|---|---|---|---|
| **Folder** | [`project-1-monolithic-cloud-ai/`](project-1-monolithic-cloud-ai/) | [`project-2-hybrid-distributed-ai/`](project-2-hybrid-distributed-ai/) | [`project-3-standard-crud/`](project-3-standard-crud/) |
| **Input** | voice note | voice note | text commands + buttons |
| **Where AI runs** | Python sidecar on the **same box** (localhost) | Python worker on **your own machine** (Pi 5 / PC) behind a tunnel | no AI at all |
| **Topology** | one server: Postgres + Node + Python + Ollama | cloud bot (2 GB) + local AI worker | one server: Postgres + Node |
| **RAM** | 8 GB tight → 16 GB comfortable | cloud 2 GB; AI box sized to the model | 2 GB |
| **Cost shape** | one capable box | cheap VPS + hardware you already own | cheapest |
| **Strengths** | simplest ops, lowest latency (localhost), one thing to deploy | cheap cloud, heavy AI on your own/GPU hardware, audio never leaves your premises | cheapest, most reliable, zero AI dependencies |
| **Trade-offs** | needs a beefy box; Whisper+Gemma are heavy | tunnel must stay up; two machines to operate; network latency | no voice — every action is manual taps |
| **Choose when** | you want voice and can run one capable server | you want voice but want cheap cloud + control over AI hardware/privacy | you don't need voice, or want the most robust minimal bot |

Auth model differs by topology: in **#1** the bot↔AI call is over the internal Docker network (no auth needed); in **#2** the cloud bot authenticates to the remote worker with a shared secret (`X-Worker-Secret`).

---

## Running each (summary — full steps in each project's own README)

Every project: copy `.env.example` → `.env`, set `TELEGRAM_BOT_TOKEN` + `ADMIN_TELEGRAM_IDS` (your Telegram user id; first = main barber), then:

- **Project 1** — `cd project-1-monolithic-cloud-ai && ./setup.sh` (or `docker compose up -d --build`), then pull the model once: `docker compose exec ollama ollama pull gemma4:e4b`.
- **Project 2** — deploy `cloud-bot/` to the VPS (`docker compose up -d --build`); run `local-ai-worker/` on your local machine and expose it with cloudflared/ngrok; point the cloud bot's `AI_SERVICE_URL` at the tunnel URL and share `WORKER_SHARED_SECRET`.
- **Project 3** — `cd project-3-standard-crud && docker compose up -d --build`. No AI, no Python.

Each AI project defaults to `WHISPER_MODEL=small`; raise it for accuracy if you have the RAM/VRAM, lower it (`base`/`tiny`) if the box is tight.

---

## Status & caveats

- **Verified in this session:** all three Node bots type-check and build (`tsc` exit 0); all Python modules byte-compile; no cross-project imports; Project 3 contains zero AI references. Projects 1 & 2 ship a generated initial Prisma migration so `migrate deploy` creates the schema on first boot.
- **Not run here** (no Docker / GPU / Ollama / Whisper in the build environment): live container builds, real audio transcription, and an end-to-end voice→commit on a phone. Do a smoke test on a real box before relying on it.
- **Uzbek/Russian accuracy** is the main real-world risk (Whisper assumes one language per utterance; mid-sentence code-switching can mis-transcribe). The mandatory Confirm step is the safety net — keep it. Validate accuracy on ~30 real barber voice notes before trusting it unattended.
- **Ollama audio** is deliberately **not** used: as of this research Ollama exposes no audio input field and its undocumented workaround has an open crash bug. Audio is handled by Whisper; Ollama only does the text→tool-call step (which `gemma4:e4b` supports).
