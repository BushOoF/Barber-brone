/**
 * Scheduling service. Times are stored UTC. Pure DB + business rules; no UI.
 *
 * Overlap rule: two intervals [aStart, aEnd) and [bStart, bEnd) overlap iff
 * aStart < bEnd && bStart < aEnd. Back-to-back appointments (one ends exactly
 * when the next starts) do NOT overlap.
 *
 * No auto-shift / no smart cascade — see README. createAppointment rejects on
 * any conflict; createBlock only WARNS by returning overlapping appointments.
 */
import { Prisma } from "@prisma/client";
import type {
  Appointment,
  AppointmentSource,
  Block,
  BlockType,
  Client,
} from "@prisma/client";
import { prisma } from "./db.js";

export type ConflictKind = "appointment" | "block";

export interface Conflict {
  kind: ConflictKind;
  startAt: Date;
  endAt: Date;
  /** Present when kind === "appointment". */
  appointment?: Appointment & { client: Client | null };
  /** Present when kind === "block". */
  block?: Block;
}

export type CreateAppointmentResult =
  | { ok: true; appointment: Appointment & { client: Client | null } }
  | { ok: false; conflict: Conflict };

export type RescheduleResult =
  | { ok: true; appointment: Appointment & { client: Client | null } }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "conflict"; conflict: Conflict };

export interface DayAgenda {
  appointments: (Appointment & { client: Client | null })[];
  blocks: Block[];
}

