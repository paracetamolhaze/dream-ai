import { listAuditLogs } from "@dream/core/services/admin-stats";
import { Card, EmptyRow, Mono, PageHeader, Pager, TableWrap } from "../../_components/ui";
import { fmtDateTime, pageParam, sp, truncate, withParams } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Журнал действий" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("admin");
  const params = await searchParams;
  const action = sp(params, "action") ?? "";
  const page = pageParam(params);
  const { items, hasNext } = await listAuditLogs({ action: action || undefined, page });

  return (
    <>
      <PageHeader title="Журнал действий" subtitle="Все изменения, сделанные через админ-панель: кто, что, когда и с какого IP" />
      <Card>
        <form className="adm-toolbar" method="get">
          <input name="action" defaultValue={action} className="adm-input adm-grow" placeholder="Фильтр по действию: user., payment.refund, settings…" />
          <button type="submit" className="adm-btn adm-btn-primary">
            Показать
          </button>
        </form>
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Администратор</th>
                <th>Действие</th>
                <th>Объект</th>
                <th>Данные</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? <EmptyRow colSpan={6}>Записей нет</EmptyRow> : null}
              {items.map((l) => {
                const payload = l.payload ? JSON.stringify(l.payload) : "";
                return (
                  <tr key={l.id}>
                    <td className="adm-nowrap">{fmtDateTime(l.createdAt)}</td>
                    <td>
                      <Mono>{l.adminTelegramId}</Mono>
                    </td>
                    <td>
                      <Mono>{l.action}</Mono>
                    </td>
                    <td className="adm-muted">
                      {l.targetType ? (
                        <>
                          {l.targetType} <Mono>{truncate(l.targetId, 18)}</Mono>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="adm-mono adm-small adm-muted" title={payload}>
                      {truncate(payload, 120)}
                    </td>
                    <td className="adm-mono adm-small">{l.ip ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
        <Pager page={page} hasNext={hasNext} href={(p) => withParams("/admin/audit", { action, page: p })} />
      </Card>
    </>
  );
}
