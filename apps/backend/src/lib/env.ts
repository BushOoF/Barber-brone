import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),

  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_ADMIN_IDS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => BigInt(x)),
    ),
  WEBAPP_URL: z.string().url(),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().or(z.literal("")),

  SHOP_TIMEZONE: z.string().default("Asia/Tashkent"),
  SHOP_CURRENCY: z.string().default("UZS"),

  CORS_EXTRA_ORIGINS: z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)),

  // Python voice AI sidecar (faster-whisper + Ollama/Gemma). Local by default.
  AI_SERVICE_URL: z.string().url().default("http://localhost:8000"),
  // CPU inference of Gemma can take ~60s, so the timeout is generous.
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),

  // Deploy-time switch for the whole voice assistant. Set "false" to run the bot
  // WITHOUT the AI sidecar (no Python/Ollama needed) — the original, text-only bot.
  VOICE_ENABLED: z
    .string()
    .default("true")
    .transform((s) => s.trim().toLowerCase() !== "false"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export const isProd = env.NODE_ENV === "production";

export function isAdminTelegramId(id: bigint | number | string): boolean {
  const target = typeof id === "bigint" ? id : BigInt(id);
  return env.TELEGRAM_ADMIN_IDS.some((adminId) => adminId === target);
}

export function mainBarberTelegramId(): bigint | null {
  return env.TELEGRAM_ADMIN_IDS[0] ?? null;
}
