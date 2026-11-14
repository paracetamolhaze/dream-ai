import { and, asc, count, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "../db/client";
import {
  ACTIVE_JOB_STATUSES,
  adminAuditLogs,
  adminUsers,
  campaigns,
  channelPosts,
  creditTransactions,
  dreamMedia,
  dreams,
  generationJobs,
  musicTracks,
  payments,
  pricingPlans,
  promoCodes,
  referrals,
  userSettings,
  users,
  visualStyles,
} from "../db/schema";
import { getQueue, QUEUES } from "../queue";

/**
 * Read-only queries for the admin panel. Nothing here returns dream texts or
 * recordings — admins see titles and metadata only.
 */

const db = () => getDb();
// Drizzle renders columns unqualified in single-table select lists, which would
// bind correlated subqueries to the inner table — reference outer columns explicitly.
const USERS_ID = sql.raw(`"users"."id"`);
const DREAMS_ID = sql.raw(`"dreams"."id"`);
const activeStatuses = sql.raw(ACTIVE_JOB_STATUSES.map((s) => `'${s}'`).join(","));

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

// ─── Dashboard ──────────────────────────────────────────────────────────────

export interface DashboardStats {
  usersTotal: number;
  usersToday: number;
  users7d: number;
  active7d: number;
  payers: number;
  conversionToPurchase: number;
  dreamsTotal: number;
  dreams7d: number;
  slideshows: number;
  videos: number;
  starsNet: number;
  starsGross: number;
  stars7d: number;
  paymentsPaid: number;
  refunds: number;
  refundedStars: number;
  aiTotalUsd: number;
  ai7dUsd: number;
  aiTodayUsd: number;
  avgJobCostUsd: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsFailed7d: number;
  jobsActive: number;
  ticketsOpen: number;
  orphanPayments: number;
}

export async function dashboardStats(): Promise<DashboardStats> {
  const res = await db().execute<Record<string, unknown>>(sql`
    select
      (select count(*) from users where status <> 'deleted') as users_total,
      (select count(*) from users where created_at >= date_trunc('day', now())) as users_today,
      (select count(*) from users where created_at >= now() - interval '7 days') as users_7d,
      (select count(*) from users where last_seen_at >= now() - interval '7 days') as active_7d,
      (select count(*) from users where has_paid) as payers,
      (select count(*) from dreams where deleted_at is null) as dreams_total,
      (select count(*) from dreams where deleted_at is null and created_at >= now() - interval '7 days') as dreams_7d,
      (select count(*) from dream_media where media_type = 'slideshow' and status = 'ready' and deleted_at is null) as slideshows,
      (select count(*) from dream_media where media_type = 'video' and status = 'ready' and deleted_at is null) as videos,
      (select coalesce(sum(stars_amount), 0) from payments where status = 'paid') as stars_net,
      (select coalesce(sum(stars_amount), 0) from payments where status in ('paid', 'refunded')) as stars_gross,
      (select coalesce(sum(stars_amount), 0) from payments where status = 'paid' and paid_at >= now() - interval '7 days') as stars_7d,
      (select count(*) from payments where status = 'paid') as payments_paid,
      (select count(*) from payments where status = 'refunded') as refunds,
      (select coalesce(sum(stars_amount), 0) from payments where status = 'refunded') as refunded_stars,
      (select count(*) from payments where invoice_payload like 'orphan:%') as orphan_payments,
      (select coalesce(sum(cost_usd), 0) from ai_usage) as ai_total,
      (select coalesce(sum(cost_usd), 0) from ai_usage where created_at >= now() - interval '7 days') as ai_7d,
      (select coalesce(sum(cost_usd), 0) from ai_usage where created_at >= date_trunc('day', now())) as ai_today,
      (select coalesce(avg(actual_cost_usd), 0) from generation_jobs where status = 'completed') as avg_job_cost,
      (select count(*) from generation_jobs where status = 'completed') as jobs_completed,
      (select count(*) from generation_jobs where status = 'failed') as jobs_failed,
      (select count(*) from generation_jobs where status = 'failed' and created_at >= now() - interval '7 days') as jobs_failed_7d,
      (select count(*) from generation_jobs where status in (${activeStatuses})) as jobs_active,
      (select count(*) from support_tickets where status = 'open') as tickets_open
  `);
  const r = res.rows[0] ?? {};
  const usersTotal = num(r.users_total);
  const payers = num(r.payers);
  return {
    usersTotal,
    usersToday: num(r.users_today),
    users7d: num(r.users_7d),
    active7d: num(r.active_7d),
    payers,
    conversionToPurchase: usersTotal > 0 ? payers / usersTotal : 0,
    dreamsTotal: num(r.dreams_total),
    dreams7d: num(r.dreams_7d),
    slideshows: num(r.slideshows),
    videos: num(r.videos),
    starsNet: num(r.stars_net),
    starsGross: num(r.stars_gross),
    stars7d: num(r.stars_7d),
    paymentsPaid: num(r.payments_paid),
    refunds: num(r.refunds),
    refundedStars: num(r.refunded_stars),
    aiTotalUsd: num(r.ai_total),
    ai7dUsd: num(r.ai_7d),
    aiTodayUsd: num(r.ai_today),
    avgJobCostUsd: num(r.avg_job_cost),
    jobsCompleted: num(r.jobs_completed),
    jobsFailed: num(r.jobs_failed),
    jobsFailed7d: num(r.jobs_failed_7d),
    jobsActive: num(r.jobs_active),
    ticketsOpen: num(r.tickets_open),
    orphanPayments: num(r.orphan_payments),
  };
}

export interface DailyPoint {
  day: string;
  newUsers: number;
  dreams: number;
  generations: number;
  completed: number;
  failed: number;
  stars: number;
  aiCostUsd: number;
}

export async function dailySeries(days = 14): Promise<DailyPoint[]> {
  const n = Math.min(Math.max(Math.trunc(days), 1), 90);
  const res = await db().execute<Record<string, unknown>>(sql`
    with days as (
      select generate_series(date_trunc('day', now()) - make_interval(days => ${n - 1}::int), date_trunc('day', now()), interval '1 day') as day
    )
    select
      to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*) from users u where u.created_at >= d.day and u.created_at < d.day + interval '1 day') as new_users,
      (select count(*) from dreams x where x.created_at >= d.day and x.created_at < d.day + interval '1 day') as dreams,
      (select count(*) from generation_jobs j where j.created_at >= d.day and j.created_at < d.day + interval '1 day') as generations,
      (select count(*) from generation_jobs j where j.status = 'completed' and j.finished_at >= d.day and j.finished_at < d.day + interval '1 day') as completed,
      (select count(*) from generation_jobs j where j.status = 'failed' and j.finished_at >= d.day and j.finished_at < d.day + interval '1 day') as failed,
      (select coalesce(sum(p.stars_amount), 0) from payments p where p.status = 'paid' and p.paid_at >= d.day and p.paid_at < d.day + interval '1 day') as stars,
      (select coalesce(sum(a.cost_usd), 0) from ai_usage a where a.created_at >= d.day and a.created_at < d.day + interval '1 day') as ai_cost
    from days d
    order by d.day
  `);
  return res.rows.map((r) => ({
    day: String(r.day),
    newUsers: num(r.new_users),
    dreams: num(r.dreams),
    generations: num(r.generations),
    completed: num(r.completed),
    failed: num(r.failed),
    stars: num(r.stars),
    aiCostUsd: num(r.ai_cost),
  }));
}

export interface FunnelStage {
  key: string;
  label: string;
  users: number;
}

/**
 * Cohort funnel for users registered in the last `days` days:
 * registration → recorded a dream → selected a format → started checkout →
 * paid → got a result → repeat purchase.
 */
export async function funnel(days = 30): Promise<FunnelStage[]> {
  const n = Math.min(Math.max(Math.trunc(days), 1), 365);
  const res = await db().execute<Record<string, unknown>>(sql`
    with cohort as (select id from users where created_at >= now() - make_interval(days => ${n}::int))
    select
      (select count(*) from cohort) as registered,
      (select count(distinct d.user_id) from dreams d join cohort c on c.id = d.user_id) as recorded,
      (select count(distinct x.user_id) from (
          select user_id from analytics_events where name in ('slideshow_selected', 'video_selected', 'generation_screen_opened')
          union all
          select user_id from generation_jobs
        ) x join cohort c on c.id = x.user_id) as format_selected,
      (select count(distinct e.user_id) from analytics_events e join cohort c on c.id = e.user_id where e.name = 'checkout_started') as checkout,
      (select count(distinct p.user_id) from payments p join cohort c on c.id = p.user_id where p.status in ('paid', 'refunded')) as purchased,
      (select count(distinct j.user_id) from generation_jobs j join cohort c on c.id = j.user_id where j.status = 'completed') as result,
      (select count(*) from (
          select p.user_id from payments p join cohort c on c.id = p.user_id
          where p.status in ('paid', 'refunded') group by p.user_id having count(*) >= 2
        ) r) as repeat_purchase
  `);
  const r = res.rows[0] ?? {};
  return [
    { key: "registered", label: "Регистрация", users: num(r.registered) },
    { key: "recorded", label: "Запись сна", users: num(r.recorded) },
    { key: "format_selected", label: "Выбор формата", users: num(r.format_selected) },
    { key: "checkout", label: "Открыл оплату", users: num(r.checkout) },
    { key: "purchased", label: "Оплата", users: num(r.purchased) },
    { key: "result", label: "Готовый результат", users: num(r.result) },
    { key: "repeat_purchase", label: "Повторная покупка", users: num(r.repeat_purchase) },
  ];
}

export interface QueueCounts {
  name: string;
  ok: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
  prioritized: number;
  error?: string;
}

export async function queueCounts(): Promise<QueueCounts[]> {
  return Promise.all(
    Object.values(QUEUES).map(async (name): Promise<QueueCounts> => {
      try {
        const c = await Promise.race([
          getQueue(name).getJobCounts("waiting", "active", "delayed", "failed", "completed", "paused", "prioritized"),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("redis timeout")), 4000)),
        ]);
        return {
          name,
          ok: true,
          waiting: num(c.waiting),
          active: num(c.active),
          delayed: num(c.delayed),
          failed: num(c.failed),
          completed: num(c.completed),
          paused: num(c.paused),
          prioritized: num(c.prioritized),
        };
      } catch (err) {
        return { name, ok: false, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0, prioritized: 0, error: (err as Error).message };
      }
    }),
  );
}

