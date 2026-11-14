import { and, count, eq, isNull, sql } from "drizzle-orm";
import { env } from "../env";
import { getDb, type DbOrTx } from "../db/client";
import { adminUsers, campaigns, creditTransactions, deletedAccountMarkers, dreams, referrals, userSettings, users } from "../db/schema";
import { isUniqueViolation } from "../db/errors";
import type { NotificationPrefs } from "../db/types";
import { AppError } from "../errors";
import { resolveLocale, type Locale } from "../i18n";
import { getSettings } from "../settings";
import { randomCode } from "../utils";
import { track } from "./analytics";
import { applyCreditChange } from "./credits";
import { telegramIdMarker } from "./account";

export type UserRow = typeof users.$inferSelect;

export interface TelegramProfile {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
  is_premium?: boolean;
  photo_url?: string;
}

export type StartParam =
  | { kind: "ref"; value: string }
  | { kind: "campaign"; value: string }
  | { kind: "dream"; value: string }
  | { kind: "share"; value: string }
  | { kind: "page"; value: string }
  | { kind: "none" };

/** Start parameters: ref_<code>, c_<campaign>, dream_<uuid>, page_<name>. Allowed chars: A-Za-z0-9_- */
export function parseStartParam(raw?: string | null): StartParam {
  if (!raw) return { kind: "none" };
  const p = raw.trim().slice(0, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(p)) return { kind: "none" };
  const [prefix, ...rest] = p.split("_");
  const value = rest.join("_");
  if (!value) return { kind: "none" };
  switch (prefix) {
    case "ref":
      return { kind: "ref", value: value.toLowerCase() };
    case "c":
      return { kind: "campaign", value: value.toLowerCase() };
    case "dream":
      return { kind: "dream", value };
    case "page":
      return { kind: "page", value };
    default:
      return { kind: "none" };
  }
}

async function uniqueReferralCode(db: DbOrTx): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = randomCode(7);
    const [hit] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code));
    if (!hit) return code;
  }
  return randomCode(10);
}

/**
 * Creates or refreshes a user from verified Telegram data. Attribution
 * (referral / campaign) is recorded only on first registration.
 */
export async function upsertTelegramUser(tg: TelegramProfile, opts: { startParam?: string | null; botChat?: boolean } = {}): Promise<{ user: UserRow; isNew: boolean }> {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.telegramId, tg.id));
  if (existing) {
    const patch: Partial<typeof users.$inferInsert> = {
      username: tg.username ?? null,
      firstName: tg.first_name ?? existing.firstName,
      lastName: tg.last_name ?? null,
      isPremium: Boolean(tg.is_premium),
      telegramLanguage: tg.language_code ?? existing.telegramLanguage,
      lastSeenAt: new Date(),
    };
    if (tg.photo_url) patch.photoUrl = tg.photo_url;
    if (opts.botChat) patch.botChatAvailable = true;
    const [updated] = await db.update(users).set(patch).where(eq(users.id, existing.id)).returning();
    return { user: updated!, isNew: false };
  }

  const settings = await getSettings();
  const sp = parseStartParam(opts.startParam);
  let inviter: UserRow | undefined;
  let campaignId: string | null = null;
  if (sp.kind === "ref") {
    [inviter] = await db.select().from(users).where(and(eq(users.referralCode, sp.value), eq(users.status, "active")));
  } else if (sp.kind === "campaign") {
    const [c] = await db.select().from(campaigns).where(and(eq(campaigns.code, sp.value), eq(campaigns.isActive, true)));
    campaignId = c?.id ?? null;
  }
  const locale = resolveLocale(tg.language_code);
  // A previously erased account comes back without fresh free allowance, signup bonus or referral reward.
  const [marker] = await db.select().from(deletedAccountMarkers).where(eq(deletedAccountMarkers.telegramIdHash, telegramIdMarker(tg.id)));
  const returning = Boolean(marker);
  const validInviter = !returning && inviter && inviter.telegramId !== tg.id ? inviter : undefined;

  let created: UserRow | undefined;
  try {
    created = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          telegramId: tg.id,
          username: tg.username,
          firstName: tg.first_name,
          lastName: tg.last_name,
          photoUrl: tg.photo_url,
          telegramLanguage: tg.language_code,
          language: locale,
          isPremium: Boolean(tg.is_premium),
          referralCode: await uniqueReferralCode(tx),
          referredBy: validInviter ? validInviter.id : null,
          referralSource: opts.startParam ? opts.startParam.slice(0, 64) : null,
          campaignId,
          freeSlideshowsUsed: marker?.freeSlideshowsUsed ?? 0,
          botChatAvailable: Boolean(opts.botChat),
          lastSeenAt: new Date(),
        })
        .returning();
      await tx.insert(userSettings).values({ userId: u!.id }).onConflictDoNothing();
      if (validInviter && settings.referral.enabled) {
        await tx.insert(referrals).values({ inviterId: validInviter.id, invitedId: u!.id, status: "pending" }).onConflictDoNothing();
      }
      if (!returning && settings.limits.signupBonusCredits > 0) {
        const { balance } = await applyCreditChange(tx, { userId: u!.id, amount: settings.limits.signupBonusCredits, type: "signup_bonus", source: "signup" });
        return { ...u!, creditsBalance: balance };
      }
      return u!;
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // Concurrent first request created the user — return it.
    const [u] = await db.select().from(users).where(eq(users.telegramId, tg.id));
    if (!u) throw err;
    return { user: u, isNew: false };
  }
  await track("user_registered", created.id, { source: sp.kind, campaign: sp.kind === "campaign" ? sp.value : null, referred: Boolean(created.referredBy) });
  if (created.referredBy) await track("referral_opened", created.id, { inviter: created.referredBy });
  return { user: created, isNew: true };
}

