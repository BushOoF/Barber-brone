import type { FastifyReply, FastifyRequest } from "fastify";
import type { Barber, User } from "@prisma/client";
import { validateInitData } from "../lib/telegram-auth.js";
import { prisma } from "../lib/prisma.js";
import { isAdminTelegramId } from "../lib/env.js";

export interface AuthContext {
  user: User;
  barber: Barber | null;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

function extractInitData(req: FastifyRequest): string | null {
  const auth = req.headers["authorization"];
  if (auth && typeof auth === "string" && auth.toLowerCase().startsWith("tma ")) {
    return auth.slice(4).trim();
  }
  const xhdr = req.headers["x-telegram-init-data"];
  if (typeof xhdr === "string" && xhdr.length > 0) return xhdr;
  return null;
}

/** Validate the Telegram initData header, upsert the user, and attach `request.auth`. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const raw = extractInitData(req);
  if (!raw) {
    reply.code(401).send({ error: "missing_init_data" });
    return;
  }
  const data = validateInitData(raw);
  if (!data) {
    reply.code(401).send({ error: "invalid_init_data" });
    return;
  }

  const tg = data.user;
  const desiredRoleForNew = isAdminTelegramId(tg.id) ? "ADMIN" : "CUSTOMER";

  const user = await prisma.user.upsert({
    where: { telegramId: BigInt(tg.id) },
    update: {
      username: tg.username ?? null,
      firstName: tg.first_name ?? null,
      lastName: tg.last_name ?? null,
    },
    create: {
      telegramId: BigInt(tg.id),
      username: tg.username ?? null,
      firstName: tg.first_name ?? null,
      lastName: tg.last_name ?? null,
      role: desiredRoleForNew,
    },
  });

  // Promote env-listed admins on first authenticated request, in case the row pre-existed as CUSTOMER.
  let finalUser = user;
  if (isAdminTelegramId(tg.id) && user.role === "CUSTOMER") {
    finalUser = await prisma.user.update({
      where: { id: user.id },
      data: { role: "ADMIN" },
    });
  }

  // Auto-create a Barber profile for env-listed admins who haven't /start-ed the bot
  // yet but are accessing the Mini App directly. Without this they'd be locked out of
  // the dashboard.
  let barber = await prisma.barber.findUnique({ where: { userId: finalUser.id } });
  if (!barber && finalUser.role === "ADMIN") {
    barber = await prisma.barber.create({
      data: {
        userId: finalUser.id,
        role: "MAIN",
        displayName: finalUser.firstName ?? tg.first_name ?? "Main Barber",
        isActive: true,
      },
    });
  }
  req.auth = { user: finalUser, barber };
}

/** Guard: only admins or apprentices may proceed. Requires `requireAuth` first. */
export async function requireStaff(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx = req.auth;
  if (!ctx) {
    reply.code(401).send({ error: "unauthenticated" });
    return;
  }
  const isStaff = ctx.user.role === "ADMIN" || ctx.user.role === "APPRENTICE";
  if (!isStaff || !ctx.barber || !ctx.barber.isActive) {
    reply.code(403).send({ error: "forbidden" });
    return;
  }
}

/** Guard: only the Main Barber (admin) may proceed. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ctx = req.auth;
  if (!ctx) {
    reply.code(401).send({ error: "unauthenticated" });
    return;
  }
  if (ctx.user.role !== "ADMIN") {
    reply.code(403).send({ error: "admin_only" });
    return;
  }
}
