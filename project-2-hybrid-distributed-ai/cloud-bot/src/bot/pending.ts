/**
 * In-memory store of pending voice actions awaiting a Confirm/Cancel tap.
 *
 * Keyed by Telegram user id. A short TTL prevents a stale action from being
 * confirmed much later (and bounds memory on the tiny VPS). This is per-process
 * state; if the bot restarts, any un-confirmed action is simply dropped and the
 * barber re-records — acceptable for a single-shop bot.
 */
import type { AddClientArgs, AddWalkinArgs, CreateBreakArgs } from "../ai/types.js";

export type PendingAction =
  | { id: string; barberId: string; kind: "add_client"; args: AddClientArgs }
  | { id: string; barberId: string; kind: "create_break"; args: CreateBreakArgs }
  | { id: string; barberId: string; kind: "add_walkin"; args: AddWalkinArgs };

interface Entry {
  action: PendingAction;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
const store = new Map<number, Entry>();

let counter = 0;
function newId(): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Store an action for a user. Returns the stored action (with its generated id)
 * so the caller can both render it and read back the id for callback data.
 */
export function putPending(userId: number, action: Omit<PendingAction, "id">): PendingAction {
  const id = newId();
  const stored = { ...action, id } as PendingAction;
  store.set(userId, { action: stored, expiresAt: Date.now() + TTL_MS });
  return stored;
}

/**
 * Atomically fetch and remove the pending action for a user, but only if its id
 * matches (guards against an old keyboard tapped after a newer recording) and it
 * has not expired.
 */
export function takePending(userId: number, id: string): PendingAction | null {
  const entry = store.get(userId);
  if (!entry) return null;
  store.delete(userId);
  if (entry.action.id !== id) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.action;
}

/** Drop a user's pending action (used by Cancel). Returns true if one existed and matched. */
export function discardPending(userId: number, id: string): boolean {
  const entry = store.get(userId);
  if (!entry) return false;
  store.delete(userId);
  return entry.action.id === id;
}

/** Periodically evict expired entries so the map cannot grow unbounded. */
export function sweepExpired(now: number = Date.now()): void {
  for (const [userId, entry] of store) {
    if (now > entry.expiresAt) store.delete(userId);
  }
}
