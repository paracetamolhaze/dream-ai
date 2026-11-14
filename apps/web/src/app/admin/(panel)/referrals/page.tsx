import Link from "next/link";
import { listReferrals, referralSummary } from "@dream/core/services/admin-stats";
import { getSettings } from "@dream/core/settings";
import { ActionForm, Submit } from "../../_components/action-form";
import { Badge, Card, EmptyRow, FilterTabs, PageHeader, Pager, Stat, StatusBadge, TableWrap } from "../../_components/ui";
import { REFERRAL_STATUS } from "../../_lib/dict";
import { fmtDateTime, fmtDuration, fmtNum, pageParam, sp, userLabel, withParams } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { blockReferralAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Рефералы" };

export default async function ReferralsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("admin");
  const params = await searchParams;
  const status = sp(params, "status") ?? "all";
  const page = pageParam(params);
  const [{ items, hasNext }, summary, settings] = await Promise.all([listReferrals({ status: status === "all" ? undefined : status, page }), referralSummary(), getSettings()]);
  const s = (k: string) => summary.find((x) => x.status === k);
  const rf = settings.referral;

  return (
    <>
      <PageHeader
        title="Рефералы"
        subtitle={
          <>
            Награда: {rf.rewardInviter} кр. пригласившему и {rf.rewardInvited} кр. приглашённому за «{rf.trigger === "first_purchase" ? "первую покупку" : "первый сон"}».{" "}
            <Link href="/admin/monetization">Настроить →</Link>
          </>
        }
      />
      <div className="adm-grid adm-grid-stats">
        <Stat label="Ожидают условия" value={fmtNum(s("pending")?.count ?? 0)} />
        <Stat label="Награждены" value={fmtNum(s("rewarded")?.count ?? 0)} hint={`${fmtNum(s("rewarded")?.credits ?? 0)} кр. выдано`} tone="good" />
        <Stat label="Квалифицированы (лимит)" value={fmtNum(s("qualified")?.count ?? 0)} hint="достигли дневного лимита наград" />
        <Stat label="Заблокированы" value={fmtNum(s("blocked")?.count ?? 0)} tone={(s("blocked")?.count ?? 0) > 0 ? "warn" : undefined} />
      </div>
      <Card>
        <FilterTabs
          active={status}
          items={[
            { key: "all", label: "Все", href: "/admin/referrals" },
            { key: "pending", label: "Ожидают", href: "/admin/referrals?status=pending" },
            { key: "rewarded", label: "Награждены", href: "/admin/referrals?status=rewarded" },
            { key: "qualified", label: "Квалифицированы", href: "/admin/referrals?status=qualified" },
            { key: "blocked", label: "Заблокированы", href: "/admin/referrals?status=blocked" },
          ]}
        />
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Создан</th>
                <th>Пригласил</th>
                <th>Приглашён</th>
                <th>Интервал</th>
                <th>Статус</th>
                <th className="num">Награды</th>
                <th>Блокировка</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? <EmptyRow colSpan={7}>Рефералов нет</EmptyRow> : null}
              {items.map(({ r, inviter, invited }) => {
                // Suspicion hint: invited account registered within minutes after the inviter (possible self-invite farm).
                const gap = invited.createdAt.getTime() - inviter.createdAt.getTime();
                const suspicious = gap >= 0 && gap < 10 * 60_000;
                return (
                  <tr key={r.id} className={suspicious && r.status !== "blocked" ? "is-warn" : undefined}>
                    <td className="adm-nowrap">{fmtDateTime(r.createdAt)}</td>
                    <td>
                      <Link href={`/admin/users/${inviter.id}`}>{userLabel(inviter)}</Link>
                    </td>
                    <td>
                      <Link href={`/admin/users/${invited.id}`}>{userLabel(invited)}</Link> {invited.hasPaid ? <Badge tone="good">paid</Badge> : null}
                    </td>
                    <td className="adm-muted adm-nowrap">
                      {fmtDuration(gap)} {suspicious ? <Badge tone="warn" title="Аккаунт приглашённого создан почти сразу после аккаунта пригласившего">подозрительно</Badge> : null}
                    </td>
                    <td>
                      <StatusBadge map={REFERRAL_STATUS} value={r.status} />
                      {r.blockedReason ? <div className="adm-faint">{r.blockedReason}</div> : null}
                    </td>
                    <td className="num">
                      {r.rewardInviter} / {r.rewardInvited}
                    </td>
                    <td>
                      {r.status !== "blocked" ? (
                        <ActionForm action={blockReferralAction} confirm="Заблокировать реферал? Невыплаченные награды не будут начислены, выплаченные — отозваны в пределах баланса." inline>
                          <input type="hidden" name="referralId" value={r.id} />
                          <input name="reason" required minLength={3} maxLength={200} className="adm-input adm-input-sm" placeholder="причина" />
                          <Submit variant="danger" size="sm">
                            Заблокировать
                          </Submit>
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        <Pager page={page} hasNext={hasNext} href={(p) => withParams("/admin/referrals", { status: status === "all" ? undefined : status, page: p })} />
      </Card>
    </>
  );
}
