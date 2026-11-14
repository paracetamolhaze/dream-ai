import { desc, eq } from "drizzle-orm";
import { env } from "../env";
import { getDb } from "../db/client";
import { supportTickets } from "../db/schema";
import { AppError } from "../errors";
import { escapeHtml, msg } from "../i18n";
import { logger } from "../logger";
import { hitRateLimit } from "../redis";
import { botApi, hasBotToken } from "../telegram/bot-api";
import { sanitizeUserText } from "../utils";
import { getUser, userLocale } from "./users";

export async function createTicket(input: { userId?: string | null; telegramUserId: number; topic: "general" | "payment"; message: string }) {
  const rl = await hitRateLimit(`support:${input.telegramUserId}`, 10, 3600);
  if (!rl.allowed) throw new AppError("rate_limited", "Too many support requests");
  const text = sanitizeUserText(input.message).slice(0, 3000);
  if (text.length < 3) throw new AppError("validation_failed", "Message too short");
  const [ticket] = await getDb()
    .insert(supportTickets)
    .values({ userId: input.userId ?? null, telegramUserId: input.telegramUserId, topic: input.topic, message: text })
    .returning();
  const chat = env().SUPPORT_CHAT_ID;
  if (chat && hasBotToken()) {
    await botApi()
      .sendMessage(chat, `🆘 <b>${input.topic === "payment" ? "Оплата" : "Поддержка"}</b> #${ticket!.id.slice(0, 8)}\nTG: <code>${input.telegramUserId}</code>\n\n${escapeHtml(text)}`, { parse_mode: "HTML" })
      .catch((err: Error) => logger.warn("support forward failed", { error: err.message }));
  }
  return ticket!;
}

export async function replyToTicket(ticketId: string, reply: string, adminTelegramId: number): Promise<void> {
  const db = getDb();
  const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId));
  if (!t || !t.telegramUserId) throw new AppError("not_found", "Ticket not found");
  const text = sanitizeUserText(reply).slice(0, 3500);
  const locale = t.userId ? userLocale(await getUser(t.userId).catch(() => ({ language: "ru" }))) : "ru";
  await botApi().sendMessage(t.telegramUserId, msg(locale).supportReply(text), { parse_mode: "HTML" });
  await db.update(supportTickets).set({ status: "answered", reply: text, repliedBy: adminTelegramId, repliedAt: new Date() }).where(eq(supportTickets.id, ticketId));
}

export async function listTickets(limit = 100) {
  return getDb().select().from(supportTickets).orderBy(desc(supportTickets.createdAt)).limit(limit);
}
