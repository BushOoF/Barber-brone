/**
 * Client for the REMOTE AI worker (Project 2 — hybrid).
 *
 * The worker runs on a local/on-prem box exposed via a secure tunnel
 * (Cloudflare / Tailscale / ngrok / SSH). We:
 *   - POST the downloaded voice note as multipart/form-data to
 *     `${AI_SERVICE_URL}/process-voice`,
 *   - authenticate with the `X-Worker-Secret` header,
 *   - enforce AI_REQUEST_TIMEOUT_MS with an AbortController,
 *   - validate the JSON response with zod,
 * and surface a typed error so the bot can tell the barber to retry instead of
 * hanging or crashing.
 *
 * Uses Node 20+ global fetch / FormData / Blob — no axios.
 */
import { env } from "../env.js";
import { logger } from "../lib/logger.js";
import { VoiceResponseSchema, type VoiceResponse } from "./types.js";

export type AiErrorKind =
  | "timeout" // worker/tunnel did not answer in time
  | "unreachable" // network error reaching the tunnel
  | "unauthorized" // 401 — shared-secret mismatch
  | "bad_response" // non-2xx or unparseable/invalid body
  | "server_error"; // worker returned 5xx (e.g. ffmpeg/whisper/ollama failure)

export class AiServiceError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  constructor(kind: AiErrorKind, message: string, status?: number) {
    super(message);
    this.name = "AiServiceError";
    this.kind = kind;
    this.status = status;
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Send a voice note to the remote worker and get back the validated tool call.
 *
 * @param audio   raw bytes of the downloaded .ogg (Telegram voice notes are OGG/Opus)
 * @param mime    content type to advertise (default audio/ogg)
 * @param filename file name for the multipart part
 */
export async function processVoice(
  audio: Uint8Array | ArrayBuffer,
  opts: { mime?: string; filename?: string } = {},
): Promise<VoiceResponse> {
  const url = joinUrl(env.AI_SERVICE_URL, "process-voice");
  const mime = opts.mime ?? "audio/ogg";
  const filename = opts.filename ?? "voice.ogg";

  const bytes = audio instanceof ArrayBuffer ? new Uint8Array(audio) : audio;
  const form = new FormData();
  // Field name MUST be "audio" to match the worker's multipart contract.
  form.append("audio", new Blob([bytes], { type: mime }), filename);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.AI_REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        // Shared secret authenticates this request across the public tunnel.
        "X-Worker-Secret": env.WORKER_SHARED_SECRET,
        Accept: "application/json",
      },
      body: form,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn(`AI worker timed out after ${env.AI_REQUEST_TIMEOUT_MS}ms`);
      throw new AiServiceError("timeout", `AI worker did not respond within ${env.AI_REQUEST_TIMEOUT_MS}ms`);
    }
    logger.warn("AI worker unreachable", err instanceof Error ? err.message : err);
    throw new AiServiceError("unreachable", "Could not reach the AI worker (tunnel down?)");
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401) {
    logger.error("AI worker rejected shared secret (401). Check WORKER_SHARED_SECRET on both sides.");
    throw new AiServiceError("unauthorized", "AI worker rejected the shared secret", 401);
  }

  if (res.status >= 500) {
    const detail = await safeReadText(res);
    logger.warn(`AI worker server error ${res.status}`, detail);
    throw new AiServiceError("server_error", `AI worker error ${res.status}`, res.status);
  }

  if (!res.ok) {
    const detail = await safeReadText(res);
    logger.warn(`AI worker returned ${res.status}`, detail);
    throw new AiServiceError("bad_response", `AI worker returned HTTP ${res.status}`, res.status);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new AiServiceError("bad_response", "AI worker returned a non-JSON body");
  }

  const parsed = VoiceResponseSchema.safeParse(json);
  if (!parsed.success) {
    logger.warn("AI worker returned an unexpected JSON shape", parsed.error.issues);
    throw new AiServiceError("bad_response", "AI worker returned an unexpected response shape");
  }

  // Transcript only at debug level (never log phone numbers).
  logger.debug("AI worker result", { tool: parsed.data.tool, confidence: parsed.data.confidence });
  return parsed.data;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const t = await res.text();
    return t.slice(0, 500);
  } catch {
    return "";
  }
}
