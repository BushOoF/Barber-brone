/**
 * Scheduling service. Times are stored in UTC; callers convert from SHOP_TZ.
 *
 * Overlap rule: two intervals [aStart, aEnd) and [bStart, bEnd) overlap iff
 *   aStart < bEnd AND bStart < aEnd
 * (touching edges, e.g. one ends exactly when the next begins, do NOT overlap).
 *
 * No auto-shift: createAppointment rejects on conflict and returns a structured
 * description of what it collided with. createBlock does NOT auto-cancel; it
 * returns the overlapping appointments so the bot can warn first.
 */
import type { Appointment, Block, Client } from "@prisma/client";
import { AppointmentSource, BlockType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export interface DaySchedule {
  appointments: (Appointment & { client: Client | null })[];
  blocks: Block[];
}

/** List non-CANCELLED appointments + blocks overlapping a UTC day window, ordered by start. */
export async function listDay(
  barberId: string,
  dayRangeUtc: { start: Date; end: Date },
): Promise<DaySchedule> {
  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barberId,
        status: { not: "CANCELLED" },
        // any appointment that intersects the day window
        startAt: { lt: dayRangeUtc.end },
        endAt: { gt: dayRangeUtc.start },
      },
      include: { client: true },
      orderBy: { startAt: "asc" },
    }),
    prisma.block.findMany({
      where: {
        barberId,
        startAt: { lt: dayRangeUtc.end },
        endAt: { gt: dayRangeUtc.start },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);
  return { appointments, blocks };
}

export type ConflictKind = "APPOINTMENT" | "BLOCK";

export interface Conflict {
  kind: ConflictKind;
  startAt: Date;
  endAt: Date;
  /** Present when kind === "APPOINTMENT". */
  clientName?: string | null;
  clientPhone?: string | null;
  isWalkIn?: boolean;
  /** Present when kind === "BLOCK". */
  blockType?: BlockType;
  note?: string | null;
}

export type CreateAppointmentResult =
  | { ok: true; appointment: Appointment }
  | { ok: false; conflict: Conflict };

export interface CreateAppointmentInput {
  barberId: string;
  clientId?: string | null;
  startAt: Date;
  durationMin: number;
  isWalkIn?: boolean;
  note?: string | null;
  source: AppointmentSource;
}

/**
 * Create an appointment. endAt = startAt + durationMin. Rejects (no write) if it
 * overlaps any SCHEDULED appointment or any Block for the barber.
 */
export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<CreateAppointmentResult> {
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    throw new Error("durationMin must be a positive number");
  }
  const startAt = input.startAt;
  const endAt = new Date(startAt.getTime() + input.durationMin * 60000);

  // Run the conflict check and the insert in one transaction so two near-
  // simultaneous voice confirmations cannot both slip past the check.
  return prisma.$transaction(async (tx) => {
    const clashAppt = await tx.appointment.findFirst({
      where: {
        barberId: input.barberId,
        status: "SCHEDULED",
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      include: { client: true },
      orderBy: { startAt: "asc" },
    });
    if (clashAppt) {
      return {
        ok: false,
        conflict: {
          kind: "APPOINTMENT",
          startAt: clashAppt.startAt,
          endAt: clashAppt.endAt,
          clientName: clashAppt.client?.name ?? null,
          clientPhone: clashAppt.client?.phone ?? null,
          isWalkIn: clashAppt.isWalkIn,
          note: clashAppt.note,
        },
      } satisfies CreateAppointmentResult;
    }

    const clashBlock = await tx.block.findFirst({
      where: {
        barberId: input.barberId,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      orderBy: { startAt: "asc" },
    });
    if (clashBlock) {
      return {
        ok: false,
        conflict: {
          kind: "BLOCK",
          startAt: clashBlock.startAt,
          endAt: clashBlock.endAt,
          blockType: clashBlock.type,
          note: clashBlock.note,
        },
      } satisfies CreateAppointmentResult;
    }

    const appointment = await tx.appointment.create({
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
    return { ok: true, appointment } satisfies CreateAppointmentResult;
  });
}

export interface CreateBlockInput {
  barberId: string;
  startAt: Date;
  endAt: Date;
  type?: BlockType;
  note?: string | null;
}

export interface CreateBlockResult {
  block: Block;
  /** SCHEDULED appointments that overlap the new block. NOT auto-cancelled. */
  overlapping: (Appointment & { client: Client | null })[];
}

/**
 * Create a block (break / walk-in marker / other). Returns the list of
 * overlapping SCHEDULED appointments so the bot can warn before confirming.
 * The block is still created — the warning is informational, matching the spec
 * ("do NOT auto-cancel").
 */
export async function createBlock(input: CreateBlockInput): Promise<CreateBlockResult> {
  if (input.endAt.getTime() <= input.startAt.getTime()) {
    throw new Error("Block endAt must be after startAt");
  }
  return prisma.$transaction(async (tx) => {
    const overlapping = await tx.appointment.findMany({
      where: {
        barberId: input.barberId,
        status: "SCHEDULED",
        startAt: { lt: input.endAt },
        endAt: { gt: input.startAt },
      },
      include: { client: true },
      orderBy: { startAt: "asc" },
    });
    const block = await tx.block.create({
      data: {
        barberId: input.barberId,
        startAt: input.startAt,
        endAt: input.endAt,
        type: input.type ?? BlockType.BREAK,
        note: input.note ?? null,
      },
    });
    return { block, overlapping };
  });
}

/** Upsert a client by phone when a phone is given, else create a fresh record. */
export async function addClient(input: { name?: string | null; phone?: string | null }): Promise<Client> {
  const phone = input.phone?.trim() || null;
  const name = input.name?.trim() || null;

  if (phone) {
    // No @unique on phone in the schema, so emulate upsert-by-phone manually.
    const existing = await prisma.client.findFirst({ where: { phone } });
    if (existing) {
      if (name && name !== existing.name) {
        return prisma.client.update({ where: { id: existing.id }, data: { name } });
      }
      return existing;
    }
    return prisma.client.create({ data: { phone, name } });
  }
  return prisma.client.create({ data: { name } });
}

/** Mark an appointment CANCELLED. Returns null if it does not exist. */
export async function cancelAppointment(id: string): Promise<Appointment | null> {
  const found = await prisma.appointment.findUnique({ where: { id } });
  if (!found) return null;
  return prisma.appointment.update({ where: { id }, data: { status: "CANCELLED" } });
}
