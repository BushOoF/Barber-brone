/**
 * Environment validation with zod. Fails fast at startup with a readable error
 * if anything required is missing or malformed.
 */
import { z } from "zod";

const csvBigIntList = z
  .string()
  .min(1, "must list at least one Telegram ID")
  .transform((raw, ctx) => {
    const ids: bigint[] = [];
    for (const part of raw.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      try {
        ids.push(BigInt(trimmed));
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `"${trimmed}" is not a valid integer Telegram ID`,
        });
        return z.NEVER;
      }
    }
    if (ids.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "no valid Telegram IDs found" });
      return z.NEVER;
    }
    return ids;
  });

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  ADMIN_TELEGRAM_IDS: csvBigIntList,

  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),

  SHOP_TZ: z.string().min(1).default("Asia/Tashkent"),
  REMINDER_LEAD_MIN: z.coerce.number().int().positive().default(10),

  // Remote AI worker (reached over a secure tunnel).
  AI_SERVICE_URL: z.string().url("AI_SERVICE_URL must be a valid URL (the tunnel URL)"),
  WORKER_SHARED_SECRET: z
    .string()
    .min(8, "WORKER_SHARED_SECRET must be set and reasonably long (>=8 chars)"),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),

  // Optional webhook mode. If WEBHOOK_URL is unset the bot uses long-polling.
  WEBHOOK_URL: z.string().url().optional(),
  WEBHOOK_SECRET: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(8080),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    // Throwing here aborts startup before we connect to Telegram or the DB.
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

/** True when the configured chat/user is in the admin allowlist. */
export function isAdmin(telegramId: number | bigint): boolean {
  const id = typeof telegramId === "bigint" ? telegramId : BigInt(telegramId);
  return env.ADMIN_TELEGRAM_IDS.some((a) => a === id);
}
