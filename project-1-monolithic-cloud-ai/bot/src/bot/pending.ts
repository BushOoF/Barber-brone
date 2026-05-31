/**
 * In-memory store of pending voice actions awaiting a Confirm tap.
 *
 * Keyed by a short id we embed in the inline-keyboard callback data, so we do
 * not have to stuff the whole payload (and a phone number) into callback data.
 * Entries auto-expire so the map cannot grow unbounded if a barber never taps.
 *
 * Single-process only (fine for a monolithic single-shop bot). If this unit
 * were ever scaled horizontally, back this with Redis instead.
 */
import { randomUUID } from "node:crypto";
import type { PendingAction } from "./actions.js";

interface Entry {
  /** Telegram user id that owns this action — only they may confirm it. */
  ownerId: number;
  action: PendingAction;
  expiresAt: number;
}

const TTL_MS = 10 * 60_000; // 10 minutes

const store = new Map<string, Entry>();

/** Save an action and return its short id (used in callback data). */
export function putPending(ownerId: number, action: PendingAction): string {
  const id = randomUUID().slice(0, 8);
  store.set(id, { ownerId, action, expiresAt: Date.now() + TTL_MS });
  return id;
}

/** Fetch (without removing) a pending action, if it exists and hasn't expired. */
export function peekPending(id: string): Entry | undefined {
  const e = store.get(id);
  if (!e) return undefined;
  if (e.expiresAt < Date.now()) {
    store.delete(id);
    return undefined;
  }
  return e;
}

/** Remove and return a pending action (call on Confirm/Cancel). */
export function takePending(id: string): Entry | undefined {
  const e = peekPending(id);
  if (e) store.delete(id);
  return e;
}

/** Periodic cleanup of expired entries. */
export function sweepExpired(now = Date.now()): void {
  for (const [id, e] of store) {
    if (e.expiresAt < now) store.delete(id);
  }
}
