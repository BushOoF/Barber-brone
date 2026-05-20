import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireStaff } from "../auth.js";
import { prisma } from "../../lib/prisma.js";
import { applyMoves, planShiftLater } from "../../services/smart-shift.js";
import { isSlotAvailable } from "../../services/availability.js";
import { notifyShiftedLater, notifyTransferred } from "../../services/notify.js";

const insertSchema = z.object({
  /** Omit for self-block (apprentice or admin blocking their own time). Admin may set another barber. */
  barberId: z.string().optional(),
  startAt: z.string().datetime(),
  durationMin: z.number().int().min(5).max(8 * 60),
  type: z.enum(["BREAK", "WALK_IN", "MANUAL"]).default("BREAK"),
  note: z.string().max(200).optional(),
  /**
   * "dry_run"  → simulate and return plan (overlapping + shifted moves).
   * "shift"    → push overlapping/later bookings later, create block.
   * "transfer" → move overlapping bookings to `toBarberId` (default: first other active barber), create block.
   */
  mode: z.enum(["dry_run", "shift", "transfer"]).default("shift"),
  toBarberId: z.string().optional(),
});

export async function blockRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);
  app.addHook("preHandler", requireStaff);

  app.post("/api/blocks", async (req, reply) => {
    const parsed = insertSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "bad_body", details: parsed.error.flatten() });
    const body = parsed.data;
    const { user, barber } = req.auth!;

    const targetBarberId = user.role === "ADMIN" ? body.barberId ?? barber!.id : barber!.id;

    const startAt = new Date(body.startAt);
    const endAt = new Date(startAt.getTime() + body.durationMin * 60_000);

    // Overlapping bookings — used by every mode.
    const overlapping = await prisma.booking.findMany({
      where: {
        barberId: targetBarberId,
        status: "SCHEDULED",
        endAt: { gt: startAt },
        startAt: { lt: endAt },
      },
      include: { user: true, barber: true },
    });

    if (body.mode === "dry_run") {
      const plan = await planShiftLater(targetBarberId, startAt, endAt);
      // Suggest the first other active barber as a default transfer target.
      const suggested = await prisma.barber.findFirst({
        where: { isActive: true, NOT: { id: targetBarberId } },
        orderBy: { role: "asc" },
      });
      // For each overlapping booking, check if the suggested barber is available at that slot.
      const transferable = suggested
        ? await Promise.all(
            overlapping.map(async (b) => ({
              bookingId: b.id,
              canTransfer: await isSlotAvailable(suggested.id, b.startAt, b.durationMin),
            })),
          )
        : [];
      return {
        plan: {
          moves: plan.moves.map((m) => ({
            bookingId: m.bookingId,
            oldStart: m.oldStart.toISOString(),
            newStart: m.newStart.toISOString(),
            newEnd: m.newEnd.toISOString(),
          })),
          unplaceable: plan.unplaceable,
          overlapping: overlapping.map((c) => ({
            bookingId: c.id,
            startAt: c.startAt.toISOString(),
            durationMin: c.durationMin,
            customer: c.user.firstName ?? c.user.username ?? "Customer",
            phone: c.user.phone,
          })),
          suggestedTransferTo: suggested ? { id: suggested.id, displayName: suggested.displayName } : null,
          transferable,
        },
      };
    }

    if (body.mode === "transfer") {
      const targetId = body.toBarberId ?? null;
      const target = targetId
        ? await prisma.barber.findUnique({ where: { id: targetId } })
        : await prisma.barber.findFirst({
            where: { isActive: true, NOT: { id: targetBarberId } },
            orderBy: { role: "asc" },
          });
      if (!target || !target.isActive) return reply.code(409).send({ error: "no_transfer_target" });

      // Check availability for each overlapping booking against the target.
      const transfers: { bookingId: string; oldBarberName: string; newBarberName: string }[] = [];
      const refused: string[] = [];
      for (const b of overlapping) {
        if (await isSlotAvailable(target.id, b.startAt, b.durationMin)) {
          await prisma.booking.update({ where: { id: b.id }, data: { barberId: target.id } });
          transfers.push({ bookingId: b.id, oldBarberName: b.barber.displayName, newBarberName: target.displayName });
        } else {
          refused.push(b.id);
        }
      }

      const block = await prisma.timeBlock.create({
        data: { barberId: targetBarberId, startAt, endAt, type: body.type, note: body.note },
      });

      for (const t of transfers) void notifyTransferred(t.bookingId, t.oldBarberName, t.newBarberName);

      return reply.code(201).send({
        block: {
          id: block.id,
          startAt: block.startAt.toISOString(),
          endAt: block.endAt.toISOString(),
          type: block.type,
        },
        transferred: transfers.length,
        refused,
      });
    }

    // mode === "shift"
    const plan = await planShiftLater(targetBarberId, startAt, endAt);
    await applyMoves(plan.moves);
    const block = await prisma.timeBlock.create({
      data: { barberId: targetBarberId, startAt, endAt, type: body.type, note: body.note },
    });
    for (const m of plan.moves) void notifyShiftedLater(m.bookingId, m.oldStart);

    return reply.code(201).send({
      block: { id: block.id, startAt: block.startAt.toISOString(), endAt: block.endAt.toISOString(), type: block.type },
      shifted: plan.moves.length,
      unplaceable: plan.unplaceable,
    });
  });

  app.delete("/api/blocks/:id", async (req, reply) => {
    const params = z.object({ id: z.string() }).safeParse(req.params);
    if (!params.success) return reply.code(400).send({ error: "bad_request" });
    const { user, barber } = req.auth!;
    const block = await prisma.timeBlock.findUnique({ where: { id: params.data.id } });
    if (!block) return reply.code(404).send({ error: "not_found" });
    if (user.role === "APPRENTICE" && block.barberId !== barber!.id) {
      return reply.code(403).send({ error: "not_your_block" });
    }
    await prisma.timeBlock.delete({ where: { id: block.id } });
    return { deletedId: block.id };
  });
}
