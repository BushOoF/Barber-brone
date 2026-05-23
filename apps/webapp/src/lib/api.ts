import { getTg } from "./telegram";

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const tg = getTg();
  const initData = tg?.initData ?? "";
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (!(init.body instanceof FormData) && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (initData) headers.set("Authorization", `tma ${initData}`);

  const url = `${API_BASE}${path}`;
  const res = await fetch(url, { ...init, headers });
  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    const message =
      typeof body === "object" && body && "error" in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, body, message);
  }
  return body as T;
}

export const api = {
  me: () => request<MeResponse>("/api/me"),
  barbers: () => request<{ barbers: Barber[] }>("/api/barbers"),
  services: () => request<{ services: ServiceDef[] }>("/api/services"),

  nextSlot: (params: { barberId: string; adults: number; children: number; serviceKeys: string[] }) =>
    request<NextSlotResponse>(
      `/api/availability/next?barberId=${encodeURIComponent(params.barberId)}&adults=${params.adults}&children=${params.children}&services=${encodeURIComponent(params.serviceKeys.join(","))}`,
    ),
  daySlots: (params: { barberId: string; date: string; adults: number; children: number; serviceKeys: string[] }) =>
    request<DaySlotsResponse>(
      `/api/availability/day?barberId=${encodeURIComponent(params.barberId)}&date=${params.date}&adults=${params.adults}&children=${params.children}&services=${encodeURIComponent(params.serviceKeys.join(","))}`,
    ),

  createBooking: (body: {
    barberId: string;
    startAt: string;
    adults: number;
    children: number;
    services: string[];
    selectedAdultStyleKey?: string | null;
    selectedChildStyleKey?: string | null;
    remindersOn: boolean;
  }) => request<{ booking: Booking; quote: PriceQuote }>("/api/bookings", { method: "POST", body: JSON.stringify(body) }),
  myBookings: () => request<{ bookings: BookingWithBarber[] }>("/api/bookings/mine"),
  toggleReminders: (id: string, remindersOn: boolean) =>
    request<{ booking: Booking }>(`/api/bookings/${id}/reminders`, {
      method: "PATCH",
      body: JSON.stringify({ remindersOn }),
    }),

  dayForBarber: (barberId: string | undefined, date: string) =>
    request<DayBookingsResponse>(
      `/api/bookings/day?date=${date}${barberId ? `&barberId=${encodeURIComponent(barberId)}` : ""}`,
    ),
  discard: (id: string) =>
    request<{ discardedId: string; shifted: number }>(`/api/bookings/${id}/discard`, { method: "POST" }),
  transfer: (id: string, toBarberId?: string) =>
    request<{ booking: Booking }>(`/api/bookings/${id}/transfer`, {
      method: "POST",
      body: JSON.stringify(toBarberId ? { toBarberId } : {}),
    }),
  shiftBookingTime: (id: string, startAtIso: string) =>
    request<{ booking: Booking }>(`/api/bookings/${id}/time`, {
      method: "PATCH",
      body: JSON.stringify({ startAt: startAtIso }),
    }),

  insertBlock: (body: {
    barberId?: string;
    startAt: string;
    durationMin: number;
    type?: "BREAK" | "WALK_IN" | "MANUAL";
    note?: string;
    mode?: "dry_run" | "shift" | "transfer";
    toBarberId?: string;
  }) => request<InsertBlockResponse>("/api/blocks", { method: "POST", body: JSON.stringify(body) }),
  deleteBlock: (id: string) =>
    request<{ deletedId: string }>(`/api/blocks/${id}`, { method: "DELETE" }),

  // ---- Admin endpoints ----
  adminAllServices: () => request<{ services: ServiceDef[] }>("/api/admin/services"),
  adminListApprentices: () => request<{ apprentices: Apprentice[] }>("/api/admin/apprentices"),
  adminAddApprentice: (telegramId: string, displayName: string) =>
    request<Apprentice>("/api/admin/apprentices", {
      method: "POST",
      body: JSON.stringify({ telegramId, displayName }),
    }),
  adminUpdateApprentice: (id: string, patch: { isActive?: boolean; displayName?: string }) =>
    request<Barber>(`/api/admin/apprentices/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  adminDeleteApprentice: (id: string) =>
    request<{ deletedId: string }>(`/api/admin/apprentices/${id}`, { method: "DELETE" }),

  adminUpdateService: (id: string, patch: { name?: string; durationMin?: number; priceMinor?: number; isActive?: boolean; isDefault?: boolean }) =>
    request<{ service: ServiceDef }>(`/api/admin/services/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  adminCreateService: (body: { name: string; category: ServiceCategory; priceMinor: number; durationMin: number; isDefault?: boolean }) =>
    request<{ service: ServiceDef }>("/api/admin/services", { method: "POST", body: JSON.stringify(body) }),
  adminDeleteService: (id: string) =>
    request<{ deletedId: string }>(`/api/admin/services/${id}`, { method: "DELETE" }),

  // ---- Announcements ----
  adminListAnnouncements: () =>
    request<{ announcements: Announcement[] }>("/api/admin/announcements"),
  adminSendAnnouncement: (message: string) =>
    request<{ announcement: { id: string; recipients: number; delivered: number; failed: number } }>(
      "/api/admin/announcements",
      { method: "POST", body: JSON.stringify({ message }) },
    ),

  adminListUsers: (search?: string) =>
    request<{ users: AdminUser[] }>(`/api/admin/users${search ? `?search=${encodeURIComponent(search)}` : ""}`),

  adminUpdateSettings: (patch: Partial<{ shopName: string; reminderLeadMin: number; openHourMin: number; closeHourMin: number; timezone: string; currency: string; location: string | null }>) =>
    request<{ settings: ShopSettings }>("/api/admin/settings", { method: "PUT", body: JSON.stringify(patch) }),

  adminFinances: (from?: string, to?: string) =>
    request<FinancesSummary>(
      `/api/admin/finances/summary${from || to ? `?${[from && `from=${from}`, to && `to=${to}`].filter(Boolean).join("&")}` : ""}`,
    ),
};

// ---- Types ----

export interface MeResponse {
  user: {
    id: string;
    telegramId: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    role: "CUSTOMER" | "ADMIN" | "APPRENTICE";
    language: "UZ" | "RU" | "EN";
    remindersOn: boolean;
    createdAt: string;
  };
  barber: { id: string; role: "MAIN" | "APPRENTICE"; displayName: string; isActive: boolean } | null;
  shop: {
    name: string;
    timezone: string;
    currency: string;
    openHourMin: number;
    closeHourMin: number;
    location: string | null;
    hasApprenticeFeature: boolean;
  };
}

export interface Barber {
  id: string;
  role: "MAIN" | "APPRENTICE";
  displayName: string;
  isActive: boolean;
}

export interface Apprentice extends Barber {
  user?: AdminUser;
}

export interface AdminUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  role: "CUSTOMER" | "ADMIN" | "APPRENTICE";
  language: "UZ" | "RU" | "EN";
  remindersOn: boolean;
  createdAt: string;
}

