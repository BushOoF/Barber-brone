# Deploy — AWS Lightsail (Ubuntu 24.04) + Cloudflare Tunnel

Production runbook for putting Barber-brone on a VPS. Targets AWS Lightsail because of its predictable monthly billing and the free 90-day trial, but every step works on any Ubuntu 24.04 box (EC2, DigitalOcean, Hetzner, etc.).

> **TL;DR resource sizing:** start on the **$12 / 2 GB** plan if you only run 1–3 bots, upgrade to **$44 / 8 GB** if you plan to host 10+ shops on one box. See the [price/value table](#3-pricevalue-table-for-running-multiple-bots) below.

---

## 0. Which version are you deploying?

This repo deploys in **two modes**, and there are also **four standalone reference projects**. Pick one before you start.

### A. Main app WITHOUT the AI assistant (original — lightest)
The classic Mini App + bot: customers book in the web app, the barber runs the day from the dashboard. No Python, no Ollama, no GPU — the whole guide below applies as-is and the **$12 / 2 GB** tier is plenty.
- In `apps/backend/.env`, set `VOICE_ENABLED=false`.
- **Skip section 4A.** That's it.

### B. Main app WITH the AI voice assistant (what we ship now)
Everything in A, plus voice-note control (book, cancel, breaks, walk-ins, announcements, prices, hours, days off). Adds two runtime dependencies: a small **Python FastAPI** service and **Ollama running `gemma4:e4b`** (~9.6 GB model).
- In `apps/backend/.env`, set `VOICE_ENABLED=true` and `AI_SERVICE_URL=http://localhost:8000`.
- Follow **section 4A** to run the AI sidecar.
- ⚠️ **Resource reality:** `gemma4:e4b` needs ~10–12 GB RAM for the model and is slow on CPU (~60–90 s/voice note). For production voice use a **GPU** box, **≥16 GB RAM**, or host the AI on a **separate machine** and point `AI_SERVICE_URL` at it over a tunnel (the hybrid project below). The 2 GB tier in §3 is for **mode A only**.

**Per-shop runtime switch:** even with `VOICE_ENABLED=true`, the operator bot toggles voice per shop with `/voice <slug> on|off` (flips `Settings.hasVoiceFeature`; no redeploy).

### Deploying just ONE of the four reference projects
The repo also has four self-contained, **zero-shared-code** packagings of the voice bot (see [VOICE-SCHEDULING.md](VOICE-SCHEDULING.md)). To deploy one, copy **only that folder** and follow its own README:

| Folder | What it is | Needs |
|---|---|---|
| `project-3-standard-crud/` | bot only, **no AI** (text + inline keyboards) | Node + Postgres (2 GB) |
| `project-1-monolithic-cloud-ai/` | bot + Whisper→Gemma sidecar on one box | Node + Postgres + Python + Ollama (GPU/≥16 GB) |
| `project-4-direct-gemma-audio/` | bot + **direct audio→Gemma** sidecar (best Uzbek) | Node + Postgres + Python + Ollama (GPU/≥16 GB) |
| `project-2-hybrid-distributed-ai/` | lean cloud bot (2 GB) + AI worker on your own machine via tunnel | cheap VPS **+** a GPU box |

> For most people the answer is **the main app (this guide)**, mode A or B. The four projects are reference architectures.

---

## 1. Architecture (with Cloudflare Tunnel)

```
        ┌────────────────────────────────────────────────────────┐
        │                  Internet (Telegram users)             │
        └─────────────┬──────────────────────────────────────────┘
                      │ HTTPS (Cloudflare edge, free TLS)
                      ▼
        ┌────────────────────────────────────────────────────────┐
        │                  Cloudflare network                    │
        │  barber.yourdomain.com → routed to your tunnel         │
        └─────────────┬──────────────────────────────────────────┘
                      │ Cloudflare Tunnel (outbound from VPS)
                      ▼
  ┌───────────────────────────────────────────────────────────────┐
  │                      Lightsail VPS (Ubuntu 24.04)             │
  │                                                                │
  │   cloudflared ──► nginx :80 ─┬─► / static  →  webapp dist     │
  │                              └─► /api      →  backend :3000   │
  │                                                                │
  │                                  backend (Node + grammY)       │
  │                                       │                        │
  │                                       ▼                        │
  │                              Postgres :5432 (Docker)           │
  └───────────────────────────────────────────────────────────────┘
```

**Why Cloudflare Tunnel?**
- Zero inbound ports on the VPS (the tunnel is outbound). DDoS protection at the edge.
- Free TLS without certbot/Let's Encrypt fiddling.
- Hides your VPS IP — nobody can scan or attack it directly.
- Free for up to 100 connections per tunnel; sufficient for many bots.

---

## 2. Recommended resource sizing

Real measured baseline on Ubuntu 24.04 + this stack:

| Component | RAM idle | RAM under modest load |
|---|---:|---:|
| Ubuntu 24.04 base | 150 MB | 150 MB |
| Postgres in Docker | 200 MB | 250 MB |
| cloudflared | 25 MB | 35 MB |
| nginx | 15 MB | 20 MB |
| PM2 monitor | 20 MB | 20 MB |
| **One backend (Node + grammY + Fastify + Prisma)** | **120 MB** | **220 MB** |

**Baseline (no bots):** ~410 MB. **Each extra bot:** ~200 MB (sharing Postgres + nginx).

So `free RAM for bots = total RAM − 410 MB`, and each bot needs ~250 MB headroom.

---

## 3. Price/value table for running multiple bots

Based on AWS Lightsail Linux pricing (per region, US East prices shown — others within ±10 %). All tiers get the **first 90 days free**.

| Plan | RAM | vCPU | SSD | Transfer | Realistic bots | $/bot/month |
|---|---:|---:|---:|---:|---:|---:|
| $5 | 512 MB | 2 (burst) | 20 GB | 1 TB | **0** (OOM risk — skip) | — |
| $7 | 1 GB | 2 (burst) | 40 GB | 2 TB | 1–2 | $3.50–$7 |
| $12 | 2 GB | 2 (burst) | 60 GB | 3 TB | 5–7 | $1.70–$2.40 |
| $24 | 4 GB | 2 (burst) | 80 GB | 4 TB | 13–15 | $1.60–$1.85 |
| **$44** | **8 GB** | **2 (burst)** | **160 GB** | **5 TB** | **28–32** | **$1.40–$1.57** ⭐ |
| $84 | 16 GB | 4 | 320 GB | 6 TB | 55–65 | $1.30–$1.53 |
| $160 | 32 GB | 8 | 640 GB | 7 TB | 100+ | $1.45+ |

**Sweet spot: $44 / 8 GB / 2 vCPU.** Best $/bot ratio, and at ~30 bots you're still well within the 2 vCPU burst budget (barbershop traffic is bursty but tiny — a handful of QPS per shop at peak).

> **Burst CPU caveat:** Lightsail uses burstable CPUs. If you ever sustain >40 % CPU for hours, you'll be throttled. For 30 idle-ish bot processes, you'll never come close.

> **Storage:** Each bot's DB is tiny (a few MB even after months of bookings). 160 GB is wildly excessive — you'd notice the storage running low only after years.

> **Transfer:** 5 TB/month is ~167 GB/day. Each Mini App load is ~200 KB. That's ~800,000 Mini App loads per day from one server. You will never hit it.

**When to scale up:** Watch `htop` — if `free` RAM stays under 500 MB consistently or you see swap activity, jump to the next tier.

---

## 4. Step-by-step deploy on AWS Lightsail

### 4.1 Provision the instance

1. Sign in to [Lightsail console](https://lightsail.aws.amazon.com/).
2. **Create instance** → location: nearest to your users (`Frankfurt`, `Mumbai`, `Tokyo` — for Uzbek users, **Frankfurt (eu-central)** is usually fastest).
3. Platform: **Linux/Unix** → Blueprint: **OS Only → Ubuntu 24.04 LTS**.
4. Plan: pick from the table above. Start with **$12** if unsure — you can upgrade later via snapshot + restore.
5. Instance name: `barber-prod-1`.
6. **Create instance**.
7. After 1–2 min, status = Running. Note the **public IPv4** in the dashboard.

### 4.2 First SSH login + hardening

Lightsail gives you a default `ubuntu` user. Download the **default SSH key** from the Lightsail dashboard (`Account` → `SSH keys`).

From your local machine:

```bash
chmod 600 ~/Downloads/LightsailDefaultKey-<region>.pem
ssh -i ~/Downloads/LightsailDefaultKey-<region>.pem ubuntu@<your-public-ip>
```

Once in, lock down the box:

```bash
# Update + upgrade
sudo apt update && sudo apt upgrade -y

# Create a non-root admin user (optional but recommended)
sudo adduser --gecos "" barber
sudo usermod -aG sudo barber
sudo mkdir -p /home/barber/.ssh
sudo cp ~/.ssh/authorized_keys /home/barber/.ssh/
sudo chown -R barber:barber /home/barber/.ssh
sudo chmod 700 /home/barber/.ssh
sudo chmod 600 /home/barber/.ssh/authorized_keys

# From now on, log in as `barber` instead of `ubuntu`
# ssh -i <key> barber@<ip>

# Disable password auth (SSH keys only)
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# Auto-install security updates
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # accept default

# Firewall (cloudflared handles inbound; only SSH needs to be open)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw --force enable

# Optional but recommended: fail2ban for SSH
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
```

> Also: in the Lightsail dashboard, go to **Networking → Firewall** and remove the default HTTP (80) / HTTPS (443) rules. With Cloudflare Tunnel you don't need them — keep only SSH (22).

### 4.3 Install runtime dependencies

As the `barber` user:

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git build-essential

# Docker (for Postgres)
curl -fsSL https://get.docker.com | sudo bash
sudo usermod -aG docker barber
# Log out and back in so the group change applies
exit
```

Reconnect with `ssh -i <key> barber@<ip>`. Then:

```bash
docker --version    # should print "Docker version 27.x.x" or newer
node --version      # should print "v20.x.x"

# PM2 for process management
sudo npm install -g pm2

# nginx
sudo apt install -y nginx
sudo systemctl enable nginx
```

### 4.4 Clone the stable branch + configure

```bash
sudo mkdir -p /srv
sudo chown barber:barber /srv
cd /srv
git clone -b main https://github.com/BushOoF/Barber-brone.git
cd Barber-brone
```

Set up environment files with **real** values:

```bash
cp apps/backend/.env.example apps/backend/.env
nano apps/backend/.env
```

Edit `apps/backend/.env`:

```ini
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://barber:STRONG_PASSWORD_CHANGE_ME@localhost:5432/barber_brone?schema=public

TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_ADMIN_IDS=<your_telegram_user_id>     # message @userinfobot to find yours
WEBAPP_URL=https://barber.yourdomain.com       # the public Cloudflare hostname you'll set up below
TELEGRAM_WEBHOOK_URL=https://barber.yourdomain.com/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=<run: openssl rand -hex 32>

SHOP_TIMEZONE=Asia/Tashkent
SHOP_CURRENCY=UZS

# Browser will load the Mini App from the Cloudflare URL — keep CORS narrow.
CORS_EXTRA_ORIGINS=https://barber.yourdomain.com
```

Also:

```bash
cp apps/webapp/.env.example apps/webapp/.env
# Leave defaults — the production build uses relative /api paths.
```

### 4.5 Postgres

Update `docker-compose.yml` to use the strong password you put in `DATABASE_URL`, then:

```bash
# Edit docker-compose.yml — replace barber_dev_password with your STRONG_PASSWORD_CHANGE_ME
nano docker-compose.yml

docker compose up -d postgres
docker compose ps        # postgres should be "healthy"
```

### 4.6 Build + run the backend

```bash
npm ci                                              # production install for all workspaces
npm --workspace apps/backend exec -- prisma migrate deploy
npm --workspace apps/backend run db:seed            # one-time: seeds the 4 default services

npm --workspace apps/backend run build              # compile TS → dist/

# Start under PM2
pm2 start ecosystem.config.js
pm2 logs barber-backend --lines 40                  # tail logs to confirm startup
# Expected: "✓ HTTP API listening on http://0.0.0.0:3000" + "✓ Telegram bot @... started (long-polling)"
```

> The bot is on long-polling right now because we haven't set up the public webhook yet — Cloudflare Tunnel comes next.

### 4.7 Build + serve the webapp

```bash
npm --workspace apps/webapp run build               # produces apps/webapp/dist/

# Place the static files where nginx will serve them from
sudo mkdir -p /var/www/barber-webapp
sudo cp -r apps/webapp/dist/* /var/www/barber-webapp/
sudo chown -R www-data:www-data /var/www/barber-webapp
```

### 4.8 Nginx — local reverse proxy (cloudflared talks to this)

```bash
sudo cp /srv/Barber-brone/nginx.conf.example /etc/nginx/sites-available/barber-brone
sudo nano /etc/nginx/sites-available/barber-brone
```

Replace the contents with the *cloudflared-friendly* version below (the bundled example assumes you also handle TLS in nginx; with Cloudflare Tunnel, nginx only listens on `localhost:80` and TLS is handled at the Cloudflare edge):

```nginx
server {
    listen 127.0.0.1:80 default_server;
    server_name _;

    root /var/www/barber-webapp;
    index index.html;

    # Mini App SPA — every unknown path serves index.html so client-side routing works
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Hashed static assets — long cache
    location ~* \.(js|css|woff2?|png|jpg|jpeg|svg|webp)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Backend API + Telegram webhook
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 60s;
    }

    location = /telegram/webhook {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Enable and reload:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/barber-brone /etc/nginx/sites-enabled/
sudo nginx -t                                       # syntax check
sudo systemctl reload nginx

# Verify locally
curl -s http://localhost/                           # should return the Mini App HTML
curl -s http://localhost/api/healthz                # → {"ok":true,...}
```

---

## 4A. (Optional) The AI voice assistant sidecar — mode B only

Skip this entirely if you deployed in **mode A** (`VOICE_ENABLED=false`).

The voice assistant needs (1) **Ollama** serving `gemma4:e4b` and (2) a small **Python FastAPI** service the backend calls at `AI_SERVICE_URL`.

```bash
# 1) Ollama + the model (one-time; ~9.6 GB download). Run on a GPU host for real speed.
curl -fsSL https://ollama.com/install.sh | sh
ollama pull gemma4:e4b

# 2) ffmpeg (audio) + Python 3.11
sudo apt install -y ffmpeg python3.11 python3.11-venv

# 3) The AI service — use project-4's (direct audio → Gemma, best Uzbek accuracy):
cd /srv/Barber-brone/project-4-direct-gemma-audio/ai-service
python3.11 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # set OLLAMA_MODEL=gemma4:e4b, PORT=8000

# 4) Run it under PM2 and verify:
pm2 start ".venv/bin/python -m app.main" --name barber-ai --cwd "$(pwd)"
pm2 save
curl -s http://localhost:8000/healthz   # → {"status":"ok","mode":"direct-audio",...}
```

Then in `apps/backend/.env` set `VOICE_ENABLED=true` and `AI_SERVICE_URL=http://localhost:8000`, and `pm2 restart barber-backend`.

**Separate AI host (recommended for production):** run Ollama + the Python service on a GPU box, expose it via a tunnel, and set `AI_SERVICE_URL` on the cloud bot to that URL. That is exactly the `project-2-hybrid-distributed-ai` shape — its `cloud-bot` sends a shared-secret header (`WORKER_SHARED_SECRET`) the worker validates.

> CPU-only works for testing but expect ~60–90 s per voice note. Turn voice off any time without redeploying: operator bot → `/voice <slug> off`.

---

## 5. Cloudflare Tunnel

### 5.1 Prerequisites

1. **A domain on Cloudflare.** If you don't have one, buy a cheap one (`.com` ≈ $10/yr; `.uz`, `.dev` etc. similar) and add it to Cloudflare (free plan is fine). Change the registrar's nameservers to the two Cloudflare gives you.
2. Once Cloudflare has shown the domain as "Active" (5–60 min after nameserver change), proceed.

### 5.2 Install `cloudflared`

```bash
# Add Cloudflare's apt repo
curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update
sudo apt install -y cloudflared
cloudflared --version
```

### 5.3 Authenticate + create the tunnel

```bash
cloudflared tunnel login
# Opens a Cloudflare URL in your terminal. Copy it, paste into a browser, log in,
# choose your domain, click "Authorize". A cert.pem is saved to ~/.cloudflared/.

cloudflared tunnel create barber-brone
# Output: "Created tunnel barber-brone with id <UUID>"
# Saves credentials to ~/.cloudflared/<UUID>.json
```

### 5.4 Configure routing

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/<UUID>.json /etc/cloudflared/
sudo nano /etc/cloudflared/config.yml
```

Single-bot config:

```yaml
tunnel: <UUID>                                   # the UUID from step 5.3
credentials-file: /etc/cloudflared/<UUID>.json

ingress:
  - hostname: barber.yourdomain.com
    service: http://localhost:80
  - service: http_status:404                     # catch-all required by cloudflared
```

Bind the hostname to the tunnel (creates the DNS CNAME automatically):

```bash
cloudflared tunnel route dns barber-brone barber.yourdomain.com
```

### 5.5 Run cloudflared as a systemd service

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared                # active (running)
journalctl -u cloudflared -f                     # tail logs
```

You should see lines like `Registered tunnel connection` to four datacenters. The tunnel is live.

### 5.6 Verify end-to-end

```bash
# From your laptop:
curl -I https://barber.yourdomain.com/                # → HTTP/2 200, served from your VPS via Cloudflare
curl -s https://barber.yourdomain.com/api/healthz     # → {"ok":true,...}
```

### 5.7 Tell Telegram about the new webhook

```bash
# On the VPS, the backend's startBot() automatically registers the webhook if
# TELEGRAM_WEBHOOK_URL is set in .env (which we did in step 4.4). Restart to apply:
pm2 restart barber-backend

# Verify with Telegram's API:
TOKEN=$(grep TELEGRAM_BOT_TOKEN /srv/Barber-brone/apps/backend/.env | cut -d= -f2)
curl -s "https://api.telegram.org/bot${TOKEN}/getWebhookInfo" | jq .
# Expected: "url": "https://barber.yourdomain.com/telegram/webhook"
```

### 5.8 Final BotFather setup

In a chat with [@BotFather](https://t.me/BotFather):

1. `/myapps` → select your bot → **Edit Web App URL** → paste `https://barber.yourdomain.com`.
2. `/setmenubutton` → select your bot → paste `https://barber.yourdomain.com` → menu text `Soch oldirish` (or your preferred language).

That's it — the bot is live in production.

---

## 6. Running multiple bots on the same server

Each barbershop = its own bot, its own database, its own subdomain. Architecture:

```
cloudflared (one process)
   ├── barber1.yourdomain.com → localhost:80 → nginx → backend1 :3000 → DB shop1
   ├── barber2.yourdomain.com → localhost:80 → nginx → backend2 :3001 → DB shop2
   └── barber3.yourdomain.com → localhost:80 → nginx → backend3 :3002 → DB shop3

Postgres :5432 (one container, multiple databases inside)
```

### 6.1 Provision per-shop database

```bash
# Create a database per shop
docker exec -it barber-brone-postgres psql -U barber -d postgres -c "CREATE DATABASE shop1_db;"
docker exec -it barber-brone-postgres psql -U barber -d postgres -c "CREATE DATABASE shop2_db;"
```

### 6.2 Clone the codebase per shop

```bash
cd /srv
git clone -b main https://github.com/BushOoF/Barber-brone.git Barber-brone-shop1
git clone -b main https://github.com/BushOoF/Barber-brone.git Barber-brone-shop2

# Each shop has its own .env:
cp Barber-brone-shop1/apps/backend/.env.example Barber-brone-shop1/apps/backend/.env
nano Barber-brone-shop1/apps/backend/.env
#   PORT=3001
#   DATABASE_URL=postgresql://barber:PASSWORD@localhost:5432/shop1_db?schema=public
#   TELEGRAM_BOT_TOKEN=<shop1's bot token>
#   TELEGRAM_ADMIN_IDS=<shop1 owner's Telegram ID>
#   WEBAPP_URL=https://barber1.yourdomain.com
#   TELEGRAM_WEBHOOK_URL=https://barber1.yourdomain.com/telegram/webhook
#   TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>

# Repeat for shop2 (PORT=3002, shop2_db, etc.)
```

### 6.3 PM2 ecosystem covering all bots

```js
// /srv/ecosystem.config.js
module.exports = {
  apps: [
    {
      name: "barber-shop1",
      cwd: "/srv/Barber-brone-shop1/apps/backend",
      script: "dist/index.js",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
    },
    {
      name: "barber-shop2",
      cwd: "/srv/Barber-brone-shop2/apps/backend",
      script: "dist/index.js",
      env: { NODE_ENV: "production" },
      max_memory_restart: "300M",
    },
  ],
};
```

Then build each and start them all:

```bash
for d in /srv/Barber-brone-shop1 /srv/Barber-brone-shop2; do
  (cd $d && npm ci && npm --workspace apps/backend exec -- prisma migrate deploy && npm --workspace apps/backend run build)
done

pm2 start /srv/ecosystem.config.js
pm2 save
pm2 startup systemd                              # follow the printed command to enable PM2-at-boot
```

### 6.4 Nginx — one server block per shop

```nginx
# /etc/nginx/sites-available/barber-brone-shop1
server {
    listen 127.0.0.1:80;
    server_name barber1.yourdomain.com;

    root /var/www/barber-shop1;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }
    location /api/             { proxy_pass http://127.0.0.1:3001; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; }
    location = /telegram/webhook { proxy_pass http://127.0.0.1:3001; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; }
}
```

(Identical block for shop2 with `:3002` and `/var/www/barber-shop2`.)

### 6.5 Cloudflared multi-host config

```yaml
# /etc/cloudflared/config.yml
tunnel: <UUID>
credentials-file: /etc/cloudflared/<UUID>.json

ingress:
  - hostname: barber1.yourdomain.com
    service: http://localhost:80
  - hostname: barber2.yourdomain.com
    service: http://localhost:80
  - service: http_status:404
```

Bind each hostname:

```bash
cloudflared tunnel route dns barber-brone barber1.yourdomain.com
cloudflared tunnel route dns barber-brone barber2.yourdomain.com
sudo systemctl restart cloudflared
```

---

## 6.5. Adding the operator (`barber-dev`) bot to the same VPS

The `apps/barber-dev/` workspace ships an *operator* bot — a separate Telegram bot you and your developers use to manage the fleet (shops, fees, feature toggles, weekly + monthly reminders). It runs on the same VPS as the shop bots, talks to a **separate control database**, and uses long-polling so it needs no public hostname.

### 6.5.1 Create the second Telegram bot

In [@BotFather](https://t.me/BotFather): `/newbot` → e.g. *"Barber Ops"* → copy the new token. This is a different token from any shop bot.

### 6.5.2 Create the control database

```bash
docker exec -it barber-brone-postgres psql -U barber -d postgres -c "CREATE DATABASE barber_control;"
```

### 6.5.3 Configure `apps/barber-dev/.env`

```bash
cp apps/barber-dev/.env.example apps/barber-dev/.env
nano apps/barber-dev/.env
```

```ini
NODE_ENV=production
BARBER_DEV_BOT_TOKEN=<from BotFather, step 6.5.1>
OPERATOR_TELEGRAM_IDS=<your TG ID>,<other dev TG IDs>     # first = super operator
DATABASE_URL=postgresql://barber:STRONG_PASSWORD@localhost:5432/barber_control?schema=public
TIMEZONE=Asia/Tashkent
TELEGRAM_WEBHOOK_URL=
TELEGRAM_WEBHOOK_SECRET=
```

### 6.5.4 Migrate, seed, build, start

```bash
npm --workspace apps/barber-dev exec -- prisma migrate deploy
npm --workspace apps/barber-dev run db:seed                  # creates Operator rows from OPERATOR_TELEGRAM_IDS
npm --workspace apps/barber-dev run build

# Start under PM2 — already in ecosystem.config.js as "barber-operator"
pm2 start ecosystem.config.js --only barber-operator
pm2 save
pm2 logs barber-operator --lines 40
# Expected: "✓ barber-dev bot @<your-bot> started (long-polling)"
#           "✓ barber-dev reminder crons scheduled (timezone: Asia/Tashkent)"
```

### 6.5.5 Register your first shop from the operator bot

In Telegram, message your **operator** bot:

```
/start
/addshop downtown "Downtown Barbershop" 707841575 postgresql://barber:STRONG_PASSWORD@localhost:5432/barber_brone?schema=public
/setfee downtown 500000
/shops
```

Notes on `/addshop`:
- The `dbUrl` lets the operator bot read revenue + write apprentice/location settings on the shop's DB.
- For shops not on this server, you can omit the dbUrl (the bot will skip remote operations); fees still get tracked.

### 6.5.6 Verify the reminders

```bash
# In a psql session against barber_control:
docker exec -it barber-brone-postgres psql -U barber -d barber_control -c "SELECT * FROM \"Operator\";"
# Expect: your TG ID, isSuper=true
```

The monthly billing cron fires at **09:00 on day 1** of each month (Asia/Tashkent by default). The weekly quality cron fires at **09:00 every Monday**. If the VPS was off when the canonical time passed, the hourly catch-up tick fires lazily once the box is back up.

To trigger a billing reminder *right now* for testing, use `/billing` in the operator bot — it produces the same summary the cron would send.

### 6.5.7 Adding more developers

Once running, the *super operator* (first ID in `OPERATOR_TELEGRAM_IDS`) can promote other devs from inside the bot:

```
/addop 123456789 Aziz
/operators
```

Each new operator can also use every command — except `/addop` and `/removeop`, which stay super-only.

### 6.5.8 What if I want the operator bot on a different VPS?

It works fine — but you'll need to expose each shop's Postgres to that other VPS (Cloudflare Tunnel, Tailscale, or a private network). The simplest setup remains "all on one VPS": one Postgres container, two databases (`barber_brone`, `barber_control`), two PM2 entries.

---

## 7. Operations

### 7.1 Updating to a new release

From your laptop, after merging dev → main and pushing:

```bash
# On the VPS:
cd /srv/Barber-brone
git pull
npm ci
npm --workspace apps/backend exec -- prisma migrate deploy
npm --workspace apps/backend run build
npm --workspace apps/webapp run build
sudo cp -r apps/webapp/dist/* /var/www/barber-webapp/
pm2 reload barber-backend          # zero-downtime restart
```

Wrap this in a `scripts/deploy.sh` if you do it often.

### 7.2 Postgres backups (you MUST do this)

```bash
# /usr/local/bin/barber-backup.sh
#!/usr/bin/env bash
set -euo pipefail
DEST=/var/backups/barber
mkdir -p "$DEST"
TS=$(date -u +%Y%m%dT%H%M%SZ)
docker exec barber-brone-postgres pg_dumpall -U barber | gzip > "$DEST/all_${TS}.sql.gz"
# Keep last 14 daily backups
find "$DEST" -name 'all_*.sql.gz' -mtime +14 -delete
```

Schedule with cron:

```bash
sudo chmod +x /usr/local/bin/barber-backup.sh
( sudo crontab -l 2>/dev/null; echo "30 3 * * * /usr/local/bin/barber-backup.sh" ) | sudo crontab -
```

Test restore once a quarter:

```bash
gunzip -c /var/backups/barber/all_<TS>.sql.gz | docker exec -i barber-brone-postgres psql -U barber -d postgres
```

For real safety, also `aws s3 cp /var/backups/barber/all_<TS>.sql.gz s3://your-bucket/` in the same cron job — Lightsail backups are local and won't help if the instance itself is lost.

### 7.3 Monitoring

- **Uptime:** [UptimeRobot](https://uptimerobot.com/) (free tier — 50 monitors). Add HTTP check for `https://barber.yourdomain.com/api/healthz`.
- **Process restarts:** `pm2 install pm2-logrotate` + `pm2 set pm2-logrotate:retain 14`.
- **Memory:** `pm2 monit` interactive view. `htop` for the whole box.
- **Errors:** the backend logs go to `~/.pm2/logs/barber-backend-*.log`. Tail with `pm2 logs`.

### 7.4 SSL / TLS

You get TLS automatically — Cloudflare terminates HTTPS at the edge. In Cloudflare dashboard:
- **SSL/TLS** → encryption mode → **Full** (not Strict, since we use plain HTTP between cloudflared and nginx on localhost).
- **Edge Certificates** → **Always Use HTTPS** ON.
- **HSTS** ON after you're confident everything works.

---

## 8. Common pitfalls / things you might have missed

| Trap | Fix |
|---|---|
| Lightsail firewall has HTTP/HTTPS open by default → bypasses Cloudflare | **Remove all rules except SSH** in Lightsail's Networking tab. Only cloudflared talks to the outside. |
| `TELEGRAM_BOT_TOKEN` ends up in git history | Always edit `.env` (gitignored), never `.env.example`. If a token leaks: revoke at @BotFather, set new token in `.env`, `pm2 restart`. |
| Webhook never gets called → `getWebhookInfo` shows old URL | After changing `TELEGRAM_WEBHOOK_URL`, **restart the backend** (`pm2 restart barber-backend`) — the URL is registered at startup, not on every request. |
| Mini App opens but `/api/me` returns 401 in browser | Telegram Mini Apps only inject `initData` when opened **from inside Telegram**. Testing the URL in a regular browser will always 401. Always test by tapping the bot's menu button in Telegram. |
| Bot in long-polling mode AND webhook configured → duplicate updates | grammY auto-deletes the webhook before starting long-polling. If you suspect this, run: `curl https://api.telegram.org/bot<TOKEN>/deleteWebhook` once. |
| Operator bot's monthly cron fires twice (once at canonical time, once on hourly catch-up) | The `ReminderTick` table debounces per `monthly_billing:YYYY-MM` key — only one DM goes out. Safe by design. |
| Shop's apprentice toggle didn't take effect | The Mini App re-reads `/api/me` on focus (visibility-change revalidation). If the user kept the app foregrounded the whole time, ask them to background + foreground it. Backend reflects DB changes immediately. |
| Operator bot can't reach a shop's DB after a Postgres password rotation | Update the shop's `dbUrl` in `Shop` table: in operator bot, the shortcut is to remove + re-add with `/addshop` (it upserts on slug). |
| Date pickers / time zones look weird | Backend stores UTC, formats in `SHOP_TIMEZONE` (default `Asia/Tashkent`). To run a shop in another zone, change that env var and restart. |
| Postgres ran out of disk → bot dies silently | `df -h` regularly. Set up an UptimeRobot keyword check for `"ok":true` in the healthz response. |
| Lightsail snapshot isn't a real backup | Snapshots cover the whole disk but only restore to a new Lightsail instance in the same region. Plus the database is in Docker — snapshots may capture mid-transaction state. **Use the `pg_dumpall` cron above** as your real backup. |
| Updates break: migration runs, build fails, but the old PM2 process keeps running with the new schema | Always: run migrations first, build, **then** `pm2 reload`. If `reload` fails, the previous process keeps serving until you investigate. |
| Bot becomes unreachable when laptop sleeps | Once deployed via Cloudflare Tunnel, the laptop is irrelevant. Only the VPS + Cloudflare matter. |
| You change the bot token but forget to update `.env` | The bot will refuse to start (401 from Telegram). Check `pm2 logs` — error is loud. |
| You forget to expose the database port to `localhost` only | Default `docker-compose.yml` binds Postgres to `0.0.0.0:5432`. Cloudflare doesn't proxy it, but check `sudo ss -tlnp` to confirm. To restrict, change the `ports:` line to `"127.0.0.1:5432:5432"`. |

### Additional hardening you should consider

- **Off-site backups** — `s3cmd` or `rclone` to push `pg_dumpall` to S3 / Backblaze B2 weekly.
- **Bot token rotation** — every 6–12 months, regenerate at BotFather and update `.env`.
- **Failover plan** — keep `cloudflared` config + `pg_dumpall` archive somewhere outside Lightsail (S3, GitHub private gist, your laptop). Rebuilding takes ~15 min if you have these.
- **Per-shop owner SSH** — if you sell this as a service, each shop owner shouldn't have SSH. Only you do.
- **Cloudflare Access** — for an admin-only path, you can put a Cloudflare Zero Trust policy on `barber.yourdomain.com/api/admin/*` requiring Google / GitHub login. Free for up to 50 users.

---

## 9. Cheat sheet

```bash
# Status
pm2 status                        # both barber-backend and barber-operator
systemctl status nginx cloudflared
docker compose ps

# Logs (live)
pm2 logs barber-backend           # shop bot + Mini App API
pm2 logs barber-operator          # operator/fleet bot
journalctl -u cloudflared -f
docker logs -f barber-brone-postgres

# One-shot deploy (pulls main, migrates BOTH DBs, builds both bots, reloads PM2)
sudo -u barber bash /srv/Barber-brone/scripts/deploy.sh

# Deploy only the shop bot
SKIP_OPERATOR=1 sudo -u barber bash /srv/Barber-brone/scripts/deploy.sh

# Deploy only the operator bot
SKIP_BACKEND=1 sudo -u barber bash /srv/Barber-brone/scripts/deploy.sh

# Roll back
cd /srv/Barber-brone && git log --oneline -10
git checkout <commit-sha>
sudo -u barber bash scripts/deploy.sh   # rebuilds both at the rolled-back SHA

# Database shells
docker exec -it barber-brone-postgres psql -U barber -d barber_brone     # shop data
docker exec -it barber-brone-postgres psql -U barber -d barber_control   # operator/control data

# Restore from backup (pg_dumpall covers BOTH databases)
gunzip -c /var/backups/barber/all_<TS>.sql.gz | docker exec -i barber-brone-postgres psql -U barber -d postgres

# Operator bot: trigger reminders manually (no waiting for cron)
# In your operator bot's Telegram chat:
#   /billing   — preview & DM all operators this month's pending fees
#   /shops     — current revenue + fee status per shop

# Add another shop (multi-bot architecture, see §6)
# 1. New bot token from @BotFather, owner's Telegram ID from @userinfobot
# 2. docker exec -it barber-brone-postgres psql -U barber -c "CREATE DATABASE shopN_db;"
# 3. Clone repo into /srv/Barber-brone-shopN (per-shop folder) OR add another PM2 instance
# 4. Edit apps/backend/.env (PORT=300N, token, DB)
# 5. Append to ecosystem.config.js
# 6. Add nginx server block + cloudflared ingress for shopN.yourdomain.com
# 7. pm2 start /srv/ecosystem.config.js && sudo systemctl reload nginx cloudflared
# 8. In operator bot chat: /addshop shopN "Shop Name" <ownerTgId> <dbUrl>
```
