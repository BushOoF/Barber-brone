/**
 * Thin client for the Python voice AI sidecar (STT + role-aware intent extraction).
 * Stateless: send audio + the speaker's role, get back a single tool call.
 */
import { env } from "../lib/env.js";

export type VoiceRole = "customer" | "staff" | "barber";

export type VoiceTool =
  | "book_appointment"
  | "cancel_booking"
  | "create_break"
  | "add_walkin"
  | "cancel_break"
  | "make_announcement"
  | "update_service"
  | "update_hours"
  | "add_vacation"
  | "add_client"
  | "none";

export interface VoiceResult {
  transcript: string;
  tool: VoiceTool;
  arguments: Record<string, unknown>;
  confidence: number;
}

/** Raised when the AI sidecar is unreachable, times out, or returns a bad status. */
export class AiServiceError extends Error {}

function base(): string {
  return env.AI_SERVICE_URL.replace(/\/$/, "");
}

export async function postVoice(
  audio: Uint8Array,
  mime: string,
  role: VoiceRole,
  today?: string,
): Promise<VoiceResult> {
  const url =
    `${base()}/process-voice?role=${encodeURIComponent(role)}` +
    (today ? `&today=${encodeURIComponent(today)}` : "");
  const form = new FormData();
  const blob = new Blob([audio], { type: mime || "audio/ogg" });
  form.append("audio", blob, "voice.ogg");

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "voice AI request failed";
    throw new AiServiceError(msg);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new AiServiceError(`voice AI ${resp.status}: ${text.slice(0, 200)}`);
  }
  return (await resp.json()) as VoiceResult;
}

/** Best-effort liveness probe (used at startup, non-fatal). */
export async function pingAi(): Promise<boolean> {
  try {
    const r = await fetch(`${base()}/healthz`, { signal: AbortSignal.timeout(4000) });
    return r.ok;
  } catch {
    return false;
  }
}
