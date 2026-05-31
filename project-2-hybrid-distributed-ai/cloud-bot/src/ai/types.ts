/**
 * Shape of the tool call the remote AI worker returns. The worker emits exactly
 * one tool. We validate it on receipt with zod (see client.ts) — never trust the
 * remote payload blindly.
 */
import { z } from "zod";

export const AddClientArgs = z.object({
  phone: z.string().min(1),
  name: z.string().optional(),
});
export type AddClientArgs = z.infer<typeof AddClientArgs>;

export const CreateBreakArgs = z.object({
  start_time: z.string().regex(/^\d{1,2}:\d{2}$/, "start_time must be HH:MM"),
  end_time: z.string().regex(/^\d{1,2}:\d{2}$/, "end_time must be HH:MM"),
  note: z.string().optional(),
});
export type CreateBreakArgs = z.infer<typeof CreateBreakArgs>;

export const AddWalkinArgs = z.object({
  start_time: z.string().regex(/^\d{1,2}:\d{2}$/, "start_time must be HH:MM").optional(),
  duration_min: z.coerce.number().int().positive().optional(),
  note: z.string().optional(),
});
export type AddWalkinArgs = z.infer<typeof AddWalkinArgs>;

/** Raw response from POST /process-voice. arguments are validated per-tool later. */
export const VoiceResponseSchema = z.object({
  transcript: z.string().default(""),
  tool: z.enum(["add_client", "create_break", "add_walkin", "none"]),
  arguments: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0),
});
export type VoiceResponse = z.infer<typeof VoiceResponseSchema>;

export type Tool = VoiceResponse["tool"];
