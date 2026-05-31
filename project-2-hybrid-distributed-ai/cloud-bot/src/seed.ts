/**
 * Seed script — inserts the admin barber(s) listed in ADMIN_TELEGRAM_IDS.
 *
 * Lives in src/ so it compiles to dist/seed.js and can run in the production
 * image WITHOUT the tsx dev-dependency (which is pruned in the runtime image).
 *
 * Run locally:        npm run seed
 * Run in container:   node dist/seed.js   (done automatically by docker compose)
 *
 * Idempotent: re-running upserts the same barbers by telegramId, so it is safe
 * to run after every deploy. Reads env directly (process.env) to avoid pulling
 * the full bot/runtime env schema into the seed.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function parseAdminIds(raw: string | undefined): bigint[] {
  if (!raw) return [];
  const ids: bigint[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      ids.push(BigInt(trimmed));
    } catch {
      throw new Error(`ADMIN_TELEGRAM_IDS contains a non-numeric value: "${trimmed}"`);
    }
  }
  return ids;
}

async function main(): Promise<void> {
  const adminIds = parseAdminIds(process.env.ADMIN_TELEGRAM_IDS);

  if (adminIds.length === 0) {
    throw new Error(
      "ADMIN_TELEGRAM_IDS is empty. Set it (comma-separated Telegram user IDs) before seeding.",
    );
  }

  for (let i = 0; i < adminIds.length; i++) {
    const telegramId = adminIds[i]!;
    const name = `Barber ${i + 1}`;
    const barber = await prisma.barber.upsert({
      where: { telegramId },
      update: {}, // do not clobber a name the barber may have changed later
      create: { telegramId, name },
    });
    console.log(`Seeded barber ${barber.name} (telegramId=${telegramId.toString()})`);
  }

  console.log(`Done. ${adminIds.length} barber(s) ensured.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
