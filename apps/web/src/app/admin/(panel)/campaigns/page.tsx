import Link from "next/link";
import { env } from "@dream/core/env";
import { listCampaignStats, registrationSources } from "@dream/core/services/admin-stats";
import { botStartLink, miniAppLink } from "@dream/core/telegram/bot-api";
import { ShareBars } from "../../_components/charts";
import { ActionForm, Submit } from "../../_components/action-form";
import { CopyButton } from "../../_components/copy-button";
import { Badge, Card, EmptyRow, Field, Mono, Notice, PageHeader, TableWrap } from "../../_components/ui";
import { CAMPAIGN_TYPE, SOURCE_LABEL } from "../../_lib/dict";
import { fmtDateTime, fmtNum, fmtPct, fmtStars } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { createCampaignAction, toggleCampaignAction, updateCampaignAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Кампании" };

export default async function CampaignsPage() {
  await requireAdminPage("admin");
  const [stats, sources] = await Promise.all([listCampaignStats(), registrationSources()]);
  const hasBot = Boolean(env().TELEGRAM_BOT_USERNAME);

  return (
    <>
      <PageHeader title="Кампании и источники" subtitle="Метки c_<код> для канала, блогеров и рекламы. Атрибуция фиксируется при первой регистрации пользователя." />
      {!hasBot ? <Notice tone="warn">TELEGRAM_BOT_USERNAME не задан — ссылки ниже содержат заглушку BOT_USERNAME.</Notice> : null}

      <div className="adm-grid adm-grid-2">
        <Card title="Новая кампания">
          <ActionForm action={createCampaignAction} resetOnSuccess>
            <div className="adm-form-grid">
              <Field label="Код" hint="a–z, 0–9, _ и -; используется в ссылке как c_код">
                <input name="code" required minLength={2} maxLength={40} pattern="[A-Za-z0-9_-]{2,40}" className="adm-input" placeholder="blogger_anna" />
              </Field>
              <Field label="Название">
                <input name="name" required minLength={2} maxLength={120} className="adm-input" placeholder="Блогер Анна, ноябрь" />
              </Field>
              <Field label="Тип">
                <select name="type" className="adm-select" defaultValue="blogger">
                  {Object.entries(CAMPAIGN_TYPE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Партнёр (UUID пользователя)" hint="необязательно — для будущей партнёрской программы">
                <input name="partnerUserId" className="adm-input" placeholder="uuid" />
              </Field>
              <Field label="Заметки" wide>
                <input name="notes" maxLength={500} className="adm-input" />
              </Field>
            </div>
            <Submit>Создать кампанию</Submit>
          </ActionForm>
        </Card>

        <Card title="Источники регистраций" subtitle="Все пользователи">
          <ShareBars items={sources.map((s) => ({ label: `${SOURCE_LABEL[s.source] ?? s.source} · платящих ${fmtNum(s.payers)}`, value: s.users, tone: s.source === "organic" ? "info" : s.source === "referral" ? "good" : "accent" }))} />
        </Card>
      </div>

      <Card title="Кампании" subtitle="Переходы по t.me-ссылкам Telegram не сообщает; «Открытия» — события app_open с меткой кампании, «Регистрации» — новые пользователи с этой меткой.">
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Кампания</th>
                <th>Ссылки</th>
                <th className="num">Открытия</th>
                <th className="num">Регистрации</th>
                <th className="num">Платящие</th>
                <th className="num">Конверсия</th>
                <th className="num">Выручка</th>
                <th className="num">Посты</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stats.length === 0 ? <EmptyRow colSpan={9}>Кампаний пока нет</EmptyRow> : null}
              {stats.map(({ campaign: c, registrations, payers, stars, opens, posts }) => {
                const appLink = miniAppLink(`c_${c.code}`);
                const botLink = botStartLink(`c_${c.code}`);
                return (
                  <tr key={c.id} className={!c.isActive ? "is-muted" : undefined}>
                    <td>
                      <div className="adm-strong">{c.name}</div>
                      <Mono>c_{c.code}</Mono> <Badge tone="info">{CAMPAIGN_TYPE[c.type]}</Badge> {!c.isActive ? <Badge>выключена</Badge> : null}
                      {c.partnerUserId ? (
                        <div>
                          <Link href={`/admin/users/${c.partnerUserId}`}>партнёр →</Link>
                        </div>
                      ) : null}
                      <div className="adm-faint">с {fmtDateTime(c.createdAt)}</div>
                    </td>
                    <td>
                      <div className="adm-row">
                        <CopyButton value={appLink} label="Mini App" />
                        <CopyButton value={botLink} label="Бот /start" />
                      </div>
                      <div className="adm-faint adm-mono adm-small">{appLink}</div>
                    </td>
                    <td className="num">{fmtNum(opens)}</td>
                    <td className="num">{fmtNum(registrations)}</td>
                    <td className="num">{fmtNum(payers)}</td>
                    <td className="num">{registrations ? fmtPct(payers / registrations) : "—"}</td>
                    <td className="num">{fmtStars(stars)}</td>
                    <td className="num">{fmtNum(posts)}</td>
                    <td>
                      <details className="adm-details adm-details-inline">
                        <summary>Изменить</summary>
                        <div className="adm-details-body">
                          <ActionForm action={updateCampaignAction}>
                            <input type="hidden" name="id" value={c.id} />
                            <Field label="Название">
                              <input name="name" defaultValue={c.name} required minLength={2} className="adm-input" />
                            </Field>
                            <Field label="Тип">
                              <select name="type" className="adm-select" defaultValue={c.type}>
                                {Object.entries(CAMPAIGN_TYPE).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Заметки">
                              <input name="notes" defaultValue={c.notes ?? ""} className="adm-input" />
                            </Field>
                            <Submit size="sm">Сохранить</Submit>
                          </ActionForm>
                          <ActionForm action={toggleCampaignAction} inline>
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="active" value={c.isActive ? "0" : "1"} />
                            <Submit size="sm" variant={c.isActive ? "danger" : "ghost"}>
                              {c.isActive ? "Выключить" : "Включить"}
                            </Submit>
                          </ActionForm>
                        </div>
                      </details>
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
