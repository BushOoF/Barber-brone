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

  // Default service catalog. The two haircut rows are flagged isDefault=true so
  // they act as the fallback "style" when a customer doesn't pick one explicitly.
  const services = [
    {
      key: "haircut_adult", name: "Haircut (Adult)",
      category: "HAIRCUT_ADULT" as const, isDefault: true,
      durationMin: 40, priceMinor: 80_000, sortOrder: 10,
    },
    {
      key: "haircut_child", name: "Haircut (Child)",
      category: "HAIRCUT_CHILD" as const, isDefault: true,
      durationMin: 30, priceMinor: 60_000, sortOrder: 20,
    },
    {
      key: "wash", name: "Hair wash",
      category: "ADDON" as const, isDefault: false,
      durationMin: 10, priceMinor: 15_000, sortOrder: 30,
    },
    {
      key: "beard", name: "Beard cut",
      category: "ADDON" as const, isDefault: false,
      durationMin: 20, priceMinor: 40_000, sortOrder: 40,
    },
  ];

  for (const s of services) {
    await prisma.service.upsert({
      where: { key: s.key },
      update: {
        name: s.name,
        category: s.category,
        isDefault: s.isDefault,
        durationMin: s.durationMin,
        priceMinor: s.priceMinor,
        sortOrder: s.sortOrder,
      },
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
