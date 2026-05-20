import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().url(),
  BARBER_DEV_BOT_TOKEN: z.string().min(1, "BARBER_DEV_BOT_TOKEN is required"),
  OPERATOR_TELEGRAM_IDS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => BigInt(x)),
    ),
  TIMEZONE: z.string().default("Asia/Tashkent"),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional().or(z.literal("")),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid barber-dev environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

export function isEnvSuperOperator(id: bigint | number | string): boolean {
  const target = typeof id === "bigint" ? id : BigInt(id);
  return env.OPERATOR_TELEGRAM_IDS[0] === target;
}

export function isEnvOperator(id: bigint | number | string): boolean {
  const target = typeof id === "bigint" ? id : BigInt(id);
  return env.OPERATOR_TELEGRAM_IDS.some((opId) => opId === target);
}
