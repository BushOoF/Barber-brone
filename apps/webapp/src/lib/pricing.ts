import type { ServiceDef } from "./api";

export interface Selection {
  adults: number;
  children: number;
  /** Add-on service keys only (wash, beard, …) — NOT haircut keys. */
  optional: string[];
  selectedAdultStyleKey?: string | null;
  selectedChildStyleKey?: string | null;
}

export interface ClientQuote {
  durationMin: number;
  totalPriceMinor: number;
}

function adultStyle(services: ServiceDef[], key?: string | null): ServiceDef | undefined {
  if (key) {
    const explicit = services.find((s) => s.key === key && s.category === "HAIRCUT_ADULT" && s.isActive);
    if (explicit) return explicit;
  }
  return services.find((s) => s.category === "HAIRCUT_ADULT" && s.isDefault && s.isActive)
    ?? services.find((s) => s.key === "haircut_adult");
}

function childStyle(services: ServiceDef[], key?: string | null): ServiceDef | undefined {
  if (key) {
    const explicit = services.find((s) => s.key === key && s.category === "HAIRCUT_CHILD" && s.isActive);
    if (explicit) return explicit;
  }
  return services.find((s) => s.category === "HAIRCUT_CHILD" && s.isDefault && s.isActive)
    ?? services.find((s) => s.key === "haircut_child");
}

/**
 * Mirror of the backend `quote()` function so the Configure screen can show
 * live totals without a roundtrip per checkbox / style toggle.
 */
export function clientQuote(services: ServiceDef[], sel: Selection): ClientQuote {
  let duration = 0;
  let price = 0;

  const adults = Math.max(0, sel.adults | 0);
  const children = Math.max(0, sel.children | 0);

  if (adults > 0) {
    const s = adultStyle(services, sel.selectedAdultStyleKey);
    if (s) {
      duration += s.durationMin * adults;
      price += s.priceMinor * adults;
    }
  }
  if (children > 0) {
    const s = childStyle(services, sel.selectedChildStyleKey);
    if (s) {
      duration += s.durationMin * children;
      price += s.priceMinor * children;
    }
  }
  const map = new Map(services.map((s) => [s.key, s]));
  for (const key of sel.optional) {
    const s = map.get(key);
    if (!s || s.category !== "ADDON") continue;
    duration += s.durationMin;
    price += s.priceMinor;
  }
  return { durationMin: duration, totalPriceMinor: price };
}

export function serviceKeysFromSelection(sel: Selection): string[] {
  // Only add-on keys go in the array; haircut style is sent separately via selectedAdult/ChildStyleKey.
  return sel.optional;
}

/** Resolve the currently effective adult haircut style — used by the Configure UI chip. */
export function effectiveAdultStyle(services: ServiceDef[], key?: string | null): ServiceDef | undefined {
  return adultStyle(services, key);
}
export function effectiveChildStyle(services: ServiceDef[], key?: string | null): ServiceDef | undefined {
  return childStyle(services, key);
}
