import type { FinanceEntry } from "@prisma/client";

/** Integer day number for a "YYYY-MM-DD" key (TZ-agnostic — used only for diffs). */
function dayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * How many times a (possibly recurring) entry occurs within [fromKey, toKey]
 * inclusive. One-time entries (repeatEveryDays null/≤0) count 0 or 1.
 */
export function occurrencesInRange(
  entry: { date: string; repeatEveryDays: number | null },
  fromKey: string,
  toKey: string,
): number {
  const start = dayIndex(entry.date);
  const from = dayIndex(fromKey);
  const to = dayIndex(toKey);
  if (to < from) return 0;

  const step = entry.repeatEveryDays && entry.repeatEveryDays > 0 ? entry.repeatEveryDays : null;
  if (step == null) {
    return start >= from && start <= to ? 1 : 0;
  }
  // Occurrences fall on start + k*step for k ≥ 0. Find the first one ≥ max(from, start).
  const lo = Math.max(from, start);
  if (lo > to) return 0;
  const kFirst = Math.ceil((lo - start) / step);
  const firstOcc = start + kFirst * step;
  if (firstOcc > to) return 0;
  return Math.floor((to - firstOcc) / step) + 1;
}

export interface ManualTotals {
  incomeMinor: number;
  expenseMinor: number;
}

/** Sum manual income/expense entries (expanding recurrences) over [fromKey, toKey]. */
export function summarizeManual(entries: FinanceEntry[], fromKey: string, toKey: string): ManualTotals {
  let incomeMinor = 0;
  let expenseMinor = 0;
  for (const e of entries) {
    const count = occurrencesInRange(e, fromKey, toKey);
    if (count <= 0) continue;
    const total = e.amountMinor * count;
    if (e.kind === "INCOME") incomeMinor += total;
    else expenseMinor += total;
  }
  return { incomeMinor, expenseMinor };
}
