/**
 * Process entrypoint for the monolithic barber bot.
 *
 * - Validates env (side-effect of importing ./config/env)
 * - Connects Prisma
 * - Starts the reminder cron
 * - Boots the grammY bot (long-polling)
 * - Shuts everything down cleanly on SIGINT/SIGTERM
 */
import { env } from "./config/env.js";
import { prisma, disconnectPrisma } from "./db/prisma.js";
import { createBot } from "./bot/index.js";
import { startReminderCron } from "./services/reminders.js";
import { pingAi } from "./ai/client.js";

async function main(): Promise<void> {
  // Fail fast if the DB is unreachable.
  await prisma.$connect();
  console.log("Connected to Postgres.");

  // Best-effort AI sidecar liveness check (non-fatal — it may start later).
  const aiUp = await pingAi();
  console.log(
    aiUp
      ? `AI sidecar reachable at ${env.AI_SERVICE_URL}.`
      : `⚠️ AI sidecar not reachable at ${env.AI_SERVICE_URL} yet — voice notes will fail until it's up.`
  );

  const bot = createBot();
  const reminderTask = startReminderCron(bot);

  // grammY long-polling. (Webhook mode is optional; see README.)
  await bot.init();
  console.log(`Bot @${bot.botInfo.username} starting (long-polling)…`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down…`);
    try {
      reminderTask.stop();
      await bot.stop();
    } catch (err) {
      console.error("Error during bot stop:", err);
    }
    await disconnectPrisma().catch((e) => console.error("Prisma disconnect error:", e));
    process.exit(0);
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  // bot.start() resolves only when the bot stops; run it without awaiting so
  // the signal handlers above stay responsive.
  void bot.start({
    onStart: (info) => console.log(`Listening as @${info.username}.`),
    drop_pending_updates: true,
  });
}

main().catch(async (err) => {
  console.error("Fatal startup error:", err);
  await disconnectPrisma().catch(() => {});
  process.exit(1);
});
