import Link from "next/link";
import { listUsers } from "@dream/core/services/admin-stats";
import { Badge, Card, EmptyRow, FilterTabs, PageHeader, Pager, StatusBadge, TableWrap } from "../../_components/ui";
import { USER_STATUS } from "../../_lib/dict";
import { fmtDateTime, fmtNum, fmtStars, pageParam, sp, userLabel, withParams } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Пользователи" };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const params = await searchParams;
  const q = sp(params, "q") ?? "";
  const status = sp(params, "status") ?? "all";
  const paid = sp(params, "paid") === "1";
  const page = pageParam(params);
  const { items, hasNext } = await listUsers({ q, status: status === "all" ? undefined : status, paid, page });
  const base = { q, status: status === "all" ? undefined : status, paid: paid ? "1" : undefined };

  return (
    <>
      <PageHeader title="Пользователи" subtitle="Поиск по Telegram id, username, имени, реферальному коду или UUID" />
      <Card>
        <form className="adm-toolbar" method="get">
          <input className="adm-input adm-grow" type="search" name="q" defaultValue={q} placeholder="123456789, @username, имя…" aria-label="Поиск" />
          <select className="adm-select" name="status" defaultValue={status} aria-label="Статус">
            <option value="all">Все статусы</option>
            <option value="active">Активные</option>
            <option value="restricted">Ограниченные</option>
            <option value="banned">Заблокированные</option>
            <option value="deleted">Удаляются</option>
          </select>
          <label className="adm-check">
            <input type="checkbox" name="paid" value="1" defaultChecked={paid} /> Платящие
          </label>
          <button className="adm-btn adm-btn-primary" type="submit">
            Найти
          </button>
        </form>
        <FilterTabs
          active={paid ? "paid" : status}
          items={[
            { key: "all", label: "Все", href: withParams("/admin/users", { q }) },
            { key: "paid", label: "Платящие", href: withParams("/admin/users", { q, paid: "1" }) },
            { key: "restricted", label: "Ограниченные", href: withParams("/admin/users", { q, status: "restricted" }) },
            { key: "banned", label: "Заблокированные", href: withParams("/admin/users", { q, status: "banned" }) },
          ]}
        />
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Пользователь</th>
                <th>Telegram id</th>
                <th>Регистрация</th>
                <th>Был в сети</th>
                <th className="num">Баланс</th>
                <th className="num">Сны</th>
                <th className="num">Генерации</th>
                <th className="num">Оплачено</th>
                <th>Источник</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? <EmptyRow colSpan={10}>Никого не нашли</EmptyRow> : null}
              {items.map(({ user, dreams, jobs, stars }) => (
                <tr key={user.id}>
                  <td>
                    <Link href={`/admin/users/${user.id}`} className="adm-user-link">
                      {user.photoUrl ? <img src={user.photoUrl} alt="" className="adm-avatar-sm" referrerPolicy="no-referrer" /> : <span className="adm-avatar-sm adm-avatar-ph">{(user.firstName ?? "?").slice(0, 1)}</span>}
                      <span>
                        <span className="adm-strong">{[user.firstName, user.lastName].filter(Boolean).join(" ") || userLabel(user)}</span>
                        {user.username ? <span className="adm-muted"> @{user.username}</span> : null}
                      </span>
                    </Link>
                  </td>
                  <td className="adm-mono">{user.telegramId}</td>
                  <td className="adm-nowrap">{fmtDateTime(user.createdAt)}</td>
                  <td className="adm-nowrap adm-muted">{fmtDateTime(user.lastSeenAt)}</td>
                  <td className="num">
                    {fmtNum(user.creditsBalance)}
                    {user.creditsReserved ? <span className="adm-faint"> +{user.creditsReserved}</span> : null}
                  </td>
                  <td className="num">{fmtNum(dreams)}</td>
                  <td className="num">{fmtNum(jobs)}</td>
                  <td className="num">{stars ? fmtStars(stars) : <span className="adm-faint">—</span>}</td>
                  <td className="adm-muted adm-mono">{user.referralSource ?? "—"}</td>
                  <td>
                    <StatusBadge map={USER_STATUS} value={user.status} />
                    {user.hasPaid ? <Badge tone="good">paid</Badge> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
        <Pager page={page} hasNext={hasNext} href={(p) => withParams("/admin/users", { ...base, page: p })} />
      </Card>
    </>
  );
}
