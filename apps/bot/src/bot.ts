import { Bot, GrammyError, HttpError, InlineKeyboard, type Context } from "grammy";
import { eq } from "drizzle-orm";
import { env, publicApiUrl } from "@dream/core/env";
import { AppError, isAppError } from "@dream/core/errors";
import { msg, type Locale } from "@dream/core/i18n";
import { logger } from "@dream/core/logger";
import { getRedis, hitRateLimit } from "@dream/core/redis";
import { getDb } from "@dream/core/db/client";
import { users } from "@dream/core/db/schema";
import { createAdminLoginToken } from "@dream/core/services/admin-auth";
import { getBalance } from "@dream/core/services/credits";
import { createTextDream, createVoiceDream } from "@dream/core/services/dreams";
import { handleSuccessfulPayment, validatePreCheckout, type SuccessfulPaymentResult } from "@dream/core/services/payments";
import { createTicket } from "@dream/core/services/support";
import { getUserByTelegramId, upsertTelegramUser, userLocale, type UserRow } from "@dream/core/services/users";
import { getSettings } from "@dream/core/settings";
import { webAppUrl } from "@dream/core/telegram/bot-api";
import { sleep } from "@dream/core/utils";
import { routes } from "@dream/core/routes";

const log = logger.child({ svc: "bot" });

/** Updates currently being handled — graceful shutdown waits for them. */
let inFlight = 0;
export const inFlightUpdates = () => inFlight;

let warnedNoHttps = false;
/**
 * Inline keyboard with Mini App buttons. Telegram accepts web_app buttons only
 * with HTTPS URLs — with a plain-http PUBLIC_APP_URL (local dev) no keyboard is sent.
 */
const appKb = (rows: [string, string][]): InlineKeyboard | undefined => {
  if (!webAppUrl("/").startsWith("https://")) {
    if (!warnedNoHttps) log.warn("PUBLIC_APP_URL is not HTTPS — Mini App buttons are omitted from bot messages");
    warnedNoHttps = true;
    return undefined;
  }
  const kb = new InlineKeyboard();
  rows.forEach(([text, path], i) => {
    kb.webApp(text, webAppUrl(path));
    if (i < rows.length - 1) kb.row();
  });
  return kb;
};

async function ensureUser(ctx: Context, startParam?: string): Promise<UserRow | null> {
  if (!ctx.from || ctx.from.is_bot) return null;
  const isPrivate = ctx.chat?.type === "private";
  const { user } = await upsertTelegramUser(ctx.from, { startParam, botChat: isPrivate });
  return user;
}

function localeOf(user: UserRow | null, ctx: Context): Locale {
  if (user) return userLocale(user);
  return ctx.from?.language_code?.startsWith("en") ? "en" : "ru";
}

const SUPPORT_KEY = (tgId: number) => `support:await:${tgId}`;

