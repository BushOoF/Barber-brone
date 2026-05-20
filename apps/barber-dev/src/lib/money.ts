/**
 * Lightweight money helper for the operator bot. Per-shop currency varies, but
 * for operator-facing reports we keep things simple and let the operator infer
 * the currency from each shop's context.
 */
export function formatMinor(amount: number, currency = "UZS"): string {
  return `${new Intl.NumberFormat("en-US").format(amount)} ${currency}`;
}

/** Current "YYYY-MM" key for monthly billing/snapshot bookkeeping. */
export function currentMonthKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** ISO 8601 week key like "2026-W18". */
export function currentWeekKey(date: Date = new Date()): string {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayOfWeek = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
