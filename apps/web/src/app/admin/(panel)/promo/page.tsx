import { listPromoCodes } from "@dream/core/services/admin-stats";
import { ActionForm, Submit } from "../../_components/action-form";
import { CopyButton } from "../../_components/copy-button";
import { Badge, Card, EmptyRow, Field, Mono, PageHeader, TableWrap } from "../../_components/ui";
import { fmtDateTime, fmtNum, requestNow } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { createPromoAction, togglePromoAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Промокоды" };

export default async function PromoPage() {
  await requireAdminPage("admin");
  const codes = await listPromoCodes();
  const now = requestNow();

  return (
    <>
      <PageHeader title="Промокоды" subtitle="Одноразовые для каждого пользователя коды на бонусные кредиты. Активация — в профиле Mini App." />
      <Card title="Новый промокод">
        <ActionForm action={createPromoAction} resetOnSuccess>
          <div className="adm-form-grid">
            <Field label="Код" hint="A–Z, 0–9, _ и -; регистр не важен">
              <input name="code" required minLength={3} maxLength={32} className="adm-input adm-upper" placeholder="DREAMSTART" />
            </Field>
            <Field label="Кредиты">
              <input name="credits" type="number" min={1} required className="adm-input" defaultValue={10} />
            </Field>
            <Field label="Лимит активаций" hint="пусто — без лимита">
              <input name="maxRedemptions" type="number" min={1} className="adm-input" />
            </Field>
            <Field label="Действует до" hint="пусто — бессрочно">
              <input name="expiresAt" type="datetime-local" className="adm-input" />
            </Field>
            <Field label="Заметка" wide>
              <input name="note" maxLength={200} className="adm-input" placeholder="Для блогера @…, кампания ноябрь" />
            </Field>
            <label className="adm-check">
              <input type="checkbox" name="onlyNewUsers" /> Только для новых (до 7 дней, без покупок)
            </label>
          </div>
          <Submit>Создать</Submit>
        </ActionForm>
      </Card>

      <Card title="Все промокоды">
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Код</th>
                <th className="num">Кредиты</th>
                <th className="num">Активации</th>
                <th>Срок</th>
                <th>Условия</th>
                <th>Заметка</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 ? <EmptyRow colSpan={8}>Промокодов пока нет</EmptyRow> : null}
              {codes.map((c) => {
                const expired = c.expiresAt ? c.expiresAt.getTime() < now : false;
                const exhausted = c.maxRedemptions !== null && c.redemptionsCount >= c.maxRedemptions;
                return (
                  <tr key={c.id} className={!c.isActive || expired || exhausted ? "is-muted" : undefined}>
                    <td>
                      <Mono>{c.code}</Mono> <CopyButton value={c.code} label="⧉" />
                    </td>
                    <td className="num">{fmtNum(c.credits)}</td>
                    <td className="num">
                      {fmtNum(c.redemptionsCount)}
                      {c.maxRedemptions !== null ? <span className="adm-faint"> / {fmtNum(c.maxRedemptions)}</span> : <span className="adm-faint"> / ∞</span>}
                    </td>
                    <td className="adm-nowrap">{c.expiresAt ? fmtDateTime(c.expiresAt) : "бессрочно"}</td>
                    <td>{c.onlyNewUsers ? <Badge tone="info">новые</Badge> : <span className="adm-faint">все</span>}</td>
                    <td className="adm-muted">{c.note ?? ""}</td>
                    <td>
                      {!c.isActive ? <Badge>отключён</Badge> : expired ? <Badge tone="warn">истёк</Badge> : exhausted ? <Badge tone="warn">исчерпан</Badge> : <Badge tone="good">активен</Badge>}
                    </td>
                    <td>
                      <ActionForm action={togglePromoAction} inline>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="active" value={c.isActive ? "0" : "1"} />
                        <Submit variant={c.isActive ? "danger" : "ghost"} size="sm">
                          {c.isActive ? "Отключить" : "Включить"}
                        </Submit>
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
