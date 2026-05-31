# cloud-bot — Barbershop scheduling bot (Project 2, cloud side)

A lean **Node + TypeScript** Telegram bot for a single barbershop, plus the
**Postgres** it manages. Designed to run 24/7 on a **cheap ~2 GB VPS**. It handles
`/start`, `/today`, voice-note scheduling with an inline-keyboard confirmation, and
per-appointment reminders.

The voice intelligence is **not** in this unit. When a barber sends a voice note, the
bot downloads it and **POSTs it to a remote AI worker** (`local-ai-worker`, a sibling
folder running on an on-prem box) over a **secure tunnel**, authenticated with a shared
secret. The worker returns a structured tool call; the bot turns it into a confirmation
keyboard and only writes to the DB after the barber taps **Confirm**.

See [`../README.md`](../README.md) for the two-environment architecture and how the
tunnel is set up.

## What it does

- **/start** — short intro (admins only).
- **/today** — today's appointments and blocks, in shop local time.
- **Voice notes** — the barber dictates one of:
  - *add a client* (phone, optional name),
  - *create a break* (busy, not a client),
  - *add a walk-in* (a client now / shortly).
  The bot reads it back with a **Confirm / Cancel** keyboard. Nothing is saved without
  Confirm. Conflicts (overlaps) are reported and never auto-shifted.
- **Reminders** — every minute it DMs the barber `REMINDER_LEAD_MIN` minutes before each
  scheduled appointment.

Only Telegram IDs in `ADMIN_TELEGRAM_IDS` may use the bot.

## Tech

Node 20 · TypeScript (ESM, `NodeNext`) · grammY (long-polling by default, webhook
optional) · Prisma + PostgreSQL · node-cron · zod for env validation · native `fetch`
(no axios) for the AI call.

## Prerequisites

- A Telegram bot token from [@BotFather](https://t.me/BotFather).
- The barber's Telegram numeric user ID(s).
- The **AI worker reachable over a tunnel** — a public HTTPS URL and a shared secret
  (set up the `local-ai-worker` first; see `../README.md`).
- **Docker + Docker Compose** (recommended on the VPS), **or** Node 20 + a PostgreSQL
  instance for local dev.

## Configuration

Copy `.env.example` to `.env` and fill it in:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | — | Bot token from BotFather. |
| `ADMIN_TELEGRAM_IDS` | yes | — | Comma-separated admin Telegram user IDs (the barbers). The seed inserts these. |
| `DATABASE_URL` | yes | — | Postgres connection string. In Docker, host is `db`. |
| `SHOP_TZ` | no | `Asia/Tashkent` | IANA timezone for display & interpreting spoken times. |
| `REMINDER_LEAD_MIN` | no | `10` | Minutes before an appointment to remind the barber. |
| `AI_SERVICE_URL` | yes | — | Public HTTPS URL of the AI worker's tunnel. |
| `WORKER_SHARED_SECRET` | yes | — | Sent as `X-Worker-Secret`; must match the worker. |
| `AI_REQUEST_TIMEOUT_MS` | no | `60000` | Timeout for the AI request (STT+LLM can be slow). |
| `WEBHOOK_URL` | no | _(empty)_ | Set to enable webhook mode; empty = long-polling. |
| `WEBHOOK_SECRET` | no | — | Optional Telegram webhook secret token. |
| `PORT` | no | `8080` | HTTP port (webhook mode + `/healthz`). |
| `NODE_ENV` | no | `development` | `production` in deployment. |
| `LOG_LEVEL` | no | `info` | `debug` also logs transcripts (never phone numbers). |

`.env.example` uses placeholder values only — never commit real tokens.

## Run it — Docker (recommended for the VPS)

This unit ships its **own** `docker-compose.yml` (Postgres + bot only, with memory
limits sized for ~2 GB).

```bash
cp .env.example .env          # then edit: token, admin IDs, AI_SERVICE_URL, secret
docker compose up -d --build  # starts Postgres + bot
docker compose logs -f bot
```

On startup the bot container automatically runs `prisma migrate deploy`, seeds the admin
barber(s) from `ADMIN_TELEGRAM_IDS`, then launches in long-polling mode. Postgres data
lives in the named volume `pgdata`.

To stop / update:

```bash
docker compose down           # stop (keeps the volume / data)
docker compose up -d --build  # rebuild & restart after a code or .env change
```

> **Tunnel URL changed?** Free Cloudflare quick-tunnels get a new URL on each restart.
> Update `AI_SERVICE_URL` in `.env` and run `docker compose up -d` (it recreates the bot
> with the new value). Use a named Cloudflare tunnel or Tailscale Funnel for a stable URL.

## Run it — local dev (no Docker for the app)

You still need a Postgres. The quickest is just the DB from compose:

```bash
docker compose up -d db       # Postgres only
```

Then, with Node 20:

```bash
npm install
cp .env.example .env          # set DATABASE_URL host to localhost for local dev
npm run prisma:generate
npm run migrate:dev           # create the schema (dev migrations)
npm run seed                  # insert admin barber(s)
npm run dev                   # start the bot with hot reload (tsx --watch)
```

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Run with hot reload (tsx). |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm start` | Run the compiled bot (`dist/index.js`). |
| `npm run typecheck` | Type-check without emitting. |
| `npm run migrate:dev` | Create/apply a dev migration. |
| `npm run migrate:deploy` | Apply migrations (production/CI). |
| `npm run seed` | Insert admin barber(s) from `ADMIN_TELEGRAM_IDS`. |

## Long-polling vs webhook

- **Long-polling (default):** leave `WEBHOOK_URL` empty. Nothing to expose — ideal for a
  small VPS behind a firewall.
- **Webhook (optional):** set `WEBHOOK_URL` to a public HTTPS base that forwards to this
  container on `PORT`. The bot serves `POST /webhook` and `GET /healthz`, registers the
  webhook with Telegram on boot, and sets the `WEBHOOK_SECRET` token if provided.

## How this fits the deployment strategy

This is the **always-on, stateful half** of the hybrid design. It is deliberately
small so it runs comfortably on the cheapest VPS tier: just Node + Postgres, capped at a
few hundred MB each in `docker-compose.yml`. All the heavy lifting — converting audio,
speech-to-text, and the LLM tool-calling — happens on the **`local-ai-worker`** on
hardware you already own, reached over a **secure tunnel** and authenticated with
`WORKER_SHARED_SECRET`. If the worker or tunnel is down, the bot stays up and tells the
barber to retry; scheduling via `/today` and reminders keep working regardless.

> **Scope note.** The full smart-shift cascade (auto-moving later clients when something
> runs long) is intentionally out of scope for this reference project and can be layered
> on later. Conflicts are reported, not auto-resolved.
