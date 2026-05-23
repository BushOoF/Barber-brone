import type { Service } from "@prisma/client";

export interface BookingSelection {
  adults: number;
  children: number;
  /** Optional add-on service keys (wash, beard, …). NOT haircut keys. */
  serviceKeys: string[];
  /** Optional haircut style override for adults; null/undefined → use the default HAIRCUT_ADULT. */
  selectedAdultStyleKey?: string | null;
  /** Optional haircut style override for children; null/undefined → use the default HAIRCUT_CHILD. */
  selectedChildStyleKey?: string | null;
}

export interface PriceQuote {
  durationMin: number;
  totalPriceMinor: number;
  /** Per-line breakdown for display. */
  lines: { serviceKey: string; qty: number; durationMin: number; priceMinor: number }[];
}

function findAdultStyle(services: Service[], key?: string | null): Service | undefined {
  if (key) {
    const explicit = services.find((s) => s.key === key && s.category === "HAIRCUT_ADULT" && s.isActive);
    if (explicit) return explicit;
  }
  return services.find((s) => s.category === "HAIRCUT_ADULT" && s.isDefault && s.isActive)
    ?? services.find((s) => s.key === "haircut_adult"); // legacy fallback
}

function findChildStyle(services: Service[], key?: string | null): Service | undefined {
  if (key) {
    const explicit = services.find((s) => s.key === key && s.category === "HAIRCUT_CHILD" && s.isActive);
    if (explicit) return explicit;
  }
  return services.find((s) => s.category === "HAIRCUT_CHILD" && s.isDefault && s.isActive)
    ?? services.find((s) => s.key === "haircut_child");
}

/**
 * Compute a booking's total duration and price.
 *
 * Formula:
 *   total = adults × (selected adult style or default) +
 *           children × (selected child style or default) +
 *           (each chosen add-on once)
 */
export function quote(services: Service[], sel: BookingSelection): PriceQuote {
  const lines: PriceQuote["lines"] = [];
  let duration = 0;
  let price = 0;

  const adults = Math.max(0, sel.adults | 0);
  const children = Math.max(0, sel.children | 0);

  if (adults > 0) {
    const s = findAdultStyle(services, sel.selectedAdultStyleKey);
    if (!s) throw new Error("No HAIRCUT_ADULT service available");
    duration += s.durationMin * adults;
    price += s.priceMinor * adults;
    lines.push({ serviceKey: s.key, qty: adults, durationMin: s.durationMin * adults, priceMinor: s.priceMinor * adults });
  }
  if (children > 0) {
    const s = findChildStyle(services, sel.selectedChildStyleKey);
    if (!s) throw new Error("No HAIRCUT_CHILD service available");
    duration += s.durationMin * children;
    price += s.priceMinor * children;
    lines.push({ serviceKey: s.key, qty: children, durationMin: s.durationMin * children, priceMinor: s.priceMinor * children });
  }

  const map = new Map(services.map((s) => [s.key, s]));
  const addonKeys = sel.serviceKeys.filter((k) => {
    const svc = map.get(k);
    return svc && svc.category === "ADDON";
  });
  for (const key of addonKeys) {
    const s = map.get(key)!;
    duration += s.durationMin;
    price += s.priceMinor;
    lines.push({ serviceKey: s.key, qty: 1, durationMin: s.durationMin, priceMinor: s.priceMinor });
  }

  return { durationMin: duration, totalPriceMinor: price, lines };
}

/**
 * Canonical list of service keys to store on the booking. Includes the selected
 * haircut style keys + add-on keys.
 */
export function normalizeSelection(sel: BookingSelection, services: Service[]): string[] {
  const out = new Set<string>();
  if (sel.adults > 0) {
    const s = findAdultStyle(services, sel.selectedAdultStyleKey);
    if (s) out.add(s.key);
  }
  if (sel.children > 0) {
    const s = findChildStyle(services, sel.selectedChildStyleKey);
    if (s) out.add(s.key);
  }
  const map = new Map(services.map((s) => [s.key, s]));
  for (const k of sel.serviceKeys) {
    const svc = map.get(k);
    if (svc && svc.category === "ADDON") out.add(k);
  }
  return [...out];
}