export async function getUser(userId: string, db: DbOrTx = getDb()): Promise<UserRow> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || u.status === "deleted") throw new AppError("not_found", "User not found");
  return u;
}

export async function getUserByTelegramId(telegramId: number, db: DbOrTx = getDb()): Promise<UserRow | undefined> {
  const [u] = await db.select().from(users).where(eq(users.telegramId, telegramId));
  return u;
}

export function assertActive(user: UserRow): void {
  if (user.status === "banned" || user.status === "restricted") throw new AppError("account_restricted", "Account restricted");
  if (user.status === "deleted") throw new AppError("unauthorized", "Account deleted");
}

export function userLocale(user: Pick<UserRow, "language">): Locale {
  return user.language === "en" ? "en" : "ru";
}

export async function isAdminTelegramId(telegramId: number, db: DbOrTx = getDb()): Promise<boolean> {
  if (env().ADMIN_TELEGRAM_IDS.includes(String(telegramId))) return true;
  const [row] = await db.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.telegramId, telegramId));
  return Boolean(row);
}

export async function getUserSettings(userId: string, db: DbOrTx = getDb()) {
  const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  if (s) return s;
  const [created] = await db.insert(userSettings).values({ userId }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(userSettings).where(eq(userSettings.userId, userId)))[0]!;
}

export async function updateUserPreferences(
  userId: string,
  patch: { language?: Locale; notifications?: Partial<NotificationPrefs>; timezone?: string | null; defaultStyle?: string | null; audioRetentionDays?: number | null },
): Promise<void> {
  const db = getDb();
  if (patch.language) await db.update(users).set({ language: patch.language }).where(eq(users.id, userId));
  const current = await getUserSettings(userId);
  const set: Partial<typeof userSettings.$inferInsert> = {};
  if (patch.notifications) {
    const n = { ...current.notifications, ...patch.notifications };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(n.reminderTime)) throw new AppError("validation_failed", "reminderTime must be HH:MM");
    set.notifications = n;
  }
  if (patch.timezone !== undefined) set.timezone = patch.timezone;
  if (patch.defaultStyle !== undefined) set.defaultStyle = patch.defaultStyle;
  if (patch.audioRetentionDays !== undefined) set.audioRetentionDays = patch.audioRetentionDays;
  if (Object.keys(set).length > 0) await db.update(userSettings).set(set).where(eq(userSettings.userId, userId));
}

export async function referralStats(userId: string, db: DbOrTx = getDb()) {
  const [invited] = await db.select({ n: count() }).from(referrals).where(eq(referrals.inviterId, userId));
  const [paying] = await db
    .select({ n: count() })
    .from(referrals)
    .innerJoin(users, eq(users.id, referrals.invitedId))
    .where(and(eq(referrals.inviterId, userId), eq(users.hasPaid, true)));
  const [earned] = await db
    .select({ s: sql<number>`coalesce(sum(${creditTransactions.amount}),0)::int` })
    .from(creditTransactions)
    .where(and(eq(creditTransactions.userId, userId), eq(creditTransactions.type, "referral_reward")));
  return { invited: invited?.n ?? 0, paying: paying?.n ?? 0, earned: earned?.s ?? 0 };
}

export async function dreamsCount(userId: string, db: DbOrTx = getDb()): Promise<number> {
  const [r] = await db.select({ n: count() }).from(dreams).where(and(eq(dreams.userId, userId), isNull(dreams.deletedAt)));
  return r?.n ?? 0;
}
