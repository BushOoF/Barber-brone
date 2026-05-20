import { prisma } from "../lib/prisma.js";
import { isEnvOperator, isEnvSuperOperator } from "../lib/env.js";

/** True if the given Telegram ID is in the env list OR has an Operator row. */
export async function isOperator(telegramId: bigint | number): Promise<boolean> {
  if (isEnvOperator(telegramId)) return true;
  const row = await prisma.operator.findUnique({ where: { telegramId: BigInt(telegramId) } });
  return !!row;
}

/** Super operators (env's first ID, or any Operator row with isSuper=true) can manage other operators. */
export async function isSuperOperator(telegramId: bigint | number): Promise<boolean> {
  if (isEnvSuperOperator(telegramId)) return true;
  const row = await prisma.operator.findUnique({ where: { telegramId: BigInt(telegramId) } });
  return row?.isSuper ?? false;
}

export async function listOperators() {
  return prisma.operator.findMany({ orderBy: [{ isSuper: "desc" }, { createdAt: "asc" }] });
}

export async function addOperator(telegramId: bigint, name?: string, username?: string) {
  return prisma.operator.upsert({
    where: { telegramId },
    update: { firstName: name ?? undefined, username: username ?? undefined },
    create: { telegramId, firstName: name ?? null, username: username ?? null, isSuper: false },
  });
}

export async function removeOperator(telegramId: bigint) {
  // Don't allow removing super operators via this path — they must be demoted first.
  const op = await prisma.operator.findUnique({ where: { telegramId } });
  if (!op) return { removed: false, reason: "not_found" as const };
  if (op.isSuper) return { removed: false, reason: "is_super" as const };
  await prisma.operator.delete({ where: { telegramId } });
  return { removed: true as const };
}
