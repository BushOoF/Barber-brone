/**
 * Phone-number helpers for matching numbers that may be typed/stored in many
 * shapes (+998 90 123 45 67, 998901234567, 0901234567, …).
 *
 * We deliberately compare on the last 9 digits — the local subscriber number for
 * Uzbek +998 numbers — so a admin-typed number matches the same number Telegram
 * reports on a shared contact regardless of country-code/spacing formatting.
 */

/** Strip everything but digits. */
export function normalizePhone(raw: string | null | undefined): string {
  return (raw ?? "").replace(/\D/g, "");
}

/** Comparable key: the last 9 digits (local part). Empty if too short. */
export function phoneMatchKey(raw: string | null | undefined): string {
  const d = normalizePhone(raw);
  return d.length >= 9 ? d.slice(-9) : d;
}
