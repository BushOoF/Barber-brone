/**
 * Operator seed: turns the IDs from OPERATOR_TELEGRAM_IDS into rows in the
 * Operator table. The first ID is marked super (can add/remove other operators).
 *
 * Safe to re-run — operators are upserted by telegramId.
 */
import "dotenv/config";
import { PrismaClient } from "./generated/index.js";

const prisma = new PrismaClient();

async function main() {
  const raw = (process.env.OPERATOR_TELEGRAM_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (raw.length === 0) {
    console.log("No OPERATOR_TELEGRAM_IDS set — skipping operator seed.");
    return;
  }

  for (let i = 0; i < raw.length; i++) {
    const tgId = BigInt(raw[i]);
    await prisma.operator.upsert({
      where: { telegramId: tgId },
      update: { isSuper: i === 0 },
      create: { telegramId: tgId, isSuper: i === 0 },
    });
    console.log(`Operator ${tgId} ${i === 0 ? "(super)" : ""} seeded.`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
