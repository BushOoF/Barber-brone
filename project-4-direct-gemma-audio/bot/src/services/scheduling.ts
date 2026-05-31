/**
 * Scheduling service — the booking core.
 *
 * Times are stored in UTC. Overlap detection uses the standard half-open
 * interval rule: [aStart, aEnd) overlaps [bStart, bEnd) iff aStart < bEnd && bStart < aEnd.
 * So an appointment that ends exactly when another starts does NOT conflict.
 *
 * No auto-shift cascade: conflicts are returned/reported, never silently moved.
 * (The full smart-shift cascade is intentionally out of scope here.)
 */
import type { Appointment, Block, Client, BlockType, AppointmentSource } from "@prisma/client";
import { prisma } from "../db/prisma.js";

/** Two half-open intervals overlap? */
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

// ---------------------------------------------------------------------------
// listDay
// ---------------------------------------------------------------------------

export interface DayAgenda {
  appointments: (Appointment & { client: Client | null })[];
  blocks: Block[];
}

/**
 * Appointments (non-CANCELLED) + blocks for a barber on a local day,
 * each list ordered by startAt. Caller supplies the local-day UTC bounds.
 */
export async function listDay(
  barberId: string,
  dayStartUtc: Date,
  dayEndUtc: Date
): Promise<DayAgenda> {
  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barberId,
        status: { not: "CANCELLED" },
        startAt: { gte: dayStartUtc, lt: dayEndUtc },
      },
      orderBy: { startAt: "asc" },
      include: { client: true },
    }),
    prisma.block.findMany({
      where: {
        barberId,
        startAt: { gte: dayStartUtc, lt: dayEndUtc },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);
  return { appointments, blocks };
}

// ---------------------------------------------------------------------------
// createAppointment
// ---------------------------------------------------------------------------

export interface CreateAppointmentInput {
  barberId: string;
  clientId?: string | null;
  startAt: Date;
  durationMin: number;
  isWalkIn?: boolean;
  note?: string | null;
  source: AppointmentSource;
}

/** A structured conflict: what we collided with and when. */
export type Conflict =
  | { kind: "appointment"; item: Appointment & { client: Client | null }; startAt: Date; endAt: Date }
  | { kind: "block"; item: Block; startAt: Date; endAt: Date };

export type CreateAppointmentResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; conflict: Conflict };

/**
 * Create an appointment. endAt = startAt + durationMin.
 * Rejects (no write) if it overlaps any SCHEDULED appointment or any Block
 * for the barber, returning the first conflicting item.
 */
export async function createAppointment(
  input: CreateAppointmentInput
): Promise<CreateAppointmentResult> {
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    throw new Error(`durationMin must be a positive number, got ${input.durationMin}`);
  }
  const startAt = input.startAt;
  const endAt = new Date(startAt.getTime() + input.durationMin * 60_000);

  // Pull candidate items that could possibly overlap (start before our end,
  // end after our start). Then confirm with the half-open rule.
  const [appts, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barberId: input.barberId,
        status: "SCHEDULED",
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      orderBy: { startAt: "asc" },
      include: { client: true },
    }),
    prisma.block.findMany({
      where: {
        barberId: input.barberId,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);

  const apptConflict = appts.find((a) => overlaps(startAt, endAt, a.startAt, a.endAt));
  if (apptConflict) {
    return {
      ok: false,
      conflict: { kind: "appointment", item: apptConflict, startAt: apptConflict.startAt, endAt: apptConflict.endAt },
    };
  }
  const blockConflict = blocks.find((b) => overlaps(startAt, endAt, b.startAt, b.endAt));
  if (blockConflict) {
    return {
      ok: false,
      conflict: { kind: "block", item: blockConflict, startAt: blockConflict.startAt, endAt: blockConflict.endAt },
    };
  }

  const appointment = await prisma.appointment.create({
    data: {
      barberId: input.barberId,
      clientId: input.clientId ?? null,
      startAt,
      endAt,
      isWalkIn: input.isWalkIn ?? false,
      note: input.note ?? null,
      source: input.source,
      status: "SCHEDULED",
    },
  });
  return { ok: true, appointment };
}

// ---------------------------------------------------------------------------
// createBlock
// ---------------------------------------------------------------------------

export interface CreateBlockInput {
  barberId: string;
  startAt: Date;
  endAt: Date;
  type: BlockType;
  note?: string | null;
}

export interface CreateBlockResult {
  block: Block;
  /** SCHEDULED appointments that overlap the new block. NOT auto-cancelled. */
  overlappingAppointments: (Appointment & { client: Client | null })[];
}

/**
 * Create a block (break / walk-in / other). Does NOT cancel anything; instead
 * returns the SCHEDULED appointments it overlaps so the bot can warn first.
 * The caller is expected to have already obtained confirmation.
 */
export async function createBlock(input: CreateBlockInput): Promise<CreateBlockResult> {
  if (input.endAt.getTime() <= input.startAt.getTime()) {
    throw new Error("Block endAt must be after startAt");
  }

  const overlappingAppointments = await prisma.appointment.findMany({
    where: {
      barberId: input.barberId,
      status: "SCHEDULED",
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
    },
    orderBy: { startAt: "asc" },
    include: { client: true },
  });

  const block = await prisma.block.create({
    data: {
      barberId: input.barberId,
      startAt: input.startAt,
      endAt: input.endAt,
      type: input.type,
      note: input.note ?? null,
    },
  });

  return {
    block,
    overlappingAppointments: overlappingAppointments.filter((a) =>
      overlaps(input.startAt, input.endAt, a.startAt, a.endAt)
    ),
  };
}

// ---------------------------------------------------------------------------
// Pre-flight overlap probe for blocks (so the bot can warn BEFORE creating)
// ---------------------------------------------------------------------------

/** Read-only: which SCHEDULED appointments would a block over this window hit? */
export async function findAppointmentsOverlapping(
  barberId: string,
  startAt: Date,
  endAt: Date
): Promise<(Appointment & { client: Client | null })[]> {
  const candidates = await prisma.appointment.findMany({
    where: {
      barberId,
      status: "SCHEDULED",
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    orderBy: { startAt: "asc" },
    include: { client: true },
  });
  return candidates.filter((a) => overlaps(startAt, endAt, a.startAt, a.endAt));
}

// ---------------------------------------------------------------------------
// addClient
// ---------------------------------------------------------------------------

export interface AddClientInput {
  name?: string | null;
  phone?: string | null;
}

/**
 * Upsert a client by phone when a phone is present; otherwise create a new one.
 * Returns the client row.
 */
export async function addClient(input: AddClientInput): Promise<Client> {
  const name = input.name?.trim() || null;
  const phone = input.phone?.trim() || null;

  if (phone) {
    const existing = await prisma.client.findFirst({ where: { phone } });
    if (existing) {
      // Fill in a name if we learned one and didn't have it before.
      if (name && !existing.name) {
        return prisma.client.update({ where: { id: existing.id }, data: { name } });
      }
      return existing;
    }
    return prisma.client.create({ data: { phone, name } });
  }

  return prisma.client.create({ data: { name, phone: null } });
}

// ---------------------------------------------------------------------------
// cancelAppointment
// ---------------------------------------------------------------------------

/** Set an appointment's status to CANCELLED. Returns the updated row. */
export async function cancelAppointment(id: string): Promise<Appointment> {
  return prisma.appointment.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
}

/**
 * NOTE: rescheduleAppointment (with the same overlap check) is intentionally
 * only required for Project 3 per the shared spec, so it is not implemented in
 * this monolithic Project-1 unit.
 */
