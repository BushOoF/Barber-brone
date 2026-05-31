/**
 * Seed script: inserts the admin barber(s) listed in ADMIN_TELEGRAM_IDS.
 *
 * Idempotent — uses upsert keyed by telegramId, so re-running is safe.
 * Run with: npm run db:seed
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseAdminIds(raw: string | undefined): bigint[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
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
    throw new Error(
      "ADMIN_TELEGRAM_IDS is empty. Set it (csv of Telegram user IDs) before seeding."
    );
  }

  for (let i = 0; i < ids.length; i++) {
    const telegramId = ids[i];
    const name = i === 0 ? "Main Barber" : `Barber ${i + 1}`;
    const barber = await prisma.barber.upsert({
      where: { telegramId },
      update: { isActive: true },
      create: { telegramId, name, isActive: true },
    });
    console.log(`Seeded barber ${barber.name} (telegramId=${telegramId.toString()})`);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error("Seed failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
