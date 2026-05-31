# Barbershop Scheduling Bot — Standard CRUD (Project 3)

A lightweight, **self-contained** Telegram bot for a single barbershop. One or
more barbers (allowlisted by Telegram ID) manage their appointment day entirely
through **text commands, inline-keyboard menus, and callback queries**.

> **No AI. No voice.** There is zero reference to Python, Whisper, Ollama, or
> audio anywhere in this unit. Appointments are created/edited purely by hand.
> (The Prisma schema keeps an `AppointmentSource` enum with a `VOICE` value for
> parity with the sibling projects, but this bot **never** writes it — every
> record is `MANUAL`.)

This folder is fully independent: its own `package.json`, Prisma schema, env,
Dockerfile, and compose file. Copy it to a server and follow the run steps below
— nothing else is required, and it imports no sibling-project code.

---

## What it does

A guided, conversational UI:

- **📅 View today** — the day's agenda (appointments + breaks), time-ordered.
- **➕ Add appointment** — step by step: pick an existing client / add a new one
  (name + phone) / mark a walk-in → pick a date → pick or type a time → pick a
  duration → optional note. Rejects slots that overlap an existing appointment
  or break, and offers to pick another time.
- **☕ Add break** — block off time (pick day → start → end). Existing
  overlapping appointments are **not** cancelled; the bot just warns you.
- **❌ Cancel appointment** — pick from the upcoming list, confirm.
- **🔁 Reschedule** — pick an appointment → pick a new day/time (same overlap
  check, keeps the original duration).

Every action is also available as a slash command: `/menu`, `/today`, `/add`,
`/break`, `/cancel`, `/reschedule`, `/help`.

**Reminders:** a `node-cron` job runs every minute and DMs the barber roughly
`REMINDER_LEAD_MIN` minutes before each appointment (`"⏰ Client coming at HH:MM
— <name · phone | walk-in>"`), then marks it sent so it never double-fires.

**Auth:** only Telegram IDs in `ADMIN_TELEGRAM_IDS` (and with an active `Barber`
row) can interact. Everyone else gets a single polite refusal.

---

## Tech

- **Node 20**, **TypeScript** (ESM, `module: NodeNext`)
- **grammY** for Telegram (long-polling by default; webhook notes below)
- **Prisma + PostgreSQL**
- **node-cron** for reminders
- **zod** for environment validation

Scheduling lives in `src/scheduling.ts` (overlap detection, structured
conflicts, no auto-shift). Timezone handling (`src/time.ts`) stores everything
in **UTC** and displays in `SHOP_TZ` (default `Asia/Tashkent`) using `Intl`,
so no date library is needed.

---

## Prerequisites

- Node.js 20+ and npm
- A PostgreSQL 14+ database (or use the bundled `docker-compose.yml`)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your Telegram numeric user ID (message [@userinfobot](https://t.me/userinfobot))

---

## Run it — local dev

```bash
# 1. install deps
npm install

# 2. configure env
cp .env.example .env
#    then edit: TELEGRAM_BOT_TOKEN, ADMIN_TELEGRAM_IDS, DATABASE_URL

# 3. generate the Prisma client
npm run prisma:generate

# 4. create the schema in your database
#    dev (creates a migration):
npm run prisma:migrate
#    …or just push the schema without migrations:
npm run db:push

# 5. seed the admin barber(s) from ADMIN_TELEGRAM_IDS
npm run db:seed

# 6. start in watch mode
npm run dev
```

Then open Telegram, message your bot, and send `/start`.

### Production build (without Docker)

```bash
npm install
npm run prisma:generate
npm run build          # compiles src + the seed into dist/
npm run prisma:deploy  # or: npm run db:push
npm run db:seed
npm start
```

---

## Run it — Docker

```bash
cp .env.example .env
# edit TELEGRAM_BOT_TOKEN and ADMIN_TELEGRAM_IDS (DATABASE_URL is set for you
# by compose to point at the db service)

docker compose up -d --build
docker compose logs -f bot
```

On startup the bot container runs `prisma db push` and the seed, then begins
long-polling. Postgres data persists in the `pgdata` volume. Both services are
memory-capped (1g each) to fit comfortably on a ~2GB host.

To stop: `docker compose down` (add `-v` to also wipe the database volume).

---

## Environment variables

| Variable             | Required | Default          | Description                                                        |
| -------------------- | -------- | ---------------- | ------------------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN` | yes      | —                | Bot token from @BotFather.                                         |
| `ADMIN_TELEGRAM_IDS` | yes      | —                | Comma-separated Telegram numeric IDs allowed to use the bot.       |
| `DATABASE_URL`       | yes      | —                | Postgres connection string.                                        |
| `SHOP_TZ`            | no       | `Asia/Tashkent`  | IANA timezone for displaying times (storage is always UTC).        |
| `REMINDER_LEAD_MIN`  | no       | `10`             | Minutes before an appointment to ping the barber.                  |
| `NODE_ENV`           | no       | `development`    | `development` \| `production` \| `test`.                           |

`.env.example` ships **placeholder** values only — never commit a real token.

---

## Telegram long-polling vs. webhook

By default the bot uses **long-polling** (`bot.start()` in `src/index.ts`),
which needs no public URL — ideal for a small VPS or local dev.

To switch to **webhooks** (e.g. behind a reverse proxy with TLS): expose an HTTP
endpoint and feed updates to the bot via grammY's `webhookCallback(bot, ...)`
instead of calling `bot.start()`, then register the URL with
`bot.api.setWebhook(...)`. That requires adding a tiny HTTP server (e.g. Node's
`http` module) — left out here to keep the unit dependency-light, since polling
is the recommended default.

---

## Project layout

```
prisma/
  schema.prisma         Barber / Client / Appointment / Block (+ enums)
  seed.ts               upserts admin barbers from ADMIN_TELEGRAM_IDS
  tsconfig.seed.json    compiles the seed into dist/seed.js for Docker
src/
  env.ts                zod-validated config + isAdmin() allowlist
  db.ts                 shared PrismaClient
  time.ts               UTC <-> SHOP_TZ helpers (no date library)
  scheduling.ts         listDay / createAppointment / createBlock / addClient /
                        cancelAppointment / rescheduleAppointment (+ overlap rules)
  reminders.ts          every-minute barber reminder cron
  wizard.ts             in-memory per-user step/session state
  bot/
    ui.ts               inline keyboards + Markdown formatters
    index.ts            commands, callback routing, wizard handlers, auth
  index.ts              entrypoint: boot bot + cron + graceful shutdown
Dockerfile              multi-stage build, runs as non-root
docker-entrypoint.sh    db push + seed, then start
docker-compose.yml      postgres + bot (memory-capped)
```

---

## Scope note — smart-shift

The full **smart-shift cascade** (automatically moving later clients when an
earlier appointment grows or a break is inserted) is intentionally **out of
scope** for this reference project. Today, creating an appointment that would
overlap is simply rejected, and adding a break only *warns* about overlaps
without touching them. The cascade can be layered on later inside
`src/scheduling.ts` without changing the bot UI.

---

## How this fits the deployment strategy

Project 3 is the **"no-frills, no-AI" deployable**: a single Node process plus
Postgres, driven entirely by Telegram's native UI. It is the easiest unit to
run and the cheapest to host — no AI service, no GPU, no Python sidecar — making
it the right baseline for shops that just want reliable manual scheduling, or as
a fallback if the voice pipeline in the other projects is unavailable. Because it
is fully self-contained, it can be dropped onto its own tiny VPS (or the bundled
2GB compose stack) and run independently of every other unit.
