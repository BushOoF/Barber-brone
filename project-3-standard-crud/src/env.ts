/**
 * Environment loading + validation (zod). Fail fast with a readable message.
 */
import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  ADMIN_TELEGRAM_IDS: z
    .string()
    .default("")
    .transform((s, ctx) => {
      const ids = s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const out: bigint[] = [];
      for (const id of ids) {
        try {
          out.push(BigInt(id));
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `ADMIN_TELEGRAM_IDS contains a non-numeric value: "${id}"`,
          });
          return z.NEVER;
        }
      }
      return out;
    }),
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid postgres connection URL"),
  SHOP_TZ: z.string().min(1).default("Asia/Tashkent"),
  REMINDER_LEAD_MIN: z.coerce.number().int().positive().default(10),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("✗ Invalid environment configuration:");
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

/** True if the given Telegram id is in the admin allowlist. */
export function isAdmin(id: bigint | number | string): boolean {
  let target: bigint;
  try {
    target = typeof id === "bigint" ? id : BigInt(id);
  } catch {
    return false;
  }
  return env.ADMIN_TELEGRAM_IDS.some((adminId) => adminId === target);
}