export interface SpendRow {
  kind: string;
  provider: string;
  model: string;
  calls: number;
  failures: number;
  costUsd: number;
  demo: boolean;
}

export async function aiSpendByModel(days = 7): Promise<SpendRow[]> {
  const n = Math.min(Math.max(Math.trunc(days), 1), 365);
  const res = await db().execute<Record<string, unknown>>(sql`
    select kind::text as kind, provider, model,
      count(*) as calls,
      count(*) filter (where not success) as failures,
      coalesce(sum(cost_usd), 0) as cost,
      bool_or(is_demo) as demo
    from ai_usage
    where created_at >= now() - make_interval(days => ${n}::int)
    group by kind, provider, model
    order by cost desc, calls desc
    limit 50
  `);
  return res.rows.map((r) => ({
    kind: String(r.kind),
    provider: String(r.provider),
    model: String(r.model),
    calls: num(r.calls),
    failures: num(r.failures),
    costUsd: num(r.cost),
    demo: Boolean(r.demo),
  }));
}

export async function jobStatusBreakdown(days = 7) {
  const n = Math.min(Math.max(Math.trunc(days), 1), 365);
  const res = await db().execute<Record<string, unknown>>(sql`
    select media_type::text as media_type, status::text as status, count(*) as n
    from generation_jobs
    where created_at >= now() - make_interval(days => ${n}::int)
    group by media_type, status
  `);
  return res.rows.map((r) => ({ mediaType: String(r.media_type), status: String(r.status), count: num(r.n) }));
}

