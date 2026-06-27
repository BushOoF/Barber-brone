import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth.js";
import { prisma } from "../../lib/prisma.js";
import { localDayBoundsUtc } from "../../lib/time.js";
import { serializeBarber, serializeFinanceEntry, serializeService, serializeUser } from "../serializers.js";
import { broadcastAnnouncement } from "../../services/announcements.js";
import { summarizeManual } from "../../services/finances.js";
import { normalizePhone, phoneMatchKey } from "../../lib/phone.js";

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireAdmin);

  // ---- Services ----
  app.get("/api/admin/services", async () => {
    // Includes inactive services so the admin can re-enable them.
    const services = await prisma.service.findMany({
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
    });
    return { services: services.map(serializeService) };
  });

  // Create a new service (typically a new haircut style, e.g. "Fade", "Pompadour")
  app.post("/api/admin/services", async (req, reply) => {
    const body = z
      .object({
        name: z.string().min(1).max(80),
        category: z.enum(["HAIRCUT_ADULT", "HAIRCUT_CHILD", "ADDON"]),
        priceMinor: z.number().int().min(0),
        durationMin: z.number().int().min(1).max(480),
        isDefault: z.boolean().optional().default(false),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", details: body.error.flatten() });

    // Generate a stable, unique key from the name (lowercased, alphanumeric, with category prefix).
    const slug = body.data.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40);
    const prefix =
      body.data.category === "HAIRCUT_ADULT" ? "haircut_adult"
      : body.data.category === "HAIRCUT_CHILD" ? "haircut_child"
      : "addon";
    let key = `${prefix}_${slug || Date.now()}`;
    // Ensure uniqueness in case of collisions.
    while (await prisma.service.findUnique({ where: { key } })) {
      key = `${prefix}_${slug || "x"}_${Math.floor(Math.random() * 1000)}`;
    }

    // If isDefault=true, clear the existing default in this category first.
    if (body.data.isDefault && body.data.category !== "ADDON") {
      await prisma.service.updateMany({
        where: { category: body.data.category, isDefault: true },
        data: { isDefault: false },
      });
    }

    const maxSort = await prisma.service.aggregate({ _max: { sortOrder: true } });
    const service = await prisma.service.create({
      data: {
        key,
        name: body.data.name,
        category: body.data.category,
        priceMinor: body.data.priceMinor,
        durationMin: body.data.durationMin,
        isDefault: body.data.isDefault,
        isActive: true,
        sortOrder: (maxSort._max.sortOrder ?? 0) + 10,
      },
    });
    return reply.code(201).send({ service: serializeService(service) });
  });

  app.delete("/api/admin/services/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "bad_request" });
    const svc = await prisma.service.findUnique({ where: { id: params.data.id } });
    if (!svc) return reply.code(404).send({ error: "not_found" });
    if (svc.isDefault) {
      return reply.code(409).send({
        error: "is_default",
        message: "Cannot delete the default haircut style. Mark another style as default first.",
      });
    }
    await prisma.service.delete({ where: { id: svc.id } });
    return { deletedId: svc.id };
  });

  app.put("/api/admin/services/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z
      .object({
        name: z.string().min(1).optional(),
        durationMin: z.number().int().positive().optional(),
        priceMinor: z.number().int().min(0).optional(),
        isActive: z.boolean().optional(),
        isDefault: z.boolean().optional(),
      })
      .safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "bad_request" });

    const existing = await prisma.service.findUnique({ where: { id: params.data.id } });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    // Promoting a style to default? Clear the existing default in the same category first.
    if (body.data.isDefault === true && existing.category !== "ADDON") {
      await prisma.service.updateMany({
        where: { category: existing.category, isDefault: true, NOT: { id: existing.id } },
        data: { isDefault: false },
      });
    }
    // Don't allow un-marking the only default in a haircut category.
    if (body.data.isDefault === false && existing.isDefault && existing.category !== "ADDON") {
      const otherDefaults = await prisma.service.count({
        where: { category: existing.category, isDefault: true, NOT: { id: existing.id } },
      });
      if (otherDefaults === 0) {
        return reply.code(409).send({
          error: "cannot_unmark_only_default",
          message: "Promote another style to default before unmarking this one.",
        });
      }
    }

    const updated = await prisma.service.update({ where: { id: params.data.id }, data: body.data });
    return { service: serializeService(updated) };
  });

  // ---- Announcements ----
  app.get("/api/admin/announcements", async () => {
    const list = await prisma.announcement.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      announcements: list.map((a) => ({
        id: a.id,
        message: a.message,
        photoFileId: a.photoFileId,
        photoName: a.photoName,
        recipients: a.recipients,
        delivered: a.delivered,
        failed: a.failed,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  });

  // Accepts either JSON ({ message }) for text-only, or multipart/form-data
  // (fields: message + optional file "photo") for photo announcements.
  app.post("/api/admin/announcements", async (req, reply) => {
    const { user } = req.auth!;

    let message = "";
    let photo: { buffer: Buffer; filename: string; mimetype: string } | undefined;

    if (req.isMultipart()) {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === "file" && part.fieldname === "photo") {
          // Allow JPEG / PNG / WEBP / GIF — Telegram accepts these as photos.
          if (!/^image\/(jpe?g|png|webp|gif)$/i.test(part.mimetype)) {
            return reply.code(400).send({ error: "bad_photo_type", message: part.mimetype });
          }
          const buffer = await part.toBuffer();
          if (buffer.length === 0) continue; // empty file input
          photo = { buffer, filename: part.filename, mimetype: part.mimetype };
        } else if (part.type === "field" && part.fieldname === "message") {
          message = String(part.value ?? "").trim();
        }
      }
    } else {
      const body = z.object({ message: z.string().min(1).max(2000) }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "bad_request", details: body.error.flatten() });
      message = body.data.message;
    }

    // With a photo, message becomes a caption — Telegram caps captions at 1024.
    const limit = photo ? 1024 : 2000;
    if (!photo && message.length === 0) {
      return reply.code(400).send({ error: "empty_message" });
    }
    if (message.length > limit) {
      return reply.code(400).send({ error: "caption_too_long", limit });
    }

    const result = await broadcastAnnouncement({ message, photo, sentByUserId: user.id });
    return reply.code(201).send({ announcement: result });
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

  // Add an apprentice by phone number. If someone with that number already uses
  // the bot, they're promoted in place. Otherwise we create a "placeholder" user
  // (no Telegram account yet) that gets linked when they /start the bot and share
  // the matching contact.
  app.post("/api/admin/apprentices", async (req, reply) => {
    const body = z
      .object({
        phone: z.string().min(3).max(32),
        displayName: z.string().min(1).max(60),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", details: body.error.flatten() });

    const key = phoneMatchKey(body.data.phone);
    if (key.length < 7) return reply.code(400).send({ error: "bad_phone" });
    const normalized = normalizePhone(body.data.phone);

    // Match an existing user by the last digits of their phone (formatting-agnostic).
    const existing = await prisma.user.findFirst({ where: { phone: { contains: key } } });
    if (existing && existing.role === "ADMIN") {
      return reply.code(409).send({ error: "is_admin", message: "That number belongs to the shop admin." });
    }

    const user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { role: "APPRENTICE" } })
      : await prisma.user.create({
          data: { phone: normalized, role: "APPRENTICE", firstName: body.data.displayName },
        });

    const barber = await prisma.barber.upsert({
      where: { userId: user.id },
      update: { role: "APPRENTICE", displayName: body.data.displayName, isActive: true },
      create: { userId: user.id, role: "APPRENTICE", displayName: body.data.displayName, isActive: true },
    });
    // `linked=false` tells the UI the apprentice must still open the bot to activate.
    return reply.code(201).send({
      ...serializeBarber(barber),
      user: serializeUser(user),
      linked: user.telegramId != null,
    });
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
    const barber = await prisma.barber.findUnique({ where: { id: params.data.id }, include: { user: true } });
    if (!barber) return reply.code(404).send({ error: "not_found" });
    await prisma.barber.delete({ where: { id: barber.id } });
    // A placeholder apprentice that never linked a Telegram account is pure
    // bookkeeping — remove it entirely. A real user is just demoted to customer.
    if (barber.user.telegramId == null) {
      await prisma.user.delete({ where: { id: barber.userId } });
    } else {
      await prisma.user.update({ where: { id: barber.userId }, data: { role: "CUSTOMER" } });
    }
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
    // Fold in manual income/expense, expanding recurring entries across the range.
    const entries = await prisma.financeEntry.findMany();
    const manual = summarizeManual(entries, fromKey, toKey);
    return {
      from: fromKey,
      to: toKey,
      rows: grouped,
      manualIncomeMinor: manual.incomeMinor,
      manualExpenseMinor: manual.expenseMinor,
    };
  });

  // ---- Finances: manual income / expense entries ----
  app.get("/api/admin/finances/entries", async () => {
    const entries = await prisma.financeEntry.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    return { entries: entries.map(serializeFinanceEntry) };
  });

  app.post("/api/admin/finances/entries", async (req, reply) => {
    const body = z
      .object({
        kind: z.enum(["INCOME", "EXPENSE"]),
        amountMinor: z.number().int().positive(),
        note: z.string().max(200).nullable().optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        repeatEveryDays: z.number().int().min(1).max(366).nullable().optional(),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "bad_request", details: body.error.flatten() });
    const entry = await prisma.financeEntry.create({
      data: {
        kind: body.data.kind,
        amountMinor: body.data.amountMinor,
        note: body.data.note ?? null,
        date: body.data.date,
        repeatEveryDays: body.data.repeatEveryDays ?? null,
      },
    });
    return reply.code(201).send({ entry: serializeFinanceEntry(entry) });
  });

  app.delete("/api/admin/finances/entries/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "bad_request" });
    const existing = await prisma.financeEntry.findUnique({ where: { id: params.data.id } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    await prisma.financeEntry.delete({ where: { id: params.data.id } });
    return { deletedId: params.data.id };
  });
}
