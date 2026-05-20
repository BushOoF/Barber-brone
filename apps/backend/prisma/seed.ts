import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Singleton settings row
  await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      shopName: "Barbershop",
      timezone: "Asia/Tashkent",
      currency: "UZS",
      reminderLeadMin: 15,
      openHourMin: 9 * 60,
      closeHourMin: 21 * 60,
    },
  });

  // Default service catalog (UZS, minor units = sums; 1 UZS = 1 unit since no subunits in practice)
  const services = [
    { key: "haircut_adult", name: "Haircut (Adult)", durationMin: 40, priceMinor: 80_000, sortOrder: 10 },
    { key: "haircut_child", name: "Haircut (Child)", durationMin: 30, priceMinor: 60_000, sortOrder: 20 },
    { key: "wash",          name: "Hair wash",       durationMin: 10, priceMinor: 15_000, sortOrder: 30 },
    { key: "beard",         name: "Beard cut",       durationMin: 20, priceMinor: 40_000, sortOrder: 40 },
  ];

  for (const s of services) {
    await prisma.service.upsert({
      where: { key: s.key },
      update: { name: s.name, durationMin: s.durationMin, priceMinor: s.priceMinor, sortOrder: s.sortOrder },
      create: s,
    });
  }

  console.log("Seeded settings + services.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
