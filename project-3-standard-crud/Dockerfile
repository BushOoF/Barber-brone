# syntax=docker/dockerfile:1

# ---------- Builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# OpenSSL is required by Prisma's query engine at generate/runtime.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install all deps (incl. dev) for building.
COPY package.json package-lock.json* ./
RUN npm install

# Generate Prisma client, then compile TypeScript.
COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies to slim node_modules for the runtime image.
RUN npm prune --omit=dev

# ---------- Runtime ----------
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bring over pruned deps, compiled output, prisma schema, and the entrypoint.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Run as the built-in non-root "node" user.
USER node

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]
