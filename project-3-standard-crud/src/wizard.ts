/**
 * In-memory per-user wizard / session state. Keyed by Telegram user id.
 *
 * This is deliberately simple (a Map) — a single-process long-polling bot does
 * not need a distributed store. State is ephemeral: if the process restarts, an
 * in-progress wizard is dropped and the user just taps the menu again.
 */

export type WizardStep =
  // Add-appointment flow
  | "appt_client_choice" // choosing existing client / new / walk-in / no client
  | "appt_client_name" // typing a new client's name
  | "appt_client_phone" // typing a new client's phone
  | "appt_date" // picking a date
  | "appt_time" // typing/picking a time
  | "appt_duration" // picking duration
  | "appt_note" // optionally typing a note
  // Add-break flow
  | "break_date"
  | "break_start"
  | "break_end"
  | "break_note"
  // Reschedule flow
  | "resched_date"
  | "resched_time";

export interface WizardState {
  step: WizardStep;
  /** Which top-level flow we're in. */
  flow: "add_appt" | "add_break" | "reschedule";

  // --- shared partial draft fields ---
  /** Selected/created client id (null = no client / walk-in). */
  clientId?: string | null;
  isWalkIn?: boolean;
  newClientName?: string | null;

  /** Local date key (YYYY-MM-DD) chosen for the appointment/break. */
  dateKey?: string;

  /** Appointment time "HH:MM". */
  timeHHMM?: string;
  durationMin?: number;
  note?: string | null;

  // --- break-specific ---
  breakStartHHMM?: string;
  breakEndHHMM?: string;

  // --- reschedule-specific ---
  appointmentId?: string;

  /** Message id of the wizard's editable prompt, so we can edit in place. */
  promptMessageId?: number;
  chatId?: number;

  updatedAt: number;
}

const sessions = new Map<number, WizardState>();

/** TTL so abandoned wizards eventually clear (defensive; not strictly needed). */
const TTL_MS = 30 * 60 * 1000;

export function getSession(userId: number): WizardState | undefined {
  const s = sessions.get(userId);
  if (!s) return undefined;
  if (Date.now() - s.updatedAt > TTL_MS) {
    sessions.delete(userId);
    return undefined;
  }
  return s;
}

export function startSession(userId: number, init: Omit<WizardState, "updatedAt">): WizardState {
  const state: WizardState = { ...init, updatedAt: Date.now() };
  sessions.set(userId, state);
  return state;
}

export function updateSession(userId: number, patch: Partial<WizardState>): WizardState | undefined {
  const s = sessions.get(userId);
  if (!s) return undefined;
  Object.assign(s, patch, { updatedAt: Date.now() });
  return s;
}

export function clearSession(userId: number): void {
  sessions.delete(userId);
}

/** Periodically sweep expired sessions (called from index on an interval). */
export function sweepSessions(): void {
  const now = Date.now();
  for (const [userId, s] of sessions) {
    if (now - s.updatedAt > TTL_MS) sessions.delete(userId);
  }
}
