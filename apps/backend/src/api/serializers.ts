import type { Barber, Booking, Service, TimeBlock, User } from "@prisma/client";

export function serializeUser(u: User) {
  return {
    id: u.id,
    telegramId: u.telegramId.toString(),
    username: u.username,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    role: u.role,
    language: u.language,
    remindersOn: u.remindersOn,
    createdAt: u.createdAt.toISOString(),
  };
}

export function serializeBarber(b: Barber) {
  return {
    id: b.id,
    role: b.role,
    displayName: b.displayName,
    isActive: b.isActive,
  };
}

export function serializeService(s: Service) {
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    durationMin: s.durationMin,
    priceMinor: s.priceMinor,
    isActive: s.isActive,
    sortOrder: s.sortOrder,
  };
}

export function serializeBooking(b: Booking & { user?: User | null }) {
  return {
    id: b.id,
    userId: b.userId,
    barberId: b.barberId,
    startAt: b.startAt.toISOString(),
    endAt: b.endAt.toISOString(),
    durationMin: b.durationMin,
    totalPriceMinor: b.totalPriceMinor,
    adults: b.adults,
    children: b.children,
    services: b.services,
    status: b.status,
    remindersOn: b.remindersOn,
    user: b.user ? {
      id: b.user.id,
      firstName: b.user.firstName,
      lastName: b.user.lastName,
      username: b.user.username,
      phone: b.user.phone,
    } : undefined,
  };
}

export function serializeBlock(t: TimeBlock) {
  return {
    id: t.id,
    barberId: t.barberId,
    startAt: t.startAt.toISOString(),
    endAt: t.endAt.toISOString(),
    type: t.type,
    note: t.note,
  };
}
