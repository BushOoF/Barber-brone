import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth.js";
import { prisma } from "../../lib/prisma.js";
import { findNextSlot, getDaySlots } from "../../services/availability.js";
import { quote } from "../../services/pricing.js";

const querySchema = z.object({
  barberId: z.string().min(1),
  durationMin: z.coerce.number().int().positive().optional(),
  // Selection used to derive durationMin when not provided
  adults: z.coerce.number().int().min(0).optional(),
  children: z.coerce.number().int().min(0).optional(),
  services: z.string().optional(), // comma-separated addon keys
  adultStyleKey: z.string().optional(),
  childStyleKey: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

async function deriveDuration(q: z.infer<typeof querySchema>): Promise<number> {
  if (q.durationMin) return q.durationMin;
  const adults = q.adults ?? 1;
  const children = q.children ?? 0;
  const services = (q.services?.split(",").map((s) => s.trim()).filter(Boolean)) ?? [];
  const all = await prisma.service.findMany({ where: { isActive: true } });
  return quote(all, {
    adults,
    children,
    serviceKeys: services,
    selectedAdultStyleKey: q.adultStyleKey ?? null,
    selectedChildStyleKey: q.childStyleKey ?? null,
  }).durationMin;
}

export async function availabilityRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/availability/next", async (req, reply) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "bad_query", details: parsed.error.flatten() });
    const duration = await deriveDuration(parsed.data);
    const slot = await findNextSlot(parsed.data.barberId, duration);
    return {
      durationMin: duration,
      slot: slot ? { startAt: slot.startAt.toISOString(), endAt: slot.endAt.toISOString() } : null,
    };
  });

  app.get("/api/availability/day", async (req, reply) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "bad_query", details: parsed.error.flatten() });
    const date = parsed.data.date;
    if (!date) return reply.code(400).send({ error: "date_required" });
    const duration = await deriveDuration(parsed.data);
    const slots = await getDaySlots(parsed.data.barberId, date, duration);
    return {
      durationMin: duration,
      date,
      slots: slots.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString() })),
    };
  });
}