export type ServiceCategory = "HAIRCUT_ADULT" | "HAIRCUT_CHILD" | "ADDON";

export interface ServiceDef {
  id: string;
  key: string;
  name: string;
  category: ServiceCategory;
  isDefault: boolean;
  durationMin: number;
  priceMinor: number;
  isActive: boolean;
  sortOrder: number;
}

export interface Announcement {
  id: string;
  message: string;
  recipients: number;
  delivered: number;
  failed: number;
  createdAt: string;
}

export interface NextSlotResponse {
  durationMin: number;
  slot: { startAt: string; endAt: string } | null;
}

export interface DaySlotsResponse {
  durationMin: number;
  date: string;
  slots: { startAt: string; endAt: string }[];
}

export interface PriceQuote {
  durationMin: number;
  totalPriceMinor: number;
  lines: { serviceKey: string; qty: number; durationMin: number; priceMinor: number }[];
}

export interface Booking {
  id: string;
  userId: string;
  barberId: string;
  startAt: string;
  endAt: string;
  durationMin: number;
  totalPriceMinor: number;
  adults: number;
  children: number;
  services: string[];
  selectedAdultStyleKey: string | null;
  selectedChildStyleKey: string | null;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED_BY_USER" | "DISCARDED_NO_SHOW" | "TRANSFERRED";
  remindersOn: boolean;
  user?: { id: string; firstName: string | null; lastName: string | null; username: string | null; phone: string | null };
}

export interface BookingWithBarber extends Booking {
  barber: { id: string; displayName: string; role: "MAIN" | "APPRENTICE" };
}

export interface DayBookingsResponse {
  date: string;
  barberId: string;
  bookings: Booking[];
  blocks: { id: string; startAt: string; endAt: string; type: string; note: string | null }[];
}

export interface InsertBlockResponse {
  block?: { id: string; startAt: string; endAt: string; type: string };
  shifted?: number;
  transferred?: number;
  refused?: string[];
  unplaceable?: { bookingId: string; reason: string }[];
  plan?: {
    moves: { bookingId: string; oldStart: string; newStart: string; newEnd: string }[];
    unplaceable: { bookingId: string; reason: string }[];
    overlapping: { bookingId: string; startAt: string; durationMin: number; customer: string; phone: string | null }[];
    suggestedTransferTo: { id: string; displayName: string } | null;
    transferable: { bookingId: string; canTransfer: boolean }[];
  };
}

export interface ShopSettings {
  id: string;
  shopName: string;
  timezone: string;
  currency: string;
  reminderLeadMin: number;
  openHourMin: number;
  closeHourMin: number;
  location: string | null;
  hasApprenticeFeature: boolean;
}

export interface FinancesSummary {
  from: string;
  to: string;
  rows: {
    barberId: string;
    status: string;
    _sum: { totalPriceMinor: number | null };
    _count: { _all: number };
  }[];
}
