import { env } from "./env.js";

/**
 * UZS has no real subunit in practice — we store amounts as whole sums.
 * Keep `priceMinor` semantics so converting to a "real cents" currency later is mechanical.
 */
export function formatMoney(minor: number): string {
  const grouped = new Intl.NumberFormat("en-US").format(minor);
  return `${grouped} ${env.SHOP_CURRENCY}`;
}
