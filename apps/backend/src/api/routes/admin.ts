import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth.js";
import { prisma } from "../../lib/prisma.js";
import { localDayBoundsUtc } from "../../lib/time.js";
import { serializeBarber, serializeService, serializeUser } from "../serializers.js";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireAdmin);

  // ---- Services ----
  app.get("/api/admin/services", async () => {
    // Includes inactive services so the admin can re-enable them.
    const services = await prisma.service.findMany({ orderBy: { sortOrder: "asc" } });
    return { services: services.map(serializeService) };
  });

  app.put("/api/admin/services/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        durationMin: z.number().int().positive().optional(),
        priceMinor: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "bad_request" });
    const updated = await prisma.service.update({ where: { id: params.data.id }, data: body.data });
    return { service: serializeService(updated) };
  });

  // ---- Apprentices ----
  app.get("/api/admin/apprentices", async () => {
    const apprentices = await prisma.barber.findMany({
      where: { role: "APPRENTICE" },
      include: { user: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      apprentices: apprentices.map((a) => ({
        ...serializeBarber(a),
        user: serializeUser(a.user),
      })),
    };
  });

  app.post("/api/admin/apprentices", async (req, reply) => {
    const body = z
      .object({
        telegramId: z.union([z.string(), z.number()]).transform((v) => BigInt(v)),
        displayName: z.string().min(1).max(60),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", details: body.error.flatten() });

    const user = await prisma.user.upsert({
      where: { telegramId: body.data.telegramId },
      update: { role: "APPRENTICE" },
      create: { telegramId: body.data.telegramId, role: "APPRENTICE", firstName: body.data.displayName },
    });
    const barber = await prisma.barber.upsert({
      where: { userId: user.id },
      update: { role: "APPRENTICE", displayName: body.data.displayName, isActive: true },
      create: { userId: user.id, role: "APPRENTICE", displayName: body.data.displayName, isActive: true },
    });
    return reply.code(201).send({ ...serializeBarber(barber), user: serializeUser(user) });
  });

  app.patch("/api/admin/apprentices/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({ isActive: z.boolean().optional(), displayName: z.string().optional() })
      .safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "bad_request" });
    const updated = await prisma.barber.update({ where: { id: params.data.id }, data: body.data });
    return { ...serializeBarber(updated) };
  });

  app.delete("/api/admin/apprentices/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "bad_request" });
    const barber = await prisma.barber.findUnique({ where: { id: params.data.id } });
    if (!barber) return reply.code(404).send({ error: "not_found" });
    await prisma.barber.delete({ where: { id: barber.id } });
    await prisma.user.update({ where: { id: barber.userId }, data: { role: "CUSTOMER" } });
    return { deletedId: barber.id };
  });

  // ---- Client database ----
  app.get("/api/admin/users", async (req) => {
    const q = z
      .object({ search: z.string().optional(), limit: z.coerce.number().int().max(200).default(100) })
      .safeParse(req.query);
    const search = q.success ? q.data.search : undefined;
    const limit = q.success ? q.data.limit : 100;
    const users = await prisma.user.findMany({
      where: search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { username: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return { users: users.map(serializeUser) };
  });

  // ---- Settings ----
  app.put("/api/admin/settings", async (req, reply) => {
    const body = z
      .object({
        shopName: z.string().min(1).optional(),
        timezone: z.string().min(1).optional(),
        currency: z.string().min(1).optional(),
        reminderLeadMin: z.number().int().min(0).max(120).optional(),
        openHourMin: z.number().int().min(0).max(1440).optional(),
        closeHourMin: z.number().int().min(0).max(1440).optional(),
        location: z.string().max(300).nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", details: body.error.flatten() });
    const settings = await prisma.settings.update({ where: { id: "singleton" }, data: body.data });
    return { settings };
  });

  // ---- Finances ----
  app.get("/api/admin/finances/summary", async (req) => {
    const q = z
      .object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .safeParse(req.query);
    const fromKey = q.success && q.data.from ? q.data.from : new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const toKey = q.success && q.data.to ? q.data.to : new Date().toISOString().slice(0, 10);
    const { start } = localDayBoundsUtc(fromKey);
    const { end } = localDayBoundsUtc(toKey);
    const grouped = await prisma.booking.groupBy({
      by: ["barberId", "status"],
      where: { startAt: { gte: start, lt: end } },
      _sum: { totalPriceMinor: true },
      _count: { _all: true },
    });
    return { from: fromKey, to: toKey, rows: grouped };
  });
}
