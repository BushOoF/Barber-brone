#!/usr/bin/env bash
# setup-vps.sh — one-time provisioning of a fresh Ubuntu 24.04 box for
# Barber-brone (shop bot + operator bot). Idempotent — safe to re-run.
#
# Pre-reqs (do these by hand first):
#   1. Spin up the Lightsail/EC2/etc. instance and SSH in as ubuntu.
#   2. Create a non-root admin user (we'll use 'barber' here).
#   3. Configure SSH keys + UFW firewall (see DEPLOY.md §4.2).
#   4. Run this script AS THE BARBER USER (not root):  bash scripts/setup-vps.sh
#
# What it does:
#   - Installs Node 20, Docker, PM2, nginx.
#   - Clones the main branch into /srv/Barber-brone if missing.
#   - Brings up Postgres in Docker.
#   - Creates both databases (shop + control) idempotently.
#   - Prompts you for .env values for both bots.
#   - Applies migrations + seeds default services + the super operator.
#   - Builds + starts both bots under PM2.
#
# It does NOT install/configure cloudflared (that needs an interactive login
# flow per-machine — see DEPLOY.md §5).

set -euo pipefail

REPO_DIR="${BARBER_REPO_DIR:-/srv/Barber-brone}"
REPO_URL="${BARBER_REPO_URL:-https://github.com/BushOoF/Barber-brone.git}"
DB_NAME_SHOP="${BARBER_DB_SHOP:-barber_brone}"
DB_NAME_CONTROL="${BARBER_DB_CONTROL:-barber_control}"
PG_USER="${BARBER_DB_USER:-barber}"
PG_PASSWORD="${BARBER_DB_PASSWORD:-}"

say() { printf "\033[36m▶\033[0m %s\n" "$*"; }
ok()  { printf "\033[32m✓\033[0m %s\n" "$*"; }
fail(){ printf "\033[31m✗\033[0m %s\n" "$*" >&2; exit 1; }

if [[ "$(whoami)" == "root" ]]; then
  fail "Run as your non-root admin user (e.g. 'barber'), not root."
fi

if [[ -z "$PG_PASSWORD" ]]; then
  read -srp "Pick a strong Postgres password for user '$PG_USER': " PG_PASSWORD
  echo
fi

# ----- 1. Apt deps -----
say "Installing apt packages (node, docker, nginx, etc.)"
sudo apt-get update -qq
sudo apt-get install -y curl ca-certificates gnupg lsb-release nginx git build-essential

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi
ok "Node $(node --version) · npm $(npm --version)"

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo bash
  sudo usermod -aG docker "$USER"
  fail "Docker installed — log out and log back in (or run 'newgrp docker') so the group change takes effect, then re-run this script."
fi
ok "Docker $(docker --version)"

if ! command -v pm2 >/dev/null 2>&1; then
  sudo npm install -g pm2
fi
ok "PM2 $(pm2 --version)"

# ----- 2. Clone repo -----
say "Cloning $REPO_URL into $REPO_DIR (main branch)"
sudo mkdir -p "$(dirname "$REPO_DIR")"
sudo chown "$USER:$USER" "$(dirname "$REPO_DIR")"
if [[ ! -d "$REPO_DIR/.git" ]]; then
  git clone -b main "$REPO_URL" "$REPO_DIR"
else
  cd "$REPO_DIR" && git fetch origin && git checkout main && git pull --ff-only origin main
fi
cd "$REPO_DIR"
ok "Repo at $(pwd)"

# ----- 3. Postgres in Docker -----
say "Starting Postgres in Docker"

# Patch docker-compose with the chosen credentials (idempotent).
DOCKER_COMPOSE="$REPO_DIR/docker-compose.yml"
if [[ -f "$DOCKER_COMPOSE" ]]; then
  sed -i "s/POSTGRES_USER:.*/POSTGRES_USER: ${PG_USER}/" "$DOCKER_COMPOSE"
  sed -i "s/POSTGRES_PASSWORD:.*/POSTGRES_PASSWORD: ${PG_PASSWORD}/" "$DOCKER_COMPOSE"
fi

docker compose up -d postgres
sleep 3
docker compose ps
ok "Postgres up"

# ----- 4. Create databases (idempotent) -----
say "Creating databases if missing"
docker exec -i barber-brone-postgres psql -U "$PG_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DB_NAME_SHOP'" | grep -q 1 || \
  docker exec -i barber-brone-postgres psql -U "$PG_USER" -d postgres -c "CREATE DATABASE $DB_NAME_SHOP"
docker exec -i barber-brone-postgres psql -U "$PG_USER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='$DB_NAME_CONTROL'" | grep -q 1 || \
  docker exec -i barber-brone-postgres psql -U "$PG_USER" -d postgres -c "CREATE DATABASE $DB_NAME_CONTROL"
ok "Databases ready: $DB_NAME_SHOP, $DB_NAME_CONTROL"

