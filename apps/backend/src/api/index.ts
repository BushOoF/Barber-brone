import Fastify from "fastify";
import cors from "@fastify/cors";
import { webhookCallback } from "grammy";
import { bot } from "../bot/index.js";
import { env, isProd } from "../lib/env.js";
import { meRoutes } from "./routes/me.js";
import { catalogRoutes } from "./routes/catalog.js";
import { availabilityRoutes } from "./routes/availability.js";
import { bookingRoutes } from "./routes/bookings.js";
import { blockRoutes } from "./routes/blocks.js";
import { adminRoutes } from "./routes/admin.js";

export async function buildServer() {
  const app = Fastify({
    logger: { level: isProd ? "info" : "info" },
    bodyLimit: 1024 * 256,
  });

  // BigInt fields (e.g. telegramId) are serialized as strings by our serializers,
  // but harden against accidental leaks.
  app.setSerializerCompiler(({ schema, method, url, httpStatus }) => {
    return (data) => JSON.stringify(data, (_, v) => (typeof v === "bigint" ? v.toString() : v));
  });

  const allowedOrigins = new Set<string>([env.WEBAPP_URL, ...env.CORS_EXTRA_ORIGINS]);
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // server-to-server, native app, etc.
      if (allowedOrigins.has(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"), false);
    },
    credentials: true,
  });

  app.get("/healthz", async () => ({ ok: true, ts: new Date().toISOString() }));

  await app.register(meRoutes);
  await app.register(catalogRoutes);
  await app.register(availabilityRoutes);
  await app.register(bookingRoutes);
  await app.register(blockRoutes);
  await app.register(adminRoutes);

  // Telegram webhook endpoint (used in production)
  if (env.TELEGRAM_WEBHOOK_URL) {
    const handle = webhookCallback(bot, "fastify", {
      secretToken: env.TELEGRAM_WEBHOOK_SECRET || undefined,
    });
    app.post("/telegram/webhook", handle);
  }

  return app;
}
