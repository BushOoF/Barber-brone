/**
 * Environment configuration, validated with zod at startup.
 * If anything is missing or malformed the process exits early with a clear message,
 * so we never reach the bot loop with a half-configured environment.
 */
import { z } from "zod";

/** CSV of integers -> bigint[]. Used for ADMIN_TELEGRAM_IDS. */
const csvBigIntList = z
  .string()
  .min(1, "must contain at least one Telegram ID")
  .transform((raw, ctx) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must contain at least one Telegram ID" });
      return z.NEVER;
    }
    const out: bigint[] = [];
    for (const p of parts) {
      if (!/^\d+$/.test(p)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${p}" is not a valid numeric Telegram ID` });
        return z.NEVER;
      }
      out.push(BigInt(p));
    }
    return out;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  ADMIN_TELEGRAM_IDS: csvBigIntList,

  DATABASE_URL: z.string().url("DATABASE_URL must be a valid connection URL"),

  SHOP_TZ: z.string().min(1).default("Asia/Tashkent"),
  REMINDER_LEAD_MIN: z.coerce.number().int().positive().default(10),

  // Project 1 talks to a LOCAL Python AI sidecar.
  AI_SERVICE_URL: z.string().url("AI_SERVICE_URL must be a valid URL").default("http://localhost:8000"),
  // Guard against a hung sidecar so the voice handler always replies.
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
});

export type Env = {
  NODE_ENV: "development" | "production" | "test";
  TELEGRAM_BOT_TOKEN: string;
  ADMIN_TELEGRAM_IDS: bigint[];
  DATABASE_URL: string;
  SHOP_TZ: string;
  REMINDER_LEAD_MIN: number;
  AI_SERVICE_URL: string;
  AI_REQUEST_TIMEOUT_MS: number;
};

function load(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    console.error("Invalid environment configuration:\n" + lines.join("\n"));
    process.exit(1);
  }
  return parsed.data;
}

export const env: Env = load();

/** True if the given Telegram user is an admin barber. */
export function isAdmin(telegramId: number | bigint): boolean {
  const id = typeof telegramId === "bigint" ? telegramId : BigInt(telegramId);
  return env.ADMIN_TELEGRAM_IDS.includes(id);
}
