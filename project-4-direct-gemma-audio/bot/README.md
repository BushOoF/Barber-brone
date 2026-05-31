# Barber Bot — Project 1 (monolithic), Node unit

The core Telegram bot **and** Postgres manager for a single barbershop. A barber
(allow-listed by Telegram ID) manages their appointment day by text commands and
**voice notes**. Voice notes are transcribed and turned into a single tool call
by a local Python AI sidecar; the bot then asks the barber to **Confirm** before
anything is written to the database.

This unit is fully self-contained: its own `package.json`, Prisma schema, DB
layer, `.env.example`, `Dockerfile`, and this README. It imports nothing from any
sibling project.

## What it does

- `/start` — greeting + admin gate.
- `/today` — the barber's agenda for today (appointments + blocks), shown in `SHOP_TZ`.
- **Voice note** → downloaded from Telegram → POSTed to the AI sidecar
  (`AI_SERVICE_URL/process-voice`) → the returned tool call is validated →
  a human-readable summary with **Confirm / Cancel** inline buttons is shown →
  on **Confirm** the matching scheduling operation runs and reports success or a
  conflict. Nothing is committed without the Confirm tap.
- **Reminder cron** (every minute): DMs the barber ~`REMINDER_LEAD_MIN` minutes
  before each SCHEDULED appointment, then marks it sent.

### Voice tools the AI may emit

| Tool           | Effect                                                              |
| -------------- | ------------------------------------------------------------------- |
| `add_client`   | Upsert a client by phone (`phone` required, optional `name`).       |
| `create_break` | Block a break `start_time`–`end_time` (HH:MM). Warns on overlaps.   |
| `add_walkin`   | Add a walk-in appointment (`start_time?` defaults to now, `duration_min?` defaults to 30). |
| `none`         | Intent unclear — the bot asks the barber to rephrase.               |

## Scheduling rules

- Times are stored in **UTC** and displayed in `SHOP_TZ` (default `Asia/Tashkent`).
- `createAppointment` rejects (no write) if it overlaps any SCHEDULED appointment
  or any Block, returning a structured conflict. **No auto-shift.**
- `createBlock` returns the overlapping SCHEDULED appointments so the bot can warn;
  it never auto-cancels them.
- **Out of scope (by design):** the full smart-shift cascade (auto-moving later
  clients) is intentionally not implemented in these reference projects and can be
  layered on later. `rescheduleAppointment` is a Project-3-only requirement and is
  not included here.

## Prerequisites

- Node 20+
- PostgreSQL 14+ (a `DATABASE_URL`)
- The Python AI sidecar reachable at `AI_SERVICE_URL` (default `http://localhost:8000`)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Run locally (dev)

```bash
cp .env.example .env        # then fill in real values
npm install
npm run prisma:generate
npm run prisma:migrate      # creates/updates the schema (dev)
npm run db:seed             # inserts the admin barber(s) from ADMIN_TELEGRAM_IDS
npm run dev                 # tsx watch, long-polling
```

Send `/start` to your bot, then `/today`, then a voice note.

## Run with Docker

This unit is built and orchestrated by the Project-1 `docker-compose.yml` one
level up (services: `postgres`, `bot`, `ai`, optional `ollama`). From the project
root:

```bash
docker compose up -d --build
# or use the helper:
./setup.sh
```

The bot container entrypoint runs `prisma migrate deploy`, then the idempotent
seed, then starts the bot.

To build just this image:

```bash
docker build -t barber-bot .
```

## Environment

| Variable               | Required | Default                | Description                                                            |
| ---------------------- | -------- | ---------------------- | ---------------------------------------------------------------------- |
| `NODE_ENV`             | no       | `development`          | `development` \| `production` \| `test`.                               |
| `TELEGRAM_BOT_TOKEN`   | **yes**  | —                      | Bot token from @BotFather.                                             |
| `ADMIN_TELEGRAM_IDS`   | **yes**  | —                      | CSV of admin Telegram user IDs; the first is the Main Barber.          |
| `DATABASE_URL`         | **yes**  | —                      | PostgreSQL connection URL.                                             |
| `SHOP_TZ`              | no       | `Asia/Tashkent`        | IANA timezone for display and for interpreting spoken times.           |
| `REMINDER_LEAD_MIN`    | no       | `10`                   | Minutes before an appointment to remind the barber.                    |
| `AI_SERVICE_URL`       | no       | `http://localhost:8000`| Base URL of the Python AI sidecar.                                     |
| `AI_REQUEST_TIMEOUT_MS`| no       | `45000`                | Abort the sidecar call after this many ms.                             |

## Webhook mode (optional)

The bot runs **long-polling** by default, which needs no public URL — ideal for a
single-shop deployment behind NAT. To switch to webhooks, replace `bot.start(...)`
in `src/index.ts` with grammY's `webhookCallback` mounted on an HTTP server and set
the webhook via the Telegram API. Long-polling is recommended unless you have a
specific reason to expose HTTP.

## How this fits the deployment strategy

Project 1 is the **monolithic, single-box** strategy: this Node bot, Postgres, and
the Python AI sidecar all run together (see the project-level `docker-compose.yml`).
The bot calls the sidecar over `localhost`, so there is no network auth between them
(contrast Project 2, which splits the bot to the cloud and guards the worker with a
shared secret). Everything a server needs to run this unit is in this folder plus
the compose file one level up.
