import type { ServiceDef } from "./api";

export interface Selection {
  adults: number;
  children: number;
  /** Optional service keys (wash, beard, etc.). The haircut rows are implied by adults/children. */
  optional: string[];
}

export interface ClientQuote {
  durationMin: number;
  totalPriceMinor: number;
}

/**
 * Mirror of the backend `quote()` function so the configure screen can show live totals
 * without a roundtrip per checkbox toggle.
 */
export function clientQuote(services: ServiceDef[], sel: Selection): ClientQuote {
  const map = new Map(services.map((s) => [s.key, s]));
  let duration = 0;
  let price = 0;

  const adults = Math.max(0, sel.adults | 0);
  const children = Math.max(0, sel.children | 0);

  if (adults > 0) {
    const s = map.get("haircut_adult");
    if (s) {
      duration += s.durationMin * adults;
      price += s.priceMinor * adults;
    }
  }
  if (children > 0) {
    const s = map.get("haircut_child");
    if (s) {
      duration += s.durationMin * children;
      price += s.priceMinor * children;
    }
  }
  for (const key of sel.optional) {
    if (key === "haircut_adult" || key === "haircut_child") continue;
    const s = map.get(key);
    if (!s) continue;
    duration += s.durationMin;
    price += s.priceMinor;
  }
  return { durationMin: duration, totalPriceMinor: price };
}

export function serviceKeysFromSelection(sel: Selection): string[] {
  // Backend accepts either the optional keys alone or the full set; we send only optional
  // since adults/children are explicit fields.
  return sel.optional;
}
