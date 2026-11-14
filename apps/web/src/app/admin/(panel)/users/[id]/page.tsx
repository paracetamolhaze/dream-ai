import Link from "next/link";
import { notFound } from "next/navigation";
import { userDetail } from "@dream/core/services/admin-stats";
import { roleAtLeast } from "@dream/core/services/admin-ops";
import { ActionForm, Submit } from "../../../_components/action-form";
import { Badge, Card, EmptyRow, Field, KeyValue, Mono, PageHeader, StatusBadge, TableWrap } from "../../../_components/ui";
import { CREDIT_TX, DREAM_SOURCE, DREAM_STATUS, FORMAT, JOB_KIND, JOB_STATUS, PAYMENT_STATUS, REFERRAL_STATUS, USER_STATUS } from "../../../_lib/dict";
import { fmtDateTime, fmtNum, fmtStars, fmtUsd, truncate, userLabel } from "../../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { adjustCreditsAction, blockReferralFromUserAction, setUserStatusAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Пользователь" };

export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminPage();
  const { id } = await params;
  const d = await userDetail(id);
  if (!d) notFound();
  const { user } = d;
  const canManage = roleAtLeast(admin.role, "admin");
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || userLabel(user);

  return (
    <>
      <PageHeader
        title={name}
        subtitle={
          <>
            <Link href="/admin/users">← Пользователи</Link> · <Mono>{user.id}</Mono>
          </>
        }
        actions={
          <>
            <StatusBadge map={USER_STATUS} value={user.status} />
            {user.hasPaid ? <Badge tone="good">Платящий</Badge> : <Badge>Не платил</Badge>}
            {user.isPremium ? <Badge tone="accent">Telegram Premium</Badge> : null}
          </>
        }
      />

      <div className="adm-grid adm-grid-3">
        <Card title="Профиль">
          <div className="adm-profile">
            {user.photoUrl ? <img src={user.photoUrl} alt="" className="adm-avatar-lg" referrerPolicy="no-referrer" /> : <span className="adm-avatar-lg adm-avatar-ph">{name.slice(0, 1)}</span>}
            <KeyValue
              items={[
                ["Telegram id", <Mono key="tg">{user.telegramId}</Mono>],
                [
                  "Username",
                  user.username ? (
                    <a key="u" href={`https://t.me/${user.username}`} target="_blank" rel="noreferrer">
                      @{user.username}
                    </a>
                  ) : (
                    "—"
                  ),
                ],
                ["Язык", `${user.language}${user.telegramLanguage ? ` (TG: ${user.telegramLanguage})` : ""}`],
                ["Регистрация", fmtDateTime(user.createdAt)],
                ["Последний визит", fmtDateTime(user.lastSeenAt)],
                ["Чат с ботом", user.botChatAvailable ? "доступен" : "нет"],
                ["Реф. код", <Mono key="rc">{user.referralCode}</Mono>],
                ["Источник", user.referralSource ? <Mono key="src">{user.referralSource}</Mono> : "органика"],
                ["Кампания", d.campaign ? `${d.campaign.name} (${d.campaign.code})` : "—"],
                [
                  "Пригласил",
                  d.referredBy ? (
                    <Link key="rb" href={`/admin/users/${d.referredBy.id}`}>
                      {userLabel(d.referredBy)}
                    </Link>
                  ) : (
                    "—"
                  ),
                ],
                ["Первая покупка", fmtDateTime(user.firstPurchaseAt)],
                ["Уведомления", d.settings ? `${d.settings.notifications.generationReady ? "готовность ✓" : "готовность ✕"} · ${d.settings.notifications.reminders ? `напоминания ${d.settings.notifications.reminderTime}` : "без напоминаний"}` : "—"],
              ]}
            />
          </div>
        </Card>

        <Card title="Баланс" subtitle="Все изменения записываются в журнал кредитов и аудит">
          <div className="adm-balance">
            <div>
              <div className="adm-stat-label">Доступно</div>
              <div className="adm-balance-value">{fmtNum(user.creditsBalance)} кр.</div>
            </div>
            <div>
              <div className="adm-stat-label">В резерве</div>
              <div className="adm-balance-value adm-muted">{fmtNum(user.creditsReserved)} кр.</div>
            </div>
            <div>
              <div className="adm-stat-label">Бесплатных слайд-шоу использовано</div>
              <div className="adm-balance-value adm-muted">{fmtNum(user.freeSlideshowsUsed)}</div>
            </div>
          </div>
          {canManage ? (
            <ActionForm action={adjustCreditsAction} resetOnSuccess>
              <input type="hidden" name="userId" value={user.id} />
              <div className="adm-form-grid">
                <Field label="Операция">
                  <select name="direction" className="adm-select" defaultValue="grant">
                    <option value="grant">Начислить</option>
                    <option value="revoke">Списать</option>
                  </select>
                </Field>
                <Field label="Кредиты">
                  <input name="amount" type="number" min={1} step={1} required className="adm-input" />
                </Field>
                <Field label="Причина" wide>
                  <input name="reason" required minLength={3} maxLength={300} className="adm-input" placeholder="Компенсация за ошибку генерации…" />
                </Field>
              </div>
              <Submit>Применить</Submit>
            </ActionForm>
          ) : (
            <p className="adm-muted">Изменение баланса доступно ролям «Администратор» и «Владелец».</p>
          )}
        </Card>

        <Card title="Доступ">
          {user.restrictedReason ? (
            <p className="adm-muted">
              Причина ограничения: <span className="adm-strong">{user.restrictedReason}</span>
            </p>
          ) : null}
          {canManage && user.status !== "deleted" ? (
            <ActionForm action={setUserStatusAction} confirm="Изменить статус доступа пользователя?">
              <input type="hidden" name="userId" value={user.id} />
              <div className="adm-form-grid">
                <Field label="Статус">
                  <select name="status" className="adm-select" defaultValue={user.status}>
                    <option value="active">Активен</option>
                    <option value="restricted">Ограничен (нет доступа к API)</option>
                    <option value="banned">Заблокирован</option>
                  </select>
                </Field>
                <Field label="Причина" wide>
                  <input name="reason" maxLength={300} className="adm-input" placeholder="Злоупотребление бесплатными генерациями…" />
                </Field>
              </div>
              <Submit variant="danger">Сохранить статус</Submit>
            </ActionForm>
          ) : (
            <p className="adm-muted">{user.status === "deleted" ? "Аккаунт удаляется по запросу пользователя." : "Недостаточно прав."}</p>
          )}
          <h3 className="adm-h3">Рефералы</h3>
          {d.invitedBy ? (
            <p className="adm-muted">
              Приглашён: <Link href={`/admin/users/${d.invitedBy.inviter.id}`}>{userLabel(d.invitedBy.inviter)}</Link> · <StatusBadge map={REFERRAL_STATUS} value={d.invitedBy.r.status} />
            </p>
          ) : null}
          <p className="adm-muted">
            Пригласил: {fmtNum(d.invitedRefs.length)} · платящих {fmtNum(d.invitedRefs.filter((r) => r.invited.hasPaid).length)}
          </p>
        </Card>
      </div>

      <Card title="Сны" subtitle="Тексты и записи снов приватны и в админ-панели не показываются">
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Создан</th>
                <th>Название</th>
                <th>Источник</th>
                <th>Статус</th>
                <th className="num">Слайд-шоу</th>
                <th className="num">Видео</th>
                <th>Согласие на публикацию</th>
              </tr>
            </thead>
            <tbody>
              {d.dreams.length === 0 ? <EmptyRow colSpan={7}>Снов пока нет</EmptyRow> : null}
              {d.dreams.map((dr) => (
                <tr key={dr.id} className={dr.deletedAt ? "is-muted" : undefined}>
                  <td className="adm-nowrap">{fmtDateTime(dr.createdAt)}</td>
                  <td>
                    {truncate(dr.title ?? "Без названия", 50)} {dr.isDemo ? <Badge tone="warn">demo-анализ</Badge> : null} {dr.deletedAt ? <Badge>удалён</Badge> : null}
                  </td>
                  <td className="adm-muted">{DREAM_SOURCE[dr.source] ?? dr.source}</td>
                  <td>
                    <StatusBadge map={DREAM_STATUS} value={dr.status} />
                  </td>
                  <td className="num">{fmtNum(dr.slideshows)}</td>
                  <td className="num">{fmtNum(dr.videos)}</td>
                  <td>{dr.consent ? <Badge tone="good">с {fmtDateTime(dr.consent)}</Badge> : <span className="adm-faint">нет</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card
        title="Генерации"
        actions={
          <Link className="adm-btn adm-btn-ghost adm-btn-sm" href={`/admin/generations?user=${user.id}`}>
            Все генерации →
          </Link>
        }
      >
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Создана</th>
                <th>Формат</th>
                <th>Тип</th>
                <th>Статус</th>
                <th className="num">Кредиты</th>
                <th className="num">Себестоимость</th>
                <th>Ошибка</th>
              </tr>
            </thead>
            <tbody>
              {d.jobs.length === 0 ? <EmptyRow colSpan={7}>Генераций нет</EmptyRow> : null}
              {d.jobs.map((j) => (
                <tr key={j.id}>
                  <td className="adm-nowrap">{fmtDateTime(j.createdAt)}</td>
                  <td>{FORMAT[j.mediaType]}</td>
                  <td className="adm-muted">{JOB_KIND[j.kind]}</td>
                  <td>
                    <StatusBadge map={JOB_STATUS} value={j.status} /> {j.isDemo ? <Badge tone="warn">demo</Badge> : null}
                  </td>
                  <td className="num">
                    {j.usedFreeAllowance ? <Badge tone="info">free</Badge> : fmtNum(j.creditsCost)} <span className="adm-faint">{j.creditState}</span>
                  </td>
                  <td className="num">{fmtUsd(j.actualCostUsd, 3)}</td>
                  <td className="adm-muted">{j.errorCode ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div className="adm-grid adm-grid-2">
        <Card title="Платежи">
          <TableWrap>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Товар</th>
                  <th className="num">Stars</th>
                  <th className="num">Кредиты</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {d.payments.length === 0 ? <EmptyRow colSpan={5}>Платежей нет</EmptyRow> : null}
                {d.payments.map(({ p, titleRu }) => (
                  <tr key={p.id}>
                    <td className="adm-nowrap">{fmtDateTime(p.paidAt ?? p.createdAt)}</td>
                    <td>{titleRu ?? p.productId ?? "—"}</td>
                    <td className="num">{fmtStars(p.starsAmount)}</td>
                    <td className="num">{fmtNum(p.creditsAmount)}</td>
                    <td>
                      <StatusBadge map={PAYMENT_STATUS} value={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card title="Журнал кредитов" subtitle="Последние 60 операций">
          <TableWrap>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Операция</th>
                  <th className="num">Сумма</th>
                  <th className="num">Баланс после</th>
                  <th>Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {d.ledger.length === 0 ? <EmptyRow colSpan={5}>Операций нет</EmptyRow> : null}
                {d.ledger.map((t) => (
                  <tr key={t.id}>
                    <td className="adm-nowrap">{fmtDateTime(t.createdAt)}</td>
                    <td>
                      <StatusBadge map={CREDIT_TX} value={t.type} />
                    </td>
                    <td className={`num ${t.amount > 0 ? "adm-pos" : t.amount < 0 ? "adm-neg" : ""}`}>{t.amount > 0 ? `+${t.amount}` : t.amount}</td>
                    <td className="num">{fmtNum(t.balanceAfter)}</td>
                    <td className="adm-muted">
                      {truncate(t.note ?? t.source ?? "", 60)}
                      {t.adminTelegramId ? <span className="adm-faint"> · admin {t.adminTelegramId}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </div>

      <Card title="Приглашённые пользователи">
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Пользователь</th>
                <th>Статус</th>
                <th className="num">Награда пригласившему</th>
                <th className="num">Награда приглашённому</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {d.invitedRefs.length === 0 ? <EmptyRow colSpan={6}>Приглашений нет</EmptyRow> : null}
              {d.invitedRefs.map(({ r, invited }) => (
                <tr key={r.id}>
                  <td className="adm-nowrap">{fmtDateTime(r.createdAt)}</td>
                  <td>
                    <Link href={`/admin/users/${invited.id}`}>{userLabel(invited)}</Link> {invited.hasPaid ? <Badge tone="good">paid</Badge> : null}
                  </td>
                  <td>
                    <StatusBadge map={REFERRAL_STATUS} value={r.status} />
                  </td>
                  <td className="num">{fmtNum(r.rewardInviter)}</td>
                  <td className="num">{fmtNum(r.rewardInvited)}</td>
                  <td>
                    {canManage && r.status !== "blocked" ? (
                      <ActionForm action={blockReferralFromUserAction} confirm="Заблокировать реферал? Начисленные награды будут списаны в пределах баланса." inline>
                        <input type="hidden" name="referralId" value={r.id} />
                        <input type="hidden" name="userId" value={user.id} />
                        <input name="reason" required minLength={3} className="adm-input adm-input-sm" placeholder="причина" />
                        <Submit variant="danger" size="sm">
                          Блок
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
