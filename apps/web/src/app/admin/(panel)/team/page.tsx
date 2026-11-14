import { envOwnerIds } from "@dream/core/services/admin-ops";
import { listAdminUsers } from "@dream/core/services/admin-stats";
import { ActionForm, Submit } from "../../_components/action-form";
import { Badge, Card, EmptyRow, Field, Mono, PageHeader, TableWrap } from "../../_components/ui";
import { ROLE } from "../../_lib/dict";
import { fmtDateTime } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { addAdminAction, removeAdminAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Команда" };

export default async function TeamPage() {
  const me = await requireAdminPage("owner");
  const [admins] = await Promise.all([listAdminUsers()]);
  const envOwners = envOwnerIds();

  return (
    <>
      <PageHeader title="Команда" subtitle="Кто может входить в админ-панель. Владельцы из ADMIN_TELEGRAM_IDS управляются только через окружение." />
      <div className="adm-grid adm-grid-2">
        <Card title="Выдать доступ">
          <ActionForm action={addAdminAction} resetOnSuccess>
            <div className="adm-form-grid">
              <Field label="Telegram id" hint="числовой id; узнать можно у @userinfobot">
                <input name="telegramId" type="number" min={1} required className="adm-input" />
              </Field>
              <Field label="Роль">
                <select name="role" className="adm-select" defaultValue="support">
                  <option value="support">Поддержка — просмотр и ответы на обращения</option>
                  <option value="admin">Администратор — всё, кроме команды</option>
                  <option value="owner">Владелец — полный доступ</option>
                </select>
              </Field>
              <Field label="Заметка" wide>
                <input name="note" maxLength={200} className="adm-input" />
              </Field>
            </div>
            <Submit>Сохранить</Submit>
          </ActionForm>
        </Card>
        <Card title="Права ролей">
          <ul className="adm-list">
            <li>
              <span className="adm-strong">Поддержка</span> — дашборд, пользователи, генерации и платежи (просмотр), ответы в поддержке.
            </li>
            <li>
              <span className="adm-strong">Администратор</span> — плюс модели, цены, товары, промокоды, рефералы, канал, кампании, стили, возвраты и начисления.
            </li>
            <li>
              <span className="adm-strong">Владелец</span> — плюс управление командой.
            </li>
          </ul>
        </Card>
      </div>
      <Card title="Администраторы">
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Telegram id</th>
                <th>Роль</th>
                <th>Источник</th>
                <th>Заметка</th>
                <th>Добавлен</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {envOwners.length === 0 && admins.length === 0 ? <EmptyRow colSpan={6}>Нет администраторов</EmptyRow> : null}
              {envOwners.map((id) => (
                <tr key={`env-${id}`}>
                  <td>
                    <Mono>{id}</Mono> {id === me.telegramId ? <Badge tone="accent">вы</Badge> : null}
                  </td>
                  <td>
                    <Badge tone="good">{ROLE.owner}</Badge>
                  </td>
                  <td className="adm-muted">ADMIN_TELEGRAM_IDS</td>
                  <td />
                  <td />
                  <td />
                </tr>
              ))}
              {admins
                .filter((a) => !envOwners.includes(a.telegramId))
                .map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Mono>{a.telegramId}</Mono> {a.telegramId === me.telegramId ? <Badge tone="accent">вы</Badge> : null}
                    </td>
                    <td>
                      <Badge tone={a.role === "owner" ? "good" : a.role === "admin" ? "accent" : "info"}>{ROLE[a.role]}</Badge>
                    </td>
                    <td className="adm-muted">админ-панель</td>
                    <td className="adm-muted">{a.note ?? ""}</td>
                    <td className="adm-nowrap">{fmtDateTime(a.createdAt)}</td>
                    <td>
                      {a.telegramId !== me.telegramId ? (
                        <ActionForm action={removeAdminAction} inline confirm={`Отозвать доступ у ${a.telegramId}?`}>
                          <input type="hidden" name="telegramId" value={a.telegramId} />
                          <Submit size="sm" variant="danger">
                            Отозвать
                          </Submit>
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
