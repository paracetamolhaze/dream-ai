import { env } from "../env";
import type { ProfileDto, SessionDto } from "../dto";
import { getSettings } from "../settings";
import { botStartLink, miniAppLink } from "../telegram/bot-api";
import { dreamsCount, getUserSettings, isAdminTelegramId, parseStartParam, referralStats, userLocale, type UserRow } from "./users";
import { getDb } from "../db/client";
import { dreams } from "../db/schema";
import { and, eq, isNull } from "drizzle-orm";

export async function buildProfile(user: UserRow): Promise<ProfileDto> {
  const settings = await getSettings();
  const [prefs, count, stats, isAdmin] = await Promise.all([getUserSettings(user.id), dreamsCount(user.id), referralStats(user.id), isAdminTelegramId(user.telegramId)]);
  const e = env();
  return {
    id: user.id,
    telegramId: user.telegramId,
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    photoUrl: user.photoUrl,
    language: userLocale(user),
    createdAt: user.createdAt.toISOString(),
    dreamsCount: count,
    balance: user.creditsBalance,
    reserved: user.creditsReserved,
    freeSlideshowsLeft: Math.max(0, settings.limits.freeSlideshowsPerUser - user.freeSlideshowsUsed),
    hasPaid: user.hasPaid,
    isAdmin,
    botChatAvailable: user.botChatAvailable,
    notifications: prefs.notifications,
    timezone: prefs.timezone,
    referral: {
      code: user.referralCode,
      link: botStartLink(`ref_${user.referralCode}`),
      miniAppLink: miniAppLink(`ref_${user.referralCode}`),
      invited: stats.invited,
      paying: stats.paying,
      earned: stats.earned,
      rewardInviter: settings.referral.rewardInviter,
      rewardInvited: settings.referral.rewardInvited,
      trigger: settings.referral.trigger,
      enabled: settings.referral.enabled,
    },
    audioRetentionDays: prefs.audioRetentionDays ?? settings.retention.audioRetentionDays,
    appName: e.APP_NAME,
    botUsername: e.TELEGRAM_BOT_USERNAME ?? null,
    channelUrl: e.TELEGRAM_CHANNEL_URL ?? null,
  };
}

/** Resolves a Mini App start parameter into an in-app route. */
export async function resolveStartRedirect(user: UserRow, startParam?: string | null): Promise<string | null> {
  const sp = parseStartParam(startParam);
  if (sp.kind === "dream") {
    const [d] = await getDb()
      .select({ id: dreams.id })
      .from(dreams)
      .where(and(eq(dreams.id, sp.value), eq(dreams.userId, user.id), isNull(dreams.deletedAt)))
      .catch(() => []);
    return d ? `/dreams/${d.id}` : "/dreams";
  }
  if (sp.kind === "page") {
    const pages: Record<string, string> = { library: "/dreams", profile: "/profile", buy: "/profile/balance", record: "/", write: "/write", invite: "/profile/invite" };
    return pages[sp.value] ?? null;
  }
  return null;
}

export async function buildSession(user: UserRow, startParam?: string | null): Promise<SessionDto> {
  return { user: await buildProfile(user), redirect: await resolveStartRedirect(user, startParam), demoMode: env().DEMO_MODE };
}