async function downloadTelegramFile(ctx: Context, fileId: string): Promise<Buffer> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new AppError("audio_unsupported", "File not available");
  const res = await fetch(`https://api.telegram.org/file/bot${env().TELEGRAM_BOT_TOKEN}/${file.file_path}`);
  if (!res.ok) throw new AppError("transcription_failed", `Telegram file download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** User-facing reply for a handler error (also used for webhook mode, where bot.catch is not invoked). */
async function replyWithError(ctx: Context, e: unknown): Promise<void> {
  if (!ctx.chat || ctx.chat.type !== "private") return;
  const l: Locale = ctx.from?.language_code?.startsWith("en") ? "en" : "ru";
  const m = msg(l);
  let text: string;
  if (isAppError(e)) {
    text =
      e.code === "text_too_short"
        ? m.textTooShort
        : e.code === "audio_too_large"
          ? m.voiceTooLarge
          : e.code === "audio_too_long"
            ? m.voiceTooLong(Math.round(env().MAX_AUDIO_SECONDS / 60))
            : e.code === "account_restricted"
              ? m.restricted
              : e.code === "rate_limited"
                ? l === "en"
                  ? "Daily limit reached, please try tomorrow."
                  : "Дневной лимит исчерпан, попробуй завтра."
                : m.transcriptionFailed;
  } else {
    if (e instanceof GrammyError) log.error("telegram API error", { description: e.description, method: e.method });
    else if (e instanceof HttpError) log.error("telegram network error", { error: e.message });
    else log.error("bot handler error", { error: e });
    text = l === "en" ? "Something went wrong. Please try again in a minute." : "Что-то пошло не так. Попробуй ещё раз через минуту.";
  }
  await ctx.reply(text).catch(() => undefined);
}

/** successful_payment must never be lost: the handler is idempotent, so retry transient failures. */
async function creditWithRetry(input: Parameters<typeof handleSuccessfulPayment>[0]): Promise<SuccessfulPaymentResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await handleSuccessfulPayment(input);
    } catch (err) {
      lastError = err;
      log.error("successful_payment handling failed, retrying", { attempt: attempt + 1, error: (err as Error).message });
      await sleep(500 * 2 ** attempt);
    }
  }
  throw lastError;
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);
  const redis = () => getRedis();

  // Each update is processed once. The key is only finalized after success: if a
  // payment update fails, the key is dropped and Telegram's re-delivery (webhook)
  // is processed again. Errors are handled here so webhook mode behaves like polling.
  bot.use(async (ctx, next) => {
    const key = `tg-update:${ctx.update.update_id}`;
    const acquired = await redis()
      .set(key, "processing", "EX", 600, "NX")
      .catch(() => "OK");
    if (acquired !== "OK") return;
    inFlight++;
    const critical = Boolean(ctx.message?.successful_payment);
    try {
      if (ctx.from && !ctx.preCheckoutQuery && !critical) {
        const rl = await hitRateLimit(`bot:${ctx.from.id}`, 40, 60).catch(() => ({ allowed: true }));
        if (!rl.allowed) {
          await redis().set(key, "done", "EX", 86_400).catch(() => undefined);
          return;
        }
      }
      await next();
      await redis().set(key, "done", "EX", 86_400).catch(() => undefined);
    } catch (err) {
      if (critical) {
        await redis().del(key).catch(() => undefined);
        throw err; // webhook → HTTP 500 → Telegram re-delivers; the handler is idempotent
      }
      await redis().set(key, "done", "EX", 86_400).catch(() => undefined);
      await replyWithError(ctx, err);
    } finally {
      inFlight--;
    }
  });

  // Payments carry no chat restriction (pre_checkout_query has no chat).
  bot.on("pre_checkout_query", async (ctx) => {
    const q = ctx.preCheckoutQuery;
    try {
      const res = await validatePreCheckout({ fromId: q.from.id, payload: q.invoice_payload, currency: q.currency, totalAmount: q.total_amount });
      if (res.ok) await ctx.answerPreCheckoutQuery(true);
      else
        await ctx.answerPreCheckoutQuery(false, {
          error_message: q.from.language_code?.startsWith("en") ? "This invoice is no longer valid. Please try again from the app." : "Счёт больше недействителен. Попробуй ещё раз из приложения.",
        });
    } catch (err) {
      log.error("pre_checkout failed", { error: err });
      await ctx.answerPreCheckoutQuery(false, { error_message: "Temporary error, please retry." }).catch(() => undefined);
    }
  });

  bot.on("message:successful_payment", async (ctx) => {
    const sp = ctx.message.successful_payment;
    const result = await creditWithRetry({
      fromId: ctx.from.id,
      payload: sp.invoice_payload,
      currency: sp.currency,
      totalAmount: sp.total_amount,
      telegramPaymentChargeId: sp.telegram_payment_charge_id,
      providerPaymentChargeId: sp.provider_payment_charge_id,
    });
    if (result.status !== "credited") {
      log.warn("successful_payment not credited", { status: result.status });
      return;
    }
    const m = msg(result.locale ?? "ru");
    await ctx.reply(m.paymentSuccess(result.credits ?? 0, result.balance ?? 0)).catch(() => undefined);
    if (result.jobId) {
      await ctx
        .reply(m.paymentStartedGeneration, { reply_markup: appKb([[m.btnOpenApp, result.dreamId ? routes.job(result.dreamId, result.jobId) : "/dreams"]]) })
        .catch(() => undefined);
    }
  });

  // The user blocked/unblocked the bot — we can't (or can again) send notifications.
  bot.on("my_chat_member", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const status = ctx.myChatMember.new_chat_member.status;
    const u = await getUserByTelegramId(ctx.from.id);
    if (u) await getDb().update(users).set({ botChatAvailable: status === "member" }).where(eq(users.id, u.id));
  });

  // Everything else works in the private chat only (Mini App buttons are not allowed in groups).
  const pm = bot.chatType("private");

  // Any other command cancels a pending "write to support" state.
  pm.on("message:text", async (ctx, next) => {
    const t = ctx.message.text;
    if (t.startsWith("/") && !/^\/(support|paysupport)\b/.test(t) && !/^\/start (support|paysupport)$/.test(t)) {
      await redis().del(SUPPORT_KEY(ctx.from.id)).catch(() => undefined);
    }
    await next();
  });

  // ── Commands ────────────────────────────────────────────────────────────
  pm.command("start", async (ctx) => {
    const param = ctx.match || undefined;
    const user = await ensureUser(ctx, param);
    const l = localeOf(user, ctx);
    const m = msg(l);
    if (user && user.status !== "active") return ctx.reply(m.restricted);
    // Deep links from the Mini App: t.me/<bot>?start=support | paysupport
    if (param === "support" || param === "paysupport") {
      const topic = param === "paysupport" ? "payment" : "general";
      await redis().set(SUPPORT_KEY(ctx.from.id), topic, "EX", 30 * 60);
      return ctx.reply(topic === "payment" ? m.paysupport : m.supportPrompt, { parse_mode: "HTML", reply_markup: { force_reply: true } });
    }
    await ctx.reply(m.welcome(env().APP_NAME), {
      parse_mode: "HTML",
      reply_markup: appKb([
        [m.btnRecord, "/"],
        [m.btnMyDreams, "/dreams"],
      ]),
    });
  });

  pm.command("dream", async (ctx) => {
    const m = msg(localeOf(await ensureUser(ctx), ctx));
    await ctx.reply(m.dreamPrompt, { reply_markup: appKb([[m.btnRecord, "/"]]) });
  });

  pm.command("library", async (ctx) => {
    const m = msg(localeOf(await ensureUser(ctx), ctx));
    await ctx.reply(m.btnMyDreams, { reply_markup: appKb([[m.btnMyDreams, "/dreams"]]) });
  });

  pm.command("balance", async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const m = msg(userLocale(user));
    const b = await getBalance(user.id);
    const settings = await getSettings();
    const freeLeft = Math.max(0, settings.limits.freeSlideshowsPerUser - b.freeUsed);
    await ctx.reply(m.balance(b.balance, b.reserved, freeLeft), { parse_mode: "HTML", reply_markup: appKb([[m.btnBuy, "/profile/balance"]]) });
  });

  pm.command("help", async (ctx) => {
    await ctx.reply(msg(localeOf(await ensureUser(ctx), ctx)).help, { parse_mode: "HTML" });
  });

  pm.command("settings", async (ctx) => {
    const m = msg(localeOf(await ensureUser(ctx), ctx));
    await ctx.reply(m.settings, { reply_markup: appKb([[m.btnProfile, "/profile"]]) });
  });

  pm.command("terms", async (ctx) => {
    await ctx.reply(msg(localeOf(await ensureUser(ctx), ctx)).terms, { parse_mode: "HTML" });
  });

  pm.command(["paysupport", "support"], async (ctx) => {
    const user = await ensureUser(ctx);
    const l = localeOf(user, ctx);
    const topic = ctx.message?.text?.startsWith("/paysupport") ? "payment" : "general";
    await redis().set(SUPPORT_KEY(ctx.from.id), topic, "EX", 30 * 60);
    await ctx.reply(topic === "payment" ? msg(l).paysupport : msg(l).supportPrompt, { parse_mode: "HTML", reply_markup: { force_reply: true } });
  });

  pm.command("admin", async (ctx) => {
    const token = await createAdminLoginToken(ctx.from.id);
    const l = localeOf((await getUserByTelegramId(ctx.from.id)) ?? null, ctx);
    if (!token) return ctx.reply(msg(l).notAdmin);
    const url = `${publicApiUrl()}/admin/login?token=${encodeURIComponent(token)}`;
    await ctx.reply(msg(l).adminLogin(url), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  // ── Voice dreams (same library as the Mini App) ─────────────────────────
  pm.on(["message:voice", "message:audio"], async (ctx) => {
    const user = await ensureUser(ctx);
    if (!user) return;
    const m = msg(userLocale(user));
    if (user.status !== "active") return ctx.reply(m.restricted);
    const media = ctx.message.voice ?? ctx.message.audio!;
    const maxSec = env().MAX_AUDIO_SECONDS;
    if (media.duration > maxSec) return ctx.reply(m.voiceTooLong(Math.round(maxSec / 60)));
    // Bot API getFile is limited to 20 MB.
    if ((media.file_size ?? 0) > Math.min(20 * 1024 * 1024, env().MAX_AUDIO_BYTES)) return ctx.reply(m.voiceTooLarge);
    await ctx.replyWithChatAction("typing").catch(() => undefined);
    const bytes = await downloadTelegramFile(ctx, media.file_id);
    await createVoiceDream(user, bytes, { source: "bot_voice", replyChatId: ctx.chat.id, durationHintSec: media.duration });
    await ctx.reply(m.voiceReceived);
  });

  // ── Text: support messages or typed dreams ──────────────────────────────
  pm.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (text.startsWith("/")) return;
    const user = await ensureUser(ctx);
    const l = localeOf(user, ctx);
    const m = msg(l);
    const supportTopic = await redis().get(SUPPORT_KEY(ctx.from.id));
    if (supportTopic) {
      const ticket = await createTicket({ userId: user?.id, telegramUserId: ctx.from.id, topic: supportTopic === "payment" ? "payment" : "general", message: text });
      await redis().del(SUPPORT_KEY(ctx.from.id)).catch(() => undefined);
      return ctx.reply(m.supportReceived(ticket.id));
    }
    if (!user) return;
    if (user.status !== "active") return ctx.reply(m.restricted);
    if (text.trim().length < 15) return ctx.reply(m.unknown, { reply_markup: appKb([[m.btnRecord, "/"]]) });
    const dream = await createTextDream(user, text, { source: "bot_text", confirm: true, replyChatId: ctx.chat.id });
    await ctx.reply(m.textReceived, { reply_markup: appKb([[m.btnOpenApp, routes.prepare(dream.id)]]) });
  });

  pm.on("message", async (ctx) => {
    const m = msg(localeOf(await ensureUser(ctx), ctx));
    await ctx.reply(m.unknown, { reply_markup: appKb([[m.btnRecord, "/"]]) });
  });

  // Polling mode: errors that escaped the boundary above (payment updates) are logged here.
  bot.catch(async (err) => {
    log.error("unhandled bot error", { error: err.error, updateId: err.ctx.update.update_id });
  });

  return bot;
}

export async function configureBot(bot: Bot): Promise<void> {
  const commands = {
    ru: [
      { command: "start", description: "Начать" },
      { command: "dream", description: "Записать новый сон" },
      { command: "library", description: "Мои сны" },
      { command: "balance", description: "Баланс генераций" },
      { command: "settings", description: "Настройки" },
      { command: "help", description: "Помощь" },
      { command: "paysupport", description: "Помощь с оплатой" },
    ],
    en: [
      { command: "start", description: "Start" },
      { command: "dream", description: "Record a new dream" },
      { command: "library", description: "My dreams" },
      { command: "balance", description: "Credits balance" },
      { command: "settings", description: "Settings" },
      { command: "help", description: "Help" },
      { command: "paysupport", description: "Payment help" },
    ],
  };
  await bot.api.setMyCommands(commands.ru);
  await bot.api.setMyCommands(commands.ru, { language_code: "ru" });
  await bot.api.setMyCommands(commands.en, { language_code: "en" });
  const url = webAppUrl("/");
  if (url.startsWith("https://")) {
    // Menu button next to the input field opens the Mini App.
    await bot.api.setChatMenuButton({ menu_button: { type: "web_app", text: env().APP_NAME, web_app: { url } } });
  } else {
    log.warn("PUBLIC_APP_URL is not HTTPS — skipping menu button (Telegram requires HTTPS for Mini Apps)");
  }
}

export const ALLOWED_UPDATES = ["message", "callback_query", "pre_checkout_query", "my_chat_member"] as const;