/** Appointments (non-CANCELLED) + blocks for a local day window, time-ordered. */
export async function listDay(barberId: string, range: { start: Date; end: Date }): Promise<DayAgenda> {
  const [appointments, blocks] = await Promise.all([
    prisma.appointment.findMany({
      where: {
        barberId,
        status: { not: "CANCELLED" },
        startAt: { gte: range.start, lt: range.end },
      },
      include: { client: true },
      orderBy: { startAt: "asc" },
    }),
    prisma.block.findMany({
      where: {
        barberId,
        startAt: { gte: range.start, lt: range.end },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);
  return { appointments, blocks };
}

/**
 * Find the first thing (SCHEDULED appointment or any Block) that overlaps
 * [startAt, endAt) for this barber. Returns null when the slot is free.
 */
async function findFirstConflict(
  barberId: string,
  startAt: Date,
  endAt: Date,
  opts: { ignoreAppointmentId?: string } = {},
): Promise<Conflict | null> {
  const apptWhere: Prisma.AppointmentWhereInput = {
    barberId,
    status: "SCHEDULED",
    startAt: { lt: endAt },
    endAt: { gt: startAt },
  };
  if (opts.ignoreAppointmentId) {
    apptWhere.id = { not: opts.ignoreAppointmentId };
  }

  const [appt, block] = await Promise.all([
    prisma.appointment.findFirst({
      where: apptWhere,
      include: { client: true },
      orderBy: { startAt: "asc" },
    }),
    prisma.block.findFirst({
      where: {
        barberId,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      orderBy: { startAt: "asc" },
    }),
  ]);

  // Return whichever conflict starts earliest so the message is intuitive.
  const candidates: Conflict[] = [];
  if (appt) {
    candidates.push({ kind: "appointment", startAt: appt.startAt, endAt: appt.endAt, appointment: appt });
  }
  if (block) {
    candidates.push({ kind: "block", startAt: block.startAt, endAt: block.endAt, block });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  return candidates[0]!;
}

export interface CreateAppointmentInput {
  barberId: string;
  clientId?: string | null;
  startAt: Date;
  durationMin: number;
  isWalkIn?: boolean;
  note?: string | null;
  /** Always MANUAL in this project; kept for signature parity with the spec. */
  source?: AppointmentSource;
}

export async function createAppointment(input: CreateAppointmentInput): Promise<CreateAppointmentResult> {
  if (!Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    throw new Error("durationMin must be a positive number of minutes");
  }
  const startAt = input.startAt;
  const endAt = new Date(startAt.getTime() + input.durationMin * 60000);

  const conflict = await findFirstConflict(input.barberId, startAt, endAt);
  if (conflict) {
    return { ok: false, conflict };
  }

  const appointment = await prisma.appointment.create({
    data: {
      barberId: input.barberId,
      clientId: input.clientId ?? null,
      startAt,
      endAt,
      isWalkIn: input.isWalkIn ?? false,
      note: input.note ?? null,
      // Project 3 is text/menu only — never VOICE.
      source: input.source ?? "MANUAL",
    },
    include: { client: true },
  });

  return { ok: true, appointment };
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
  /** SCHEDULED appointments that overlap this block — NOT auto-cancelled. */
  overlapping: (Appointment & { client: Client | null })[];
}

/**
 * Create a block. Does NOT auto-cancel overlapping appointments; instead it
 * returns them so the bot can warn before/after confirming.
 */
export async function createBlock(input: CreateBlockInput): Promise<CreateBlockResult> {
  if (input.endAt.getTime() <= input.startAt.getTime()) {
    throw new Error("Block end time must be after start time");
  }

  const overlapping = await prisma.appointment.findMany({
    where: {
      barberId: input.barberId,
      status: "SCHEDULED",
      startAt: { lt: input.endAt },
      endAt: { gt: input.startAt },
    },
    include: { client: true },
    orderBy: { startAt: "asc" },
  });

  const block = await prisma.block.create({
    data: {
      barberId: input.barberId,
      startAt: input.startAt,
      endAt: input.endAt,
      type: input.type ?? "BREAK",
      note: input.note ?? null,
    },
  });

  return { block, overlapping };
}

export interface AddClientInput {
  name?: string | null;
  phone?: string | null;
}

/** Upsert a client by phone when a phone is present; otherwise create. */
export async function addClient(input: AddClientInput): Promise<Client> {
  const name = input.name?.trim() || null;
  const phone = input.phone?.trim() || null;

  if (phone) {
    const existing = await prisma.client.findFirst({ where: { phone } });
    if (existing) {
      // Backfill the name if we learned one and it was missing.
      if (name && !existing.name) {
        return prisma.client.update({ where: { id: existing.id }, data: { name } });
      }
      return existing;
    }
  }

  return prisma.client.create({ data: { name, phone } });
}

/** Cancel an appointment (idempotent-ish: also returns null if it doesn't exist). */
export async function cancelAppointment(
  id: string,
): Promise<(Appointment & { client: Client | null }) | null> {
  const existing = await prisma.appointment.findUnique({ where: { id } });
  if (!existing) return null;
  return prisma.appointment.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: { client: true },
  });
}

/**
 * Reschedule: move an appointment to a new start time, keeping its duration,
 * with the same overlap check (ignoring itself). Project-3-specific op.
 */
export async function rescheduleAppointment(id: string, newStartAt: Date): Promise<RescheduleResult> {
  const existing = await prisma.appointment.findUnique({ where: { id } });
  if (!existing) return { ok: false, reason: "not_found" };

  const durationMs = existing.endAt.getTime() - existing.startAt.getTime();
  const newEndAt = new Date(newStartAt.getTime() + durationMs);

  const conflict = await findFirstConflict(existing.barberId, newStartAt, newEndAt, {
    ignoreAppointmentId: id,
  });
  if (conflict) return { ok: false, reason: "conflict", conflict };

  const updated = await prisma.appointment.update({
    where: { id },
    data: { startAt: newStartAt, endAt: newEndAt },
    include: { client: true },
  });
  return { ok: true, appointment: updated };
}

/** Look up the active barber row for a Telegram id (allowlist gate happens upstream). */
export async function getBarberByTelegramId(telegramId: bigint) {
  return prisma.barber.findUnique({ where: { telegramId } });
}

/** Recent + upcoming SCHEDULED appointments for list/pick flows (cancel/reschedule). */
export async function listUpcomingAppointments(
  barberId: string,
  fromUtc: Date,
  limit = 20,
): Promise<(Appointment & { client: Client | null })[]> {
  return prisma.appointment.findMany({
    where: { barberId, status: "SCHEDULED", endAt: { gte: fromUtc } },
    include: { client: true },
    orderBy: { startAt: "asc" },
    take: limit,
  });
}

export async function getAppointmentById(
  id: string,
): Promise<(Appointment & { client: Client | null }) | null> {
  return prisma.appointment.findUnique({ where: { id }, include: { client: true } });
}

/** Recently-seen clients to offer as quick-pick when adding an appointment. */
export async function listRecentClients(barberId: string, limit = 8): Promise<Client[]> {
  const recentAppts = await prisma.appointment.findMany({
    where: { barberId, clientId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: { client: true },
  });
  const seen = new Set<string>();
  const clients: Client[] = [];
  for (const a of recentAppts) {
    if (a.client && !seen.has(a.client.id)) {
      seen.add(a.client.id);
      clients.push(a.client);
      if (clients.length >= limit) break;
    }
  }
  return clients;
}
