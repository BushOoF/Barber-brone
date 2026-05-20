# Workflow — dev vs stable

This repo uses a two-folder, two-branch workflow:

| Folder | Branch | Purpose | Has `.env` with real secrets? |
|---|---|---|---|
| `D:\RBI projects\Barber-brone` | `dev` | Active development, hot-reload, breaking changes welcome. | Yes (gitignored) |
| `D:\RBI projects\Barber-brone-stable` | `main` | Production-ready, gets deployed to the VPS. | Set up once, kept current. |

GitHub repo (private): `<your-github-username>/Barber-brone`. Both folders push/pull from it.

## Day-to-day: making changes

```powershell
# In the dev folder
cd "D:\RBI projects\Barber-brone"
git status                       # confirm you're on dev
# ... edit code, test via python run.py ...
git add <files>
git commit -m "feat: <short description>"
git push origin dev
```

## Promoting tested work to stable

When `dev` is well-tested and you want to deploy:

```powershell
# Still in the dev folder
git checkout main
git merge dev                    # fast-forward or merge commit
git push origin main
git checkout dev                 # switch back to keep working
```

Then in the stable folder (or on the VPS):

```powershell
cd "D:\RBI projects\Barber-brone-stable"
git pull                         # main is now updated
# Run migrations + restart:
npm ci
npm --workspace apps/backend exec -- prisma migrate deploy
npm run build:webapp
# On a real VPS: pm2 reload barber-backend  (or restart docker / nginx)
```

## First-time setup of the stable folder on a new VPS

```bash
git clone -b main <github-url> /srv/barber-brone
cd /srv/barber-brone
cp apps/backend/.env.example apps/backend/.env
# edit apps/backend/.env with real TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_IDS,
#   DATABASE_URL, WEBAPP_URL (your real domain), TELEGRAM_WEBHOOK_URL
cp apps/webapp/.env.example apps/webapp/.env  # usually leave defaults
npm ci
docker compose up -d postgres
npm --workspace apps/backend exec -- prisma migrate deploy
npm --workspace apps/backend run db:seed
npm run build:webapp
# webapp dist goes to wherever nginx serves from (see nginx.conf.example)
pm2 start ecosystem.config.js
pm2 save
```

Set `TELEGRAM_WEBHOOK_URL=https://your-domain.example.com/telegram/webhook` and the bot switches from long-polling to webhook automatically on next start.

## Hotfix on stable without going through dev

Rare, but possible:

```powershell
cd "D:\RBI projects\Barber-brone-stable"
git checkout main
# fix
git commit -am "hotfix: <description>"
git push origin main
# Then back-port to dev so future work doesn't lose the fix:
cd "D:\RBI projects\Barber-brone"
git checkout dev
git pull origin main
# resolve conflicts if any
git push origin dev
```

## Where secrets live

- Real `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_IDS`, etc. live ONLY in `apps/backend/.env` (gitignored).
- `apps/backend/.env.example` and the root `.env.example` are templates committed to git with **placeholder** values.
- Never commit a `.env` file. The repo's `.gitignore` blocks it.

If you accidentally commit a secret: revoke it immediately (re-issue token via @BotFather), then `git filter-repo` or `git rebase -i` the offending commit out before the next push.
