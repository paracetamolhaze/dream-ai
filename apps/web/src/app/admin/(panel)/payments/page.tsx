import Link from "next/link";
import { listPayments, paymentTotals } from "@dream/core/services/admin-stats";
import { roleAtLeast } from "@dream/core/services/admin-ops";
import { ActionForm, Submit } from "../../_components/action-form";
import { Badge, Card, EmptyRow, FilterTabs, Mono, Notice, PageHeader, Pager, Stat, StatusBadge, TableWrap } from "../../_components/ui";
import { PAYMENT_STATUS } from "../../_lib/dict";
import { fmtDateTime, fmtNum, fmtStars, pageParam, sp, truncate, userLabel, withParams } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { refundPaymentAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Платежи" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage();
  const params = await searchParams;
  const status = sp(params, "status") ?? "all";
  const q = sp(params, "q") ?? "";
  const page = pageParam(params);
  const [{ items, hasNext }, totals] = await Promise.all([listPayments({ status: status === "all" ? undefined : status, q, page }), paymentTotals()]);
  const canRefund = roleAtLeast(admin.role, "admin");
  const total = (s: string) => totals.find((t) => t.status === s);
  const base = { status: status === "all" ? undefined : status, q };

  return (
    <>
      <PageHeader title="Платежи" subtitle="Telegram Stars (XTR). Кредиты начисляются только по подтверждённому successful_payment." />
      <div className="adm-grid adm-grid-stats">
        <Stat label="Оплачено" value={fmtStars(total("paid")?.stars ?? 0)} hint={`${fmtNum(total("paid")?.count ?? 0)} платежей · ${fmtNum(total("paid")?.credits ?? 0)} кр.`} tone="good" />
        <Stat label="Возвраты" value={fmtStars(total("refunded")?.stars ?? 0)} hint={`${fmtNum(total("refunded")?.count ?? 0)} платежей`} tone="warn" />
        <Stat label="Ожидают" value={fmtNum(total("pending")?.count ?? 0)} hint="созданные счета без оплаты" />
      </div>
      <Card>
        <form className="adm-toolbar" method="get">
          <input type="hidden" name="status" value={status === "all" ? "" : status} />
          <input className="adm-input adm-grow" type="search" name="q" defaultValue={q} placeholder="Telegram id, UUID платежа/пользователя или charge id" aria-label="Поиск" />
          <button className="adm-btn adm-btn-primary" type="submit">
            Найти
          </button>
        </form>
        <FilterTabs
          active={status}
          items={[
            { key: "all", label: "Все", href: withParams("/admin/payments", { q }) },
            { key: "paid", label: "Оплачены", href: withParams("/admin/payments", { q, status: "paid" }) },
            { key: "refunded", label: "Возвраты", href: withParams("/admin/payments", { q, status: "refunded" }) },
            { key: "pending", label: "Ожидают", href: withParams("/admin/payments", { q, status: "pending" }) },
            { key: "orphan", label: "Без счёта", href: withParams("/admin/payments", { q, status: "orphan" }) },
          ]}
        />
        {status === "orphan" ? (
          <Notice tone="warn">
            Платежи без связанного счёта или пользователя: деньги поступили, но кредиты автоматически не начислялись. Проверьте вручную и при необходимости начислите кредиты или оформите возврат.
          </Notice>
        ) : null}
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Создан / оплачен</th>
                <th>Пользователь</th>
                <th>Товар</th>
                <th className="num">Stars</th>
                <th className="num">Кредиты</th>
                <th>Статус</th>
                <th>Charge id</th>
                <th>Возврат</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? <EmptyRow colSpan={8}>Платежей не найдено</EmptyRow> : null}
              {items.map(({ p, product, user }) => {
                const orphan = p.invoicePayload.startsWith("orphan:");
                return (
                  <tr key={p.id} className={orphan ? "is-warn" : undefined}>
                    <td className="adm-nowrap">
                      {fmtDateTime(p.createdAt)}
                      {p.paidAt ? <div className="adm-faint">оплачен {fmtDateTime(p.paidAt)}</div> : null}
                    </td>
                    <td>
                      {user?.id ? <Link href={`/admin/users/${user.id}`}>{userLabel(user)}</Link> : <Mono>tg {p.telegramUserId ?? "—"}</Mono>}
                      {orphan ? <Badge tone="warn">без счёта</Badge> : null}
                    </td>
                    <td>
                      {product ?? p.productId ?? "—"}
                      {p.intent ? <div className="adm-faint">с автозапуском генерации</div> : null}
                    </td>
                    <td className="num">{fmtStars(p.starsAmount)}</td>
                    <td className="num">{fmtNum(p.creditsAmount)}</td>
                    <td>
                      <StatusBadge map={PAYMENT_STATUS} value={p.status} />
                      {p.refundReason ? <div className="adm-faint" title={p.refundReason}>{truncate(p.refundReason, 40)}</div> : null}
                    </td>
                    <td className="adm-mono adm-small" title={p.telegramPaymentChargeId ?? undefined}>
                      {p.telegramPaymentChargeId ? truncate(p.telegramPaymentChargeId, 22) : "—"}
                    </td>
                    <td>
                      {canRefund && p.status === "paid" && p.telegramPaymentChargeId && p.telegramUserId ? (
                        <ActionForm action={refundPaymentAction} confirm={`Вернуть ${p.starsAmount} ⭐ пользователю? Кредиты будут списаны в пределах баланса. Действие необратимо.`} inline>
                          <input type="hidden" name="paymentId" value={p.id} />
                          <input name="reason" required minLength={3} maxLength={300} className="adm-input adm-input-sm" placeholder="причина" />
                          <Submit variant="danger" size="sm">
                            Вернуть
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
        <Pager page={page} hasNext={hasNext} href={(pg) => withParams("/admin/payments", { ...base, page: pg })} />
      </Card>
    </>
  );
}
