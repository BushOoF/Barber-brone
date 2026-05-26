import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdmin, requireAuth } from "../auth.js";
import { prisma } from "../../lib/prisma.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function serializeVacation(v: { id: string; date: string; note: string | null; createdAt: Date }) {
  return {
    id: v.id,
    date: v.date,
    note: v.note,
    createdAt: v.createdAt.toISOString(),
  };
}

export async function vacationRoutes(app: FastifyInstance) {
  // ----- Customer-side: just date strings, so date pickers can grey them out. -----
  app.get("/api/vacations", { preHandler: requireAuth }, async (req, reply) => {
    const q = z.object({ from: z.string().regex(DATE_RE).optional(), to: z.string().regex(DATE_RE).optional() }).safeParse(req.query);
    const where: { date?: { gte?: string; lte?: string } } = {};
    if (q.success) {
      if (q.data.from || q.data.to) {
        where.date = {};
        if (q.data.from) where.date.gte = q.data.from;
        if (q.data.to) where.date.lte = q.data.to;
      }
    }
    const rows = await prisma.vacationDay.findMany({
      where,
      orderBy: { date: "asc" },
      select: { date: true },
    });
    return { dates: rows.map((r) => r.date) };
  });

  // ----- Admin-only: CRUD with notes. -----
  app.register(async (admin) => {
    admin.addHook("preHandler", requireAuth);
    admin.addHook("preHandler", requireAdmin);

    admin.get("/api/admin/vacations", async () => {
      const list = await prisma.vacationDay.findMany({ orderBy: { date: "asc" } });
      return { vacations: list.map(serializeVacation) };
    });

    admin.post("/api/admin/vacations", async (req, reply) => {
      const body = z
        .object({
          date: z.string().regex(DATE_RE, "Date must be YYYY-MM-DD"),
          note: z.string().max(200).nullable().optional(),
        })
        .safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: "bad_request", details: body.error.flatten() });
      try {
        const v = await prisma.vacationDay.create({
          data: { date: body.data.date, note: body.data.note ?? null },
        });
        return reply.code(201).send({ vacation: serializeVacation(v) });
      } catch (err) {
        // Unique violation (date already exists) — surface as 409 so the UI can no-op.
        const code = (err as { code?: string }).code;
        if (code === "P2002") return reply.code(409).send({ error: "already_exists" });
        throw err;
      }
    });

    admin.delete("/api/admin/vacations/:id", async (req, reply) => {
      const params = z.object({ id: z.string() }).safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: "bad_request" });
      await prisma.vacationDay.delete({ where: { id: params.data.id } }).catch(() => null);
      return { deletedId: params.data.id };
    });

    // Convenience: delete-by-date for the calendar toggle UX (no need to ferry IDs around).
    admin.delete("/api/admin/vacations/by-date/:date", async (req, reply) => {
      const params = z.object({ date: z.string().regex(DATE_RE) }).safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: "bad_request" });
      await prisma.vacationDay.delete({ where: { date: params.data.date } }).catch(() => null);
      return { deletedDate: params.data.date };
    });
  });
}
