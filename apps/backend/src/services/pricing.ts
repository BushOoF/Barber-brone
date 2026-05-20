import type { Service } from "@prisma/client";

export interface BookingSelection {
  adults: number;
  children: number;
  /** Service keys selected. Must always include "haircut_adult" or "haircut_child" (the locked haircut row). */
  serviceKeys: string[];
}

export interface PriceQuote {
  durationMin: number;
  totalPriceMinor: number;
  /** Per-line breakdown for display in the confirmation screen. */
  lines: { serviceKey: string; qty: number; durationMin: number; priceMinor: number }[];
}

/**
 * Compute a booking's total duration and price.
 *
 * Formula (from the product spec):
 *   total = (adults × adult-haircut) + (children × child-haircut) + (wash? + beard?)
 *
 * i.e. haircuts scale with party size, optional add-ons are a flat charge per booking.
 */
export function quote(services: Service[], sel: BookingSelection): PriceQuote {
  const map = new Map(services.map((s) => [s.key, s]));
  const getOrThrow = (k: string) => {
    const s = map.get(k);
    if (!s) throw new Error(`Unknown service key: ${k}`);
    return s;
  };

  const lines: PriceQuote["lines"] = [];
  let duration = 0;
  let price = 0;

  const adults = Math.max(0, sel.adults | 0);
  const children = Math.max(0, sel.children | 0);

  if (adults > 0) {
    const s = getOrThrow("haircut_adult");
    duration += s.durationMin * adults;
    price += s.priceMinor * adults;
    lines.push({ serviceKey: s.key, qty: adults, durationMin: s.durationMin * adults, priceMinor: s.priceMinor * adults });
  }
  if (children > 0) {
    const s = getOrThrow("haircut_child");
    duration += s.durationMin * children;
    price += s.priceMinor * children;
    lines.push({ serviceKey: s.key, qty: children, durationMin: s.durationMin * children, priceMinor: s.priceMinor * children });
  }

  const optionalKeys = sel.serviceKeys.filter((k) => k !== "haircut_adult" && k !== "haircut_child");
  for (const key of optionalKeys) {
    const s = getOrThrow(key);
    duration += s.durationMin;
    price += s.priceMinor;
    lines.push({ serviceKey: s.key, qty: 1, durationMin: s.durationMin, priceMinor: s.priceMinor });
  }

  return { durationMin: duration, totalPriceMinor: price, lines };
}

/** Build the canonical services[] string array for storage on the booking. */
export function normalizeSelection(sel: BookingSelection): string[] {
  const out = new Set<string>();
  if (sel.adults > 0) out.add("haircut_adult");
  if (sel.children > 0) out.add("haircut_child");
  for (const k of sel.serviceKeys) {
    if (k !== "haircut_adult" && k !== "haircut_child") out.add(k);
  }
  return [...out];
}
