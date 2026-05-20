// JSON.stringify can't serialize BigInt — patch globally so accidental escapes don't crash.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import { env } from "./lib/env.js";
import { buildServer } from "./api/index.js";
import { startBot } from "./bot/index.js";
import { startReminderCron } from "./services/reminders.js";

async function main() {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  console.log(`✓ HTTP API listening on http://0.0.0.0:${env.PORT}`);

  await startBot();
  startReminderCron();
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
