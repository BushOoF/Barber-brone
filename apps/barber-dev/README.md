# barber-dev — operator / SaaS control bot

A second Telegram bot used by you (and any developers you trust) to manage the *fleet* of `barber-brone` shop bots running on your server.

It does **not** talk to customers. It talks to operators about:

- **Shop registry** — every barbershop you host gets a row here, with the slug, owner's Telegram ID, monthly fee, and a pointer to that shop's Postgres database.
- **Revenue tracking** — opens a short-lived connection to each shop's DB, sums `Booking.totalPriceMinor` for the current month, caches it.
- **Monthly billing** — on the 1st of each month at 09:00 (`TIMEZONE` env, default Asia/Tashkent) it DMs every operator the list of shops to collect fees from. Mark them as collected with `/collect <slug>`.
- **Weekly quality reminder** — every Monday at 09:00 it pings you to check in with each shop and ask if things are okay.
- **Feature toggles** — `/apprentice <slug> on|off` writes to the shop's `Settings.hasApprenticeFeature` row, which the shop's Mini App reads via `/api/me`. Same pattern for `/location <slug> <address>`.
- **Multi-operator access** — add other developers with `/addop <telegramId>`; remove with `/removeop <telegramId>`. They get the same view + abilities, except only the super operator (first ID in `OPERATOR_TELEGRAM_IDS`) can add/remove operators.

## Setup (development)

```bash
# From repo root:
cp apps/barber-dev/.env.example apps/barber-dev/.env
nano apps/barber-dev/.env       # set BARBER_DEV_BOT_TOKEN + OPERATOR_TELEGRAM_IDS + DATABASE_URL

# Create the control DB (separate from any shop DB!)
docker exec -it barber-brone-postgres psql -U barber -c "CREATE DATABASE barber_control;"

# Migrate + seed operators from env
npm install
npm --workspace apps/barber-dev exec -- prisma migrate dev --name init
npm --workspace apps/barber-dev run db:seed

# Run the bot
npm run dev:operator
```

## First-run flow

1. In your Telegram, send `/start` to your operator bot. You'll see the help text (auth gate uses `OPERATOR_TELEGRAM_IDS`).
2. Register your first shop:
   ```
   /addshop downtown "Downtown Barbershop" 707841575 postgresql://barber:PASSWORD@localhost:5432/shop1_db
   ```
3. Set the monthly fee:
   ```
   /setfee downtown 500000     # 500,000 UZS
   ```
4. See what you've got:
   ```
   /shops
   /shop downtown
   ```
5. Try a feature toggle (writes to the shop's own DB):
   ```
   /apprentice downtown off
   /location downtown Tashkent, Mirzo Ulug'bek tumani, 12-uy
   ```
6. Wait for the 1st of the month — you'll get a DM listing what to collect.

## Commands

```
/shops                            — list every shop with current-month status
/shop <slug>                      — detail view
/addshop <slug> <name> <ownerTgId> [dbUrl]   — register a shop
/setfee <slug> <amount>           — set monthly fee in shop's minor units
/collect <slug> [note]            — mark this month's fee as collected
/disable <slug> · /enable <slug>  — pause / resume a shop in billing

/apprentice <slug> on|off         — toggle apprentice feature (writes shop's DB)
/location <slug> <address>        — set shop address (writes shop's DB)

/operators                        — list operators
/addop <telegramId> [name]        — add operator (super only)
/removeop <telegramId>            — remove operator (super only)

/billing                          — preview this month's pending fees
/help                             — this list
```

## Schema (control DB)

```
Shop              one row per barbershop you host
Operator          one row per developer with access (env-listed ops bypass the table)
FeeCollection     one row per (shop, month) for billing bookkeeping
RevenueSnapshot   per-(shop, month) cache of aggregated revenue; refreshed lazily
ReminderTick     debounces the cron so a power-cycle won't double-fire monthly reminders
```

## Deployment

Same approach as the shop bot — see [`../DEPLOY.md`](../../DEPLOY.md). You'll want:

- A separate Telegram bot from [@BotFather](https://t.me/BotFather) (different token from any shop bot).
- A separate database (`CREATE DATABASE barber_control;`).
- A PM2 entry alongside the shop bots:

```js
// /srv/ecosystem.config.js
module.exports = {
  apps: [
    // ... shop bots ...
    {
      name: "barber-dev",
      cwd: "/srv/Barber-brone/apps/barber-dev",
      script: "dist/index.js",
      env: { NODE_ENV: "production" },
      max_memory_restart: "200M",
    },
  ],
};
```

The operator bot does **not** need a public hostname — it can run in long-polling mode. (If you do expose it via Cloudflare Tunnel for webhook mode, use a separate subdomain like `ops.yourdomain.com` and lock it behind Cloudflare Access.)

## Why a separate bot?

- Cleanly separate "operator" identity from "customer" identity. The bots are unrelated in Telegram — no risk of a customer accidentally messaging your operator bot.
- Each customer-facing bot stays tightly scoped (one shop, no global commands).
- Adding/removing developers is an operator-bot concern, not something a shop's barber should ever see in their `Settings`.
