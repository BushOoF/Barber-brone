// JSON.stringify can't serialize BigInt — patch globally.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import { startBot } from "./bot/index.js";
import { startReminderCrons } from "./services/reminders.js";

async function main() {
  await startBot();
  startReminderCrons();
}

main().catch((err) => {
  console.error("[barber-dev] fatal startup error:", err);
  process.exit(1);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
