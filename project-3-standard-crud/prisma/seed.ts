/**
 * Seed script: inserts the admin barber(s) listed in ADMIN_TELEGRAM_IDS.
 *
 * Idempotent — upserts by telegramId so running it repeatedly is safe.
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";

config();

const prisma = new PrismaClient();

function parseAdminIds(raw: string | undefined): bigint[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return BigInt(s);
      } catch {
        throw new Error(`ADMIN_TELEGRAM_IDS contains a non-numeric value: "${s}"`);
      }
    });
}

async function main() {
  const ids = parseAdminIds(process.env.ADMIN_TELEGRAM_IDS);

  if (ids.length === 0) {
    console.warn(
      "[seed] ADMIN_TELEGRAM_IDS is empty — no barbers were created. " +
        "Set it in your .env (comma-separated Telegram numeric IDs) and re-run.",
    );
    return;
  }

  for (let i = 0; i < ids.length; i++) {
    const telegramId = ids[i]!;
    const name = `Barber ${i + 1}`;
    const barber = await prisma.barber.upsert({
      where: { telegramId },
      update: { isActive: true },
      create: { telegramId, name, isActive: true },
    });
    console.log(`[seed] ensured barber id=${barber.id} telegramId=${telegramId} name="${barber.name}"`);
  }

  console.log(`[seed] done — ${ids.length} admin barber(s) ensured.`);
}

main()
  .catch((err) => {
    console.error("[seed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