# ----- 5. .env files -----
say "Configuring .env files"

prompt_into_env() {
  local file="$1"; local key="$2"; local prompt="$3"; local default="$4"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    local cur
    cur=$(grep "^${key}=" "$file" | head -1 | cut -d= -f2-)
    if [[ -n "$cur" && "$cur" != "replace_with_token_from_BotFather" && "$cur" != "123456789" ]]; then
      return
    fi
  fi
  read -rp "$prompt [$default]: " val
  val="${val:-$default}"
  if [[ -f "$file" ]] && grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

# Shop bot .env
SHOP_ENV="$REPO_DIR/apps/backend/.env"
if [[ ! -f "$SHOP_ENV" ]]; then
  cp "$REPO_DIR/apps/backend/.env.example" "$SHOP_ENV"
fi
prompt_into_env "$SHOP_ENV" TELEGRAM_BOT_TOKEN "Shop bot token from @BotFather" ""
prompt_into_env "$SHOP_ENV" TELEGRAM_ADMIN_IDS "Main barber Telegram user IDs (comma-sep)" ""
prompt_into_env "$SHOP_ENV" WEBAPP_URL "Public Mini App URL (https://barber.yourdomain.com)" ""
# Force DATABASE_URL to use the password we just set
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@localhost:5432/${DB_NAME_SHOP}?schema=public|" "$SHOP_ENV"
if ! grep -q "^TELEGRAM_WEBHOOK_URL=" "$SHOP_ENV"; then
  echo "TELEGRAM_WEBHOOK_URL=" >> "$SHOP_ENV"
fi
ok "Wrote $SHOP_ENV"

# Webapp .env (minimal)
WEBAPP_ENV="$REPO_DIR/apps/webapp/.env"
if [[ ! -f "$WEBAPP_ENV" ]]; then
  cp "$REPO_DIR/apps/webapp/.env.example" "$WEBAPP_ENV"
fi

# Operator bot .env
OP_ENV="$REPO_DIR/apps/barber-dev/.env"
if [[ ! -f "$OP_ENV" ]]; then
  cp "$REPO_DIR/apps/barber-dev/.env.example" "$OP_ENV"
fi
prompt_into_env "$OP_ENV" BARBER_DEV_BOT_TOKEN "Operator bot token from @BotFather (different from shop bot)" ""
prompt_into_env "$OP_ENV" OPERATOR_TELEGRAM_IDS "Operator Telegram IDs (comma-sep, first = super)" ""
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgresql://${PG_USER}:${PG_PASSWORD}@localhost:5432/${DB_NAME_CONTROL}?schema=public|" "$OP_ENV"
ok "Wrote $OP_ENV"

# ----- 6. Install + migrate + seed + build -----
say "npm ci (all workspaces)"
npm ci

say "Applying shop DB migrations + seeding services"
npm --workspace apps/backend exec -- prisma migrate deploy
npm --workspace apps/backend run db:seed

say "Applying control DB migrations + seeding operators"
npm --workspace apps/barber-dev exec -- prisma migrate deploy
npm --workspace apps/barber-dev run db:seed

say "Building all workspaces"
npm run build

# ----- 7. nginx -----
say "Configuring nginx for the shop bot"
sudo mkdir -p /var/www/barber-webapp
sudo rsync -a --delete apps/webapp/dist/ /var/www/barber-webapp/
sudo chown -R www-data:www-data /var/www/barber-webapp

if [[ ! -f /etc/nginx/sites-available/barber-brone ]]; then
  sudo cp "$REPO_DIR/nginx.conf.example" /etc/nginx/sites-available/barber-brone
  sudo ln -sf /etc/nginx/sites-available/barber-brone /etc/nginx/sites-enabled/
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t
  sudo systemctl reload nginx
fi
ok "nginx serving / from /var/www/barber-webapp, proxying /api → :3000"

# ----- 8. PM2 -----
say "Starting both bots under PM2"
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u "$USER" --hp "$HOME" | tail -n 1 | sudo bash || true
ok "PM2 will respawn both bots on reboot"

# ----- 9. Done -----
cat <<EOF

============================================================
$(tput setaf 2)Barber-brone is provisioned.$(tput sgr0)

Next steps (manual):
  1. Install + configure Cloudflare Tunnel — see DEPLOY.md §5.
  2. Once cloudflared is running, restart the shop backend so it
     picks up the public WEBAPP_URL/TELEGRAM_WEBHOOK_URL:
       pm2 restart barber-backend
  3. In @BotFather:
     - /myapps → your shop bot → Edit Web App URL → https://barber.yourdomain.com
     - /setmenubutton → same URL
  4. In your operator bot chat, send /start and then:
       /addshop downtown "Downtown Barbershop" <ownerTgId> $SHOP_ENV-style-dbUrl
       /setfee downtown 500000

Status:
  pm2 status
  pm2 logs barber-backend --lines 30
  pm2 logs barber-operator --lines 30
============================================================
EOF