// ─── Users ──────────────────────────────────────────────────────────────────

export interface ListParams {
  page?: number;
  pageSize?: number;
}

function paging(p: ListParams) {
  const pageSize = Math.min(Math.max(p.pageSize ?? 50, 1), 200);
  const page = Math.max(p.page ?? 1, 1);
  return { limit: pageSize + 1, offset: (page - 1) * pageSize, pageSize, page };
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listUsers(params: ListParams & { q?: string; status?: string; paid?: boolean }) {
  const { limit, offset, pageSize } = paging(params);
  const conds: SQL[] = [];
  const q = params.q?.trim().replace(/^@/, "");
  if (q) {
    if (/^\d{3,15}$/.test(q)) conds.push(eq(users.telegramId, Number(q)));
    else if (UUID_RE.test(q)) conds.push(eq(users.id, q));
    else {
      const p = `%${escapeLike(q.slice(0, 64))}%`;
      conds.push(or(ilike(users.username, p), ilike(users.firstName, p), ilike(users.lastName, p), ilike(users.referralCode, p))!);
    }
  }
  if (params.status && ["active", "restricted", "banned", "deleted"].includes(params.status)) {
    conds.push(eq(users.status, params.status as "active"));
  }
  if (params.paid) conds.push(eq(users.hasPaid, true));
  const rows = await db()
    .select({
      user: users,
      dreams: sql<number>`(select count(*)::int from dreams d where d.user_id = ${USERS_ID} and d.deleted_at is null)`,
      jobs: sql<number>`(select count(*)::int from generation_jobs j where j.user_id = ${USERS_ID})`,
      stars: sql<number>`(select coalesce(sum(p.stars_amount), 0)::int from payments p where p.user_id = ${USERS_ID} and p.status = 'paid')`,
    })
    .from(users)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(offset);
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}

export async function userDetail(userId: string) {
  if (!UUID_RE.test(userId)) return null;
  const d = db();
  const [user] = await d.select().from(users).where(eq(users.id, userId));
  if (!user) return null;
  const inviter = alias(users, "inviter");
  const invited = alias(users, "invited");
  const [settings, campaign, referredBy, dreamRows, jobs, pays, ledger, invitedRefs, invitedBy] = await Promise.all([
    d.select().from(userSettings).where(eq(userSettings.userId, userId)).then((r) => r[0] ?? null),
    user.campaignId ? d.select().from(campaigns).where(eq(campaigns.id, user.campaignId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    user.referredBy ? d.select({ id: users.id, username: users.username, firstName: users.firstName, telegramId: users.telegramId }).from(users).where(eq(users.id, user.referredBy)).then((r) => r[0] ?? null) : Promise.resolve(null),
    d
      .select({
        id: dreams.id,
        title: dreams.title,
        status: dreams.status,
        source: dreams.source,
        createdAt: dreams.createdAt,
        deletedAt: dreams.deletedAt,
        isDemo: dreams.analysisIsDemo,
        slideshows: sql<number>`(select count(*)::int from dream_media m where m.dream_id = ${DREAMS_ID} and m.media_type = 'slideshow' and m.status = 'ready' and m.deleted_at is null)`,
        videos: sql<number>`(select count(*)::int from dream_media m where m.dream_id = ${DREAMS_ID} and m.media_type = 'video' and m.status = 'ready' and m.deleted_at is null)`,
        consent: dreams.publicationConsentAt,
      })
      .from(dreams)
      .where(eq(dreams.userId, userId))
      .orderBy(desc(dreams.createdAt))
      .limit(30),
    d.select().from(generationJobs).where(eq(generationJobs.userId, userId)).orderBy(desc(generationJobs.createdAt)).limit(25),
    d
      .select({ p: payments, titleRu: pricingPlans.titleRu })
      .from(payments)
      .leftJoin(pricingPlans, eq(pricingPlans.id, payments.productId))
      .where(eq(payments.userId, userId))
      .orderBy(desc(payments.createdAt))
      .limit(30),
    d.select().from(creditTransactions).where(eq(creditTransactions.userId, userId)).orderBy(desc(creditTransactions.createdAt)).limit(60),
    d
      .select({ r: referrals, invited: { id: invited.id, username: invited.username, firstName: invited.firstName, hasPaid: invited.hasPaid } })
      .from(referrals)
      .innerJoin(invited, eq(invited.id, referrals.invitedId))
      .where(eq(referrals.inviterId, userId))
      .orderBy(desc(referrals.createdAt))
      .limit(50),
    d
      .select({ r: referrals, inviter: { id: inviter.id, username: inviter.username, firstName: inviter.firstName } })
      .from(referrals)
      .innerJoin(inviter, eq(inviter.id, referrals.inviterId))
      .where(eq(referrals.invitedId, userId))
      .then((r) => r[0] ?? null),
  ]);
  return { user, settings, campaign, referredBy, dreams: dreamRows, jobs, payments: pays, ledger, invitedRefs, invitedBy };
}

// ─── Generations ────────────────────────────────────────────────────────────

export async function listJobs(params: ListParams & { status?: string; format?: string; userId?: string; kind?: string }) {
  const { limit, offset, pageSize } = paging(params);
  const conds: SQL[] = [];
  if (params.status === "active") conds.push(inArray(generationJobs.status, [...ACTIVE_JOB_STATUSES]));
  else if (params.status && ["queued", "completed", "failed", "cancelled"].includes(params.status)) conds.push(eq(generationJobs.status, params.status as "failed"));
  if (params.format === "slideshow" || params.format === "video") conds.push(eq(generationJobs.mediaType, params.format));
  if (params.kind && ["full", "scene_image", "scene_video", "rerender"].includes(params.kind)) conds.push(eq(generationJobs.kind, params.kind as "full"));
  if (params.userId && UUID_RE.test(params.userId)) conds.push(eq(generationJobs.userId, params.userId));
  const rows = await db()
    .select({
      job: generationJobs,
      user: { id: users.id, username: users.username, firstName: users.firstName, telegramId: users.telegramId },
      dreamTitle: dreams.title,
      dreamDeleted: dreams.deletedAt,
    })
    .from(generationJobs)
    .innerJoin(users, eq(users.id, generationJobs.userId))
    .innerJoin(dreams, eq(dreams.id, generationJobs.dreamId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(generationJobs.createdAt))
    .limit(limit)
    .offset(offset);
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}

// ─── Payments ───────────────────────────────────────────────────────────────

export async function listPayments(params: ListParams & { status?: string; q?: string }) {
  const { limit, offset, pageSize } = paging(params);
  const conds: SQL[] = [];
  if (params.status === "orphan") conds.push(sql`${payments.invoicePayload} like 'orphan:%'`);
  else if (params.status && ["pending", "paid", "refunded", "failed", "expired"].includes(params.status)) conds.push(eq(payments.status, params.status as "paid"));
  const q = params.q?.trim();
  if (q) {
    if (/^\d{3,15}$/.test(q)) conds.push(eq(payments.telegramUserId, Number(q)));
    else if (UUID_RE.test(q)) conds.push(or(eq(payments.id, q), eq(payments.userId, q))!);
    else conds.push(eq(payments.telegramPaymentChargeId, q.slice(0, 200)));
  }
  const rows = await db()
    .select({
      p: payments,
      product: pricingPlans.titleRu,
      user: { id: users.id, username: users.username, firstName: users.firstName, telegramId: users.telegramId },
    })
    .from(payments)
    .leftJoin(pricingPlans, eq(pricingPlans.id, payments.productId))
    .leftJoin(users, eq(users.id, payments.userId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(limit)
    .offset(offset);
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}

export async function paymentTotals() {
  const res = await db().execute<Record<string, unknown>>(sql`
    select status::text as status, count(*) as n, coalesce(sum(stars_amount), 0) as stars, coalesce(sum(credits_amount), 0) as credits
    from payments group by status
  `);
  return res.rows.map((r) => ({ status: String(r.status), count: num(r.n), stars: num(r.stars), credits: num(r.credits) }));
}

// ─── Referrals, promo, campaigns ────────────────────────────────────────────

export async function listReferrals(params: ListParams & { status?: string }) {
  const { limit, offset, pageSize } = paging(params);
  const inviter = alias(users, "inviter");
  const invited = alias(users, "invited");
  const conds: SQL[] = [];
  if (params.status && ["pending", "qualified", "rewarded", "blocked"].includes(params.status)) conds.push(eq(referrals.status, params.status as "pending"));
  const rows = await db()
    .select({
      r: referrals,
      inviter: { id: inviter.id, username: inviter.username, firstName: inviter.firstName, telegramId: inviter.telegramId, createdAt: inviter.createdAt },
      invited: { id: invited.id, username: invited.username, firstName: invited.firstName, telegramId: invited.telegramId, hasPaid: invited.hasPaid, createdAt: invited.createdAt },
    })
    .from(referrals)
    .innerJoin(inviter, eq(inviter.id, referrals.inviterId))
    .innerJoin(invited, eq(invited.id, referrals.invitedId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(referrals.createdAt))
    .limit(limit)
    .offset(offset);
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}

export async function referralSummary() {
  const res = await db().execute<Record<string, unknown>>(sql`
    select status::text as status, count(*) as n, coalesce(sum(reward_inviter + reward_invited), 0) as credits
    from referrals group by status
  `);
  return res.rows.map((r) => ({ status: String(r.status), count: num(r.n), credits: num(r.credits) }));
}

export async function listPromoCodes() {
  return db().select().from(promoCodes).orderBy(desc(promoCodes.createdAt)).limit(300);
}

export interface CampaignStats {
  campaign: typeof campaigns.$inferSelect;
  registrations: number;
  payers: number;
  stars: number;
  opens: number;
  posts: number;
}

/** Attribution: a user belongs to a campaign by campaign_id or by the raw start parameter c_<code>. */
export async function listCampaignStats(): Promise<CampaignStats[]> {
  const rows = await db().select().from(campaigns).orderBy(desc(campaigns.createdAt));
  if (rows.length === 0) return [];
  const res = await db().execute<Record<string, unknown>>(sql`
    select c.id,
      (select count(*) from users u where u.campaign_id = c.id or lower(u.referral_source) = 'c_' || c.code) as registrations,
      (select count(*) from users u where (u.campaign_id = c.id or lower(u.referral_source) = 'c_' || c.code) and u.has_paid) as payers,
      (select coalesce(sum(p.stars_amount), 0) from payments p join users u on u.id = p.user_id
         where (u.campaign_id = c.id or lower(u.referral_source) = 'c_' || c.code) and p.status = 'paid') as stars,
      (select count(*) from analytics_events e where e.name = 'app_open' and lower(coalesce(e.props->>'startParam', e.props->>'start_param', '')) = 'c_' || c.code) as opens,
      (select count(*) from channel_posts cp where cp.campaign_id = c.id and cp.status = 'published') as posts
    from campaigns c
  `);
  const byId = new Map(res.rows.map((r) => [String(r.id), r]));
  return rows.map((c) => {
    const r = byId.get(c.id) ?? {};
    return { campaign: c, registrations: num(r.registrations), payers: num(r.payers), stars: num(r.stars), opens: num(r.opens), posts: num(r.posts) };
  });
}

export async function registrationSources() {
  const res = await db().execute<Record<string, unknown>>(sql`
    select
      case
        when referral_source is null or referral_source = '' then 'organic'
        when referral_source like 'ref\\_%' then 'referral'
        when referral_source like 'c\\_%' then 'campaign'
        else 'other'
      end as source,
      count(*) as users,
      count(*) filter (where has_paid) as payers
    from users
    group by 1
    order by 2 desc
  `);
  return res.rows.map((r) => ({ source: String(r.source), users: num(r.users), payers: num(r.payers) }));
}

// ─── Channel, content, team, audit ──────────────────────────────────────────

export async function listChannelPosts(limit = 100) {
  return db()
    .select({ post: channelPosts, dreamTitle: dreams.title, campaignCode: campaigns.code, media: dreamMedia })
    .from(channelPosts)
    .leftJoin(dreams, eq(dreams.id, channelPosts.dreamId))
    .leftJoin(campaigns, eq(campaigns.id, channelPosts.campaignId))
    .leftJoin(dreamMedia, eq(dreamMedia.id, channelPosts.mediaId))
    .orderBy(desc(channelPosts.createdAt))
    .limit(limit);
}

export async function listAllStyles() {
  return db().select().from(visualStyles).orderBy(asc(visualStyles.sortOrder), asc(visualStyles.id));
}

export async function listLibraryMusic() {
  return db().select().from(musicTracks).where(isNull(musicTracks.ownerUserId)).orderBy(asc(musicTracks.sortOrder), desc(musicTracks.createdAt));
}

export async function userMusicCount() {
  const [r] = await db().select({ n: count() }).from(musicTracks).where(sql`${musicTracks.ownerUserId} is not null`);
  return r?.n ?? 0;
}

export async function listAllProducts() {
  return db().select().from(pricingPlans).orderBy(asc(pricingPlans.sortOrder), asc(pricingPlans.starsPrice));
}

export async function listAdminUsers() {
  return db().select().from(adminUsers).orderBy(asc(adminUsers.createdAt));
}

export async function listAuditLogs(params: ListParams & { action?: string }) {
  const { limit, offset, pageSize } = paging({ pageSize: 100, ...params });
  const conds: SQL[] = [];
  if (params.action) conds.push(ilike(adminAuditLogs.action, `${escapeLike(params.action.slice(0, 60))}%`));
  const rows = await db()
    .select()
    .from(adminAuditLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(adminAuditLogs.createdAt))
    .limit(limit)
    .offset(offset);
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize };
}

export async function recentFailedJobs(limit = 6) {
  return db()
    .select({ job: generationJobs, username: users.username, telegramId: users.telegramId, dreamTitle: dreams.title })
    .from(generationJobs)
    .innerJoin(users, eq(users.id, generationJobs.userId))
    .innerJoin(dreams, eq(dreams.id, generationJobs.dreamId))
    .where(eq(generationJobs.status, "failed"))
    .orderBy(desc(generationJobs.finishedAt))
    .limit(limit);
}

/** Media ids usable as format examples / channel media: ready slideshow or video results. */
export async function getResultMedia(mediaIds: string[]) {
  const ids = mediaIds.filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return [];
  return db()
    .select()
    .from(dreamMedia)
    .where(and(inArray(dreamMedia.id, ids), isNull(dreamMedia.deletedAt)));
}
