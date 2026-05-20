import type { FastifyInstance } from "fastify";
import { requireAuth } from "../auth.js";
import { prisma } from "../../lib/prisma.js";
import { serializeBarber, serializeService } from "../serializers.js";

export async function catalogRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/barbers", async () => {
    const barbers = await prisma.barber.findMany({
      where: { isActive: true },
      orderBy: [{ role: "asc" }, { displayName: "asc" }],
    });
    return { barbers: barbers.map(serializeBarber) };
  });

  app.get("/api/services", async () => {
    const services = await prisma.service.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    return { services: services.map(serializeService) };
  });
}
