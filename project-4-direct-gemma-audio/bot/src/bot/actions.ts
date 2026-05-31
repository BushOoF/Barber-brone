/**
 * Tool-call argument validation + the discriminated PendingAction type.
 *
 * The AI sidecar returns { tool, arguments, ... } where `arguments` is loosely
 * typed. Here we narrow it into a strongly-typed PendingAction per tool, so the
 * confirm/commit path is fully type-safe. Invalid arguments are rejected with a
 * human-readable reason that the bot relays to the barber.
 */
import { z } from "zod";
import type { ToolName } from "../ai/client.js";

const HHMM = z
  .string()
  .regex(/^\d{1,2}:\d{2}$/, "time must look like HH:MM")
  .refine((s) => {
    const [h, m] = s.split(":").map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, "time is out of range");

const addClientArgs = z.object({
  phone: z.string().min(1, "phone is required"),
  name: z.string().min(1).optional(),
});

const createBreakArgs = z
  .object({
    start_time: HHMM,
    end_time: HHMM,
    note: z.string().min(1).optional(),
  })
  .refine((a) => a.start_time !== a.end_time, "start and end time must differ");

const addWalkinArgs = z.object({
  start_time: HHMM.optional(),
  duration_min: z.coerce.number().int().positive().max(600).optional(),
  note: z.string().min(1).optional(),
});

export type AddClientArgs = z.infer<typeof addClientArgs>;
export type CreateBreakArgs = z.infer<typeof createBreakArgs>;
export type AddWalkinArgs = z.infer<typeof addWalkinArgs>;

export type PendingAction =
  | { tool: "add_client"; args: AddClientArgs }
  | { tool: "create_break"; args: CreateBreakArgs }
  | { tool: "add_walkin"; args: AddWalkinArgs };

export type ParseOutcome =
  | { ok: true; action: PendingAction }
  | { ok: false; reason: string }
  | { ok: "none" };

/** Validate raw sidecar arguments for a given tool into a PendingAction. */
export function parseToolCall(tool: ToolName, args: Record<string, unknown>): ParseOutcome {
  switch (tool) {
    case "none":
      return { ok: "none" };
    case "add_client": {
      const r = addClientArgs.safeParse(args);
      return r.success ? { ok: true, action: { tool, args: r.data } } : fail(r);
    }
    case "create_break": {
      const r = createBreakArgs.safeParse(args);
      return r.success ? { ok: true, action: { tool, args: r.data } } : fail(r);
    }
    case "add_walkin": {
      const r = addWalkinArgs.safeParse(args);
      return r.success ? { ok: true, action: { tool, args: r.data } } : fail(r);
    }
    default: {
      // Exhaustiveness guard.
      const _never: never = tool;
      return { ok: false, reason: `unknown tool ${String(_never)}` };
    }
  }
}

function fail(r: z.SafeParseError<unknown>): { ok: false; reason: string } {
  return { ok: false, reason: r.error.issues.map((i) => i.message).join("; ") };
}
