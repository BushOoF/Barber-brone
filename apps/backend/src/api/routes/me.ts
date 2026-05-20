import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { prisma } from "../../lib/prisma.js";
import { serializeUser } from "../serializers.js";

export async function meRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/me", async (req) => {
    const { user, barber } = req.auth!;
    const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
    return {
      user: serializeUser(user),
      barber: barber
        ? { id: barber.id, role: barber.role, displayName: barber.displayName, isActive: barber.isActive }
        : null,
      shop: {
        name: settings?.shopName ?? "Barbershop",
        timezone: settings?.timezone ?? "Asia/Tashkent",
        currency: settings?.currency ?? "UZS",
        openHourMin: settings?.openHourMin ?? 540,
        closeHourMin: settings?.closeHourMin ?? 1260,
      },
    };
  });
}
