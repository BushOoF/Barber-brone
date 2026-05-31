# syntax=docker/dockerfile:1

# ---- Build stage ----
# node:20-slim (Debian) ships the OpenSSL libs Prisma's query engine needs.
FROM node:20-slim AS build
WORKDIR /app

# Install deps (with dev deps for the TypeScript build + prisma generate).
COPY package.json package-lock.json* ./
RUN npm install

# Prisma client must be generated against the schema before compiling.
COPY prisma ./prisma
RUN npx prisma generate

# Compile TypeScript -> dist
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Drop dev dependencies to slim the node_modules we copy into the runtime image.
RUN npm prune --omit=dev


# ---- Runtime stage ----
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Prisma engines need OpenSSL at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Copy only what we need to run.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

# Run as the unprivileged user that the node image already provides.
USER node

# The entrypoint script runs migrations + seed, then starts the bot.
# (Defined in docker-compose.yml command so it stays visible / editable.)
CMD ["node", "dist/index.js"]
