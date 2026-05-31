/**
 * Entrypoint for the cloud-bot.
 *
 * Modes:
 *   - Long-polling (default): no WEBHOOK_URL set. Best for a tiny VPS — nothing
 *     to expose, no TLS to manage.
 *   - Webhook (optional): set WEBHOOK_URL (and optionally WEBHOOK_SECRET). We
 *     start a minimal HTTP server on PORT, register the webhook, and let grammY
 *     handle updates. A /healthz route is always available in this mode.
 *
 * The remote AI worker is reached separately by the voice handler (ai/client),
 * over the secure tunnel — this process never exposes the AI.
 */
import { createServer } from "node:http";
import { webhookCallback } from "grammy";
import { env } from "./env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { createBot } from "./bot/index.js";
import { startReminderJob } from "./jobs/reminders.js";

async function main(): Promise<void> {
  const bot = createBot();

  // Set the command menu shown in Telegram clients.
  await bot.api.setMyCommands([
    { command: "start", description: "What this bot does" },
    { command: "today", description: "Show today's schedule" },
  ]);

  const reminderTask = startReminderJob(bot);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info(`Received ${signal}, shutting down…`);
    try {
      reminderTask.stop();
      await bot.stop();
    } catch (err) {
      logger.warn("Error stopping bot", err instanceof Error ? err.message : err);
    }
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (env.WEBHOOK_URL) {
    // ---- Webhook mode ----
    const handle = webhookCallback(bot, "http", {
      secretToken: env.WEBHOOK_SECRET,
    });
    const server = createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/healthz") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok", mode: "webhook" }));
        return;
      }
      if (req.method === "POST" && req.url === "/webhook") {
        try {
          await handle(req, res);
        } catch (err) {
          logger.error("Webhook handler error", err instanceof Error ? err.message : err);
          if (!res.headersSent) {
            res.writeHead(500);
            res.end();
          }
        }
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(env.PORT, () => logger.info(`HTTP server listening on :${env.PORT} (webhook mode)`));

    await bot.api.setWebhook(`${env.WEBHOOK_URL.replace(/\/+$/, "")}/webhook`, {
      secret_token: env.WEBHOOK_SECRET,
    });
    logger.info("Webhook registered with Telegram.");
  } else {
    // ---- Long-polling mode (default) ----
    await bot.api.deleteWebhook({ drop_pending_updates: false }).catch(() => {});
    logger.info("Starting long-polling…");
    // bot.start resolves only when the bot stops; do not await at top level so
    // shutdown handlers can run. Errors surface via bot.catch.
    void bot.start({
      onStart: (info) => logger.info(`Bot @${info.username} is up (long-polling).`),
    });
  }
}

main().catch((err) => {
  logger.error("Fatal startup error", err instanceof Error ? err.stack : err);
  process.exit(1);
});
