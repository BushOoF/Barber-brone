import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireStaff } from "../auth.js";
import { prisma } from "../../lib/prisma.js";
import { localDayBoundsUtc, todayKey } from "../../lib/time.js";
import { normalizeSelection, quote } from "../../services/pricing.js";
import { isSlotAvailable } from "../../services/availability.js";
import { applyMoves, planShiftEarlier } from "../../services/smart-shift.js";
import {
  notifyBookingConfirmed,
  notifyShiftedEarlier,
  notifyShiftedLater,
  notifyTransferred,
} from "../../services/notify.js";
import { localDateKey, localDateTimeToUtc, localDayBoundsUtc } from "../../lib/time.js";
import { serializeBooking } from "../serializers.js";

const createSchema = z.object({
  barberId: z.string().min(1),
  startAt: z.string().datetime(),
  adults: z.number().int().min(1).max(10).default(1),
  children: z.number().int().min(0).max(10).default(0),
  services: z.array(z.string()).default([]),
  remindersOn: z.boolean().default(true),
});

export async function bookingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  // -------- Customer / general --------

  app.post("/api/bookings", async (req, reply) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_body", details: parsed.error.flatten() });
    const body = parsed.data;
    const { user } = req.auth!;

    if (!user.phone) {
      return reply.code(412).send({ error: "phone_required", message: "Share your phone via the bot first." });
    }
    const barber = await prisma.barber.findUnique({ where: { id: body.barberId } });
    if (!barber || !barber.isActive) return reply.code(404).send({ error: "barber_not_found" });

    const allServices = await prisma.service.findMany({ where: { isActive: true } });
    let q;
    try {
      q = quote(allServices, { adults: body.adults, children: body.children, serviceKeys: body.services });
    } catch (err) {
      return reply.code(400).send({ error: "invalid_services", message: (err as Error).message });
    }
    if (q.durationMin <= 0) return reply.code(400).send({ error: "empty_selection" });

    const startAt = new Date(body.startAt);
    if (Number.isNaN(startAt.getTime())) return reply.code(400).send({ error: "bad_start_at" });
    if (!(await isSlotAvailable(barber.id, startAt, q.durationMin))) {
      return reply.code(409).send({ error: "slot_taken" });
    }

    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        barberId: barber.id,
        startAt,
        endAt: new Date(startAt.getTime() + q.durationMin * 60_000),
        durationMin: q.durationMin,
        totalPriceMinor: q.totalPriceMinor,
        adults: body.adults,
        children: body.children,
        services: normalizeSelection({ adults: body.adults, children: body.children, serviceKeys: body.services }),
        remindersOn: body.remindersOn,
        status: "SCHEDULED",
      },
    });

    // Fire-and-forget confirmation message
    void notifyBookingConfirmed(booking.id);

    return reply.code(201).send({ booking: serializeBooking(booking), quote: q });
  });

  app.get("/api/bookings/mine", async (req) => {
    const { user } = req.auth!;
    const now = new Date();
    const bookings = await prisma.booking.findMany({
      where: { userId: user.id, status: "SCHEDULED", endAt: { gte: now } },
      orderBy: { startAt: "asc" },
      include: { barber: true },
    });
    return {
      bookings: bookings.map((b) => ({
        ...serializeBooking(b),
        barber: { id: b.barber.id, displayName: b.barber.displayName, role: b.barber.role },
      })),
    };
  });

  app.patch("/api/bookings/:id/reminders", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    const body = z.object({ remindersOn: z.boolean() }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "bad_request" });
    const { user } = req.auth!;
    const booking = await prisma.booking.findUnique({ where: { id: params.data.id } });
    if (!booking || booking.userId !== user.id) return reply.code(404).send({ error: "not_found" });
    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { remindersOn: body.data.remindersOn },
    });
    return { booking: serializeBooking(updated) };
  });

  app.delete("/api/bookings/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "bad_request" });
    const { user } = req.auth!;
    const booking = await prisma.booking.findUnique({ where: { id: params.data.id } });
    if (!booking || booking.userId !== user.id) return reply.code(404).send({ error: "not_found" });
    if (booking.status !== "SCHEDULED") return reply.code(409).send({ error: "not_active" });

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: "CANCELLED_BY_USER" },
    });

    // Run Smart Shift Earlier so subsequent clients of this barber slide forward.
    const moves = await planShiftEarlier(booking.barberId, booking.startAt, booking.endAt);
    await applyMoves(moves);
    for (const m of moves) void notifyShiftedEarlier(m.bookingId, m.oldStart);

    return { booking: serializeBooking(updated), shifted: moves.length };
  });

  // -------- Staff (admin + apprentice) --------

  app.get(
    "/api/bookings/day",
    { preHandler: requireStaff },
    async (req, reply) => {
      const query = z
        .object({
          barberId: z.string().optional(),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default(todayKey()),
        })
        .safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: "bad_query" });

      const { user, barber } = req.auth!;
      // Apprentices can only see their own day.
      const effectiveBarberId =
        user.role === "ADMIN" ? query.data.barberId ?? barber!.id : barber!.id;

      const { start, end } = localDayBoundsUtc(query.data.date);
      const bookings = await prisma.booking.findMany({
        where: { barberId: effectiveBarberId, startAt: { gte: start, lt: end } },
        orderBy: { startAt: "asc" },
        include: { user: true },
      });
      const blocks = await prisma.timeBlock.findMany({
        where: { barberId: effectiveBarberId, startAt: { gte: start, lt: end } },
        orderBy: { startAt: "asc" },
      });
      return {
        date: query.data.date,
        barberId: effectiveBarberId,
        bookings: bookings.map(serializeBooking),
        blocks: blocks.map((b) => ({
          id: b.id,
          startAt: b.startAt.toISOString(),
          endAt: b.endAt.toISOString(),
          type: b.type,
          note: b.note,
        })),
      };
    },
  );

  // Discard (no-show) → mark + smart-shift earlier + notify.
  app.post(
    "/api/bookings/:id/discard",
    { preHandler: requireStaff },
    async (req, reply) => {
      const params = z.object({ id: z.string() }).safeParse(req.params);
      if (!params.success) return reply.code(400).send({ error: "bad_request" });
      const { user, barber } = req.auth!;

      const booking = await prisma.booking.findUnique({ where: { id: params.data.id } });
      if (!booking) return reply.code(404).send({ error: "not_found" });
      if (user.role === "APPRENTICE" && booking.barberId !== barber!.id) {
        return reply.code(403).send({ error: "not_your_booking" });
      }

      await prisma.booking.update({
        where: { id: booking.id },
        data: { status: "DISCARDED_NO_SHOW" },
      });

      const moves = await planShiftEarlier(booking.barberId, booking.startAt, booking.endAt);
      await applyMoves(moves);

      for (const m of moves) {
        void notifyShiftedEarlier(m.bookingId, m.oldStart);
      }

      return { discardedId: booking.id, shifted: moves.length };
    },
  );

  // Manual time change by staff (swipe-right → "Shift time").
  app.patch(
    "/api/bookings/:id/time",
    { preHandler: requireStaff },
    async (req, reply) => {
      const params = z.object({ id: z.string() }).safeParse(req.params);
      const body = z.object({ startAt: z.string().datetime() }).safeParse(req.body);
      if (!params.success || !body.success) return reply.code(400).send({ error: "bad_request" });
      const { user, barber } = req.auth!;

      const booking = await prisma.booking.findUnique({ where: { id: params.data.id } });
      if (!booking) return reply.code(404).send({ error: "not_found" });
      if (booking.status !== "SCHEDULED") return reply.code(409).send({ error: "not_scheduled" });
      if (user.role === "APPRENTICE" && booking.barberId !== barber!.id) {
        return reply.code(403).send({ error: "not_your_booking" });
      }

      const oldStart = booking.startAt;
      const newStart = new Date(body.data.startAt);
      const newEnd = new Date(newStart.getTime() + booking.durationMin * 60_000);

      // Bounds: within working hours of the target day.
      const dateKey = localDateKey(newStart);
      const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
      const openMin = settings?.openHourMin ?? 540;
      const closeMin = settings?.closeHourMin ?? 1260;
      const openUtc = localDateTimeToUtc(dateKey, openMin);
      const closeUtc = localDateTimeToUtc(dateKey, closeMin);
      if (newStart < openUtc || newEnd > closeUtc) {
        return reply.code(409).send({ error: "outside_hours" });
      }

      // Conflict check: exclude this booking from the overlap query.
      const conflicting = await prisma.booking.count({
        where: {
          barberId: booking.barberId,
          status: "SCHEDULED",
          id: { not: booking.id },
          startAt: { lt: newEnd },
          endAt: { gt: newStart },
        },
      });
      if (conflicting > 0) return reply.code(409).send({ error: "slot_taken" });

      const blockConflict = await prisma.timeBlock.count({
        where: {
          barberId: booking.barberId,
          startAt: { lt: newEnd },
          endAt: { gt: newStart },
        },
      });
      if (blockConflict > 0) return reply.code(409).send({ error: "slot_taken" });

      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { startAt: newStart, endAt: newEnd },
      });

      // Notify the customer with the appropriate-direction message.
      if (newStart.getTime() > oldStart.getTime()) {
        void notifyShiftedLater(updated.id, oldStart);
      } else if (newStart.getTime() < oldStart.getTime()) {
        void notifyShiftedEarlier(updated.id, oldStart);
      }

      return { booking: serializeBooking(updated) };
    },
  );

  // Transfer to apprentice (or any other active barber).
  app.post(
    "/api/bookings/:id/transfer",
    { preHandler: requireStaff },
    async (req, reply) => {
      const params = z.object({ id: z.string() }).safeParse(req.params);
      const body = z.object({ toBarberId: z.string().optional() }).safeParse(req.body ?? {});
      if (!params.success || !body.success) return reply.code(400).send({ error: "bad_request" });
      const { user, barber } = req.auth!;

      const booking = await prisma.booking.findUnique({ where: { id: params.data.id }, include: { barber: true } });
      if (!booking) return reply.code(404).send({ error: "not_found" });
      if (user.role === "APPRENTICE" && booking.barberId !== barber!.id) {
        return reply.code(403).send({ error: "not_your_booking" });
      }

      let targetId = body.data.toBarberId;
      if (!targetId) {
        // Default: pick the first active barber that isn't the current one.
        const candidate = await prisma.barber.findFirst({
          where: { isActive: true, NOT: { id: booking.barberId } },
          orderBy: { role: "asc" },
        });
        if (!candidate) return reply.code(409).send({ error: "no_target_barber" });
        targetId = candidate.id;
      }

      const target = await prisma.barber.findUnique({ where: { id: targetId } });
      if (!target || !target.isActive) return reply.code(404).send({ error: "target_inactive" });
      if (!(await isSlotAvailable(target.id, booking.startAt, booking.durationMin))) {
        return reply.code(409).send({ error: "target_slot_busy" });
      }

      const updated = await prisma.booking.update({
        where: { id: booking.id },
        data: { barberId: target.id },
      });

      void notifyTransferred(booking.id, booking.barber.displayName, target.displayName);
      return { booking: serializeBooking(updated) };
    },
  );
}
