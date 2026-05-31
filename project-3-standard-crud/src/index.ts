/**
 * Process entrypoint. Boots the bot (long-polling by default — see README for
 * the webhook option), starts the reminder cron, sweeps stale wizard sessions,
 * and wires graceful shutdown.
 */
import { bot } from "./bot/index.js";
import { env } from "./env.js";
import { disconnectDb, prisma } from "./db.js";
import { startReminderCron } from "./reminders.js";
import { sweepSessions } from "./wizard.js";

async function main() {
  // Fail fast if the DB is unreachable, with a clear message.
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    console.error("✗ Could not reach the database. Check DATABASE_URL and that Postgres is up.");
    console.error(err);
    process.exit(1);
  }

  // Register the slash-command menu shown in Telegram clients (best-effort).
  try {
    await bot.api.setMyCommands([
      { command: "menu", description: "Open the main menu" },
      { command: "today", description: "Today's agenda" },
      { command: "add", description: "Add an appointment" },
      { command: "break", description: "Block off a break" },
      { command: "cancel", description: "Cancel an appointment" },
      { command: "reschedule", description: "Move an appointment" },
      { command: "help", description: "Show help" },
    ]);
  } catch (err) {
    console.warn("[startup] could not set bot commands (continuing):", err);
  }

  const reminderTask = startReminderCron(bot);

  const sweepTimer = setInterval(sweepSessions, 5 * 60 * 1000);
  sweepTimer.unref?.();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[shutdown] received ${signal}, stopping…`);
    try {
      reminderTask.stop();
      clearInterval(sweepTimer);
      await bot.stop();
      await disconnectDb();
    } catch (err) {
      console.error("[shutdown] error during cleanup:", err);
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  console.log(`✓ starting bot (long-polling) in ${env.NODE_ENV} mode, shop tz ${env.SHOP_TZ}`);
  // bot.start() resolves only when the bot stops; run it without awaiting so
  // the signal handlers above stay responsive.
  await bot.start({
    onStart: (info) => console.log(`✓ bot online as @${info.username}`),
    drop_pending_updates: true,
  });
}

main().catch((err) => {
  console.error("✗ fatal startup error:", err);
  process.exit(1);
});
