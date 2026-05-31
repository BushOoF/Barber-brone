# Multi-stage build for the monolithic barber bot (Node 20, ESM, Prisma).
# Stage 1: install deps + generate Prisma client + compile TypeScript.
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Install all deps (incl. dev) for the build.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# Generate Prisma client (needs the schema) then build TS -> dist.
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Prune to production deps for a slim runtime layer.
RUN npm prune --omit=dev

# Stage 2: runtime image.
FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# openssl is required by Prisma's query engine at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Run as the non-root user that ships with the node image.
USER node

# Entrypoint: apply migrations, seed admins, then start the bot.
# (Seed is idempotent; migrate deploy is a no-op when up to date.)
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && node dist/index.js"]
