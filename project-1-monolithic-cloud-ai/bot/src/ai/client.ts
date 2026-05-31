/**
 * Client for the local Python AI sidecar (Project 1: same box, http://localhost:8000).
 *
 * Sends the barber's voice note (.ogg) as multipart/form-data to
 * POST {AI_SERVICE_URL}/process-voice and validates the tool-call response.
 *
 * Uses Node 20's global fetch + FormData/Blob — no axios, no extra deps.
 */
import { z } from "zod";
import { env } from "../config/env.js";

/** The tool surface the model may emit (mirrors the shared spec). */
export const ToolName = z.enum(["add_client", "create_break", "add_walkin", "none"]);
export type ToolName = z.infer<typeof ToolName>;

const voiceResultSchema = z.object({
  transcript: z.string(),
  tool: ToolName,
  // Arguments are validated per-tool at the call site (after we know which tool).
  arguments: z.record(z.unknown()).default({}),
  confidence: z.number().min(0).max(1).default(0),
});

export type VoiceResult = z.infer<typeof voiceResultSchema>;

export class AiServiceError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "AiServiceError";
  }
}

/**
 * Send an audio buffer to the sidecar and get back a validated tool call.
 * @param audio   Raw bytes of the Telegram voice note (OGG/Opus).
 * @param mime    Content type to advertise (Telegram voice is "audio/ogg").
 * @param filename Name for the multipart part (helps the server pick an extension).
 */
export async function processVoice(
  audio: Uint8Array,
  mime = "audio/ogg",
  filename = "voice.ogg"
): Promise<VoiceResult> {
  const url = `${env.AI_SERVICE_URL.replace(/\/+$/, "")}/process-voice`;

  const form = new FormData();
  // Copy into a fresh ArrayBuffer so Blob gets a clean, correctly-sized buffer.
  const ab = audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer;
  form.append("audio", new Blob([ab], { type: mime }), filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.AI_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AiServiceError(`AI service timed out after ${env.AI_REQUEST_TIMEOUT_MS}ms`, err);
    }
    throw new AiServiceError(`Could not reach AI service at ${url}`, err);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AiServiceError(`AI service returned ${res.status}: ${body.slice(0, 300)}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new AiServiceError("AI service returned a non-JSON body", err);
  }

  const parsed = voiceResultSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiServiceError(
      `AI service response failed validation: ${parsed.error.issues.map((i) => i.message).join("; ")}`
    );
  }
  return parsed.data;
}

/** Liveness probe against the sidecar's /healthz (used at startup, best-effort). */
export async function pingAi(): Promise<boolean> {
  const url = `${env.AI_SERVICE_URL.replace(/\/+$/, "")}/healthz`;
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(5_000) });
    return res.ok;
  } catch {
    return false;
  }
}
