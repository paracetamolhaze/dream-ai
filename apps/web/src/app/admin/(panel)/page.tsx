import Link from "next/link";
import { aiSpendByModel, dailySeries, dashboardStats, funnel, jobStatusBreakdown, queueCounts, recentFailedJobs } from "@dream/core/services/admin-stats";
import { BarChart, Funnel, ShareBars } from "../_components/charts";
import { Badge, Card, EmptyRow, Notice, PageHeader, Stat, TableWrap } from "../_components/ui";
import { FORMAT, JOB_STATUS, QUEUE_LABEL } from "../_lib/dict";
import { fmtDateTime, fmtDay, fmtNum, fmtPct, fmtStars, fmtUsd, truncate, userLabel } from "../_lib/format";
import { requireAdminPage } from "@/server/admin/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Дашборд" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const denied = (await searchParams).denied === "1";
  const [s, days, stages, queues, spend, failed, breakdown] = await Promise.all([
    dashboardStats(),
    dailySeries(14),
    funnel(30),
    queueCounts(),
    aiSpendByModel(7),
    recentFailedJobs(6),
    jobStatusBreakdown(7),
  ]);
  const queueBacklog = queues.reduce((n, q) => n + q.waiting + q.active + q.delayed + q.prioritized, 0);
  const statusAgg = new Map<string, number>();
  for (const b of breakdown) statusAgg.set(b.status, (statusAgg.get(b.status) ?? 0) + b.count);

  return (
    <>
      <PageHeader title="Дашборд" subtitle="Ключевые показатели продукта, денег и инфраструктуры" />
      {denied ? <Notice tone="warn">Раздел доступен только ролям с более высокими правами.</Notice> : null}

      <div className="adm-grid adm-grid-stats">
        <Stat label="Пользователи" value={fmtNum(s.usersTotal)} hint={`+${fmtNum(s.usersToday)} сегодня · +${fmtNum(s.users7d)} за 7 дн`} />
        <Stat label="Активные (7 дн)" value={fmtNum(s.active7d)} hint={s.usersTotal ? `${fmtPct(s.active7d / s.usersTotal)} от всех` : undefined} />
        <Stat label="Сны" value={fmtNum(s.dreamsTotal)} hint={`+${fmtNum(s.dreams7d)} за 7 дн`} />
        <Stat label="Слайд-шоу / видео" value={`${fmtNum(s.slideshows)} / ${fmtNum(s.videos)}`} hint="готовые результаты" />
        <Stat label="Конверсия в покупку" value={fmtPct(s.conversionToPurchase)} hint={`${fmtNum(s.payers)} платящих`} tone="accent" />
        <Stat label="Выручка" value={fmtStars(s.starsNet)} hint={`брутто ${fmtStars(s.starsGross)} · 7 дн ${fmtStars(s.stars7d)}`} tone="good" />
        <Stat label="Возвраты" value={fmtNum(s.refunds)} hint={fmtStars(s.refundedStars)} tone={s.refunds > 0 ? "warn" : undefined} />
        <Stat label="Расходы AI" value={fmtUsd(s.aiTotalUsd)} hint={`7 дн ${fmtUsd(s.ai7dUsd)} · сегодня ${fmtUsd(s.aiTodayUsd)}`} />
        <Stat label="Средняя стоимость генерации" value={fmtUsd(s.avgJobCostUsd, 3)} hint={`${fmtNum(s.jobsCompleted)} завершено`} />
        <Stat label="Ошибки генераций" value={fmtNum(s.jobsFailed7d)} hint={`за 7 дн · всего ${fmtNum(s.jobsFailed)}`} tone={s.jobsFailed7d > 0 ? "bad" : undefined} />
        <Stat label="Очередь задач" value={fmtNum(queueBacklog)} hint={`${fmtNum(s.jobsActive)} генераций активно`} tone={queueBacklog > 20 ? "warn" : undefined} />
        <Stat label="Обращения" value={fmtNum(s.ticketsOpen)} hint={s.orphanPayments ? `${s.orphanPayments} платежей без счёта` : "открытые тикеты"} tone={s.ticketsOpen > 0 || s.orphanPayments > 0 ? "warn" : undefined} />
      </div>

      <div className="adm-grid adm-grid-3">
        <Card title="Новые пользователи" subtitle="14 дней">
          <BarChart label="Регистрации" data={days.map((d) => ({ label: fmtDay(d.day), value: d.newUsers }))} tone="info" />
        </Card>
        <Card title="Генерации" subtitle="запущено за день">
          <BarChart label="Генерации" data={days.map((d) => ({ label: fmtDay(d.day), value: d.generations }))} tone="accent" />
        </Card>
        <Card title="Выручка" subtitle="Telegram Stars">
          <BarChart label="Stars" data={days.map((d) => ({ label: fmtDay(d.day), value: d.stars }))} tone="good" />
        </Card>
      </div>

      <div className="adm-grid adm-grid-2">
        <Card title="Воронка" subtitle="Когорта пользователей, зарегистрированных за последние 30 дней">
          <Funnel stages={stages} />
        </Card>
        <Card title="Расходы AI" subtitle="14 дней, USD">
          <BarChart label="AI, $" data={days.map((d) => ({ label: fmtDay(d.day), value: Math.round(d.aiCostUsd * 100) / 100 }))} tone="warn" format={(n) => n.toFixed(2)} />
          <h3 className="adm-h3">Статусы генераций за 7 дней</h3>
          <ShareBars
            items={[...statusAgg.entries()].map(([status, value]) => ({ label: JOB_STATUS[status]?.[0] ?? status, value, tone: JOB_STATUS[status]?.[1] ?? "neutral" }))}
          />
        </Card>
      </div>

      <div className="adm-grid adm-grid-2">
        <Card title="Очереди BullMQ">
          <TableWrap>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Очередь</th>
                  <th className="num">Ждут</th>
                  <th className="num">Активны</th>
                  <th className="num">Отложены</th>
                  <th className="num">Ошибки</th>
                  <th className="num">Готово</th>
                </tr>
              </thead>
              <tbody>
                {queues.map((q) => (
                  <tr key={q.name}>
                    <td>
                      {QUEUE_LABEL[q.name] ?? q.name} <span className="adm-faint adm-mono">{q.name}</span>
                      {!q.ok ? <Badge tone="bad" title={q.error}>Redis недоступен</Badge> : null}
                    </td>
                    <td className="num">{fmtNum(q.waiting + q.prioritized)}</td>
                    <td className="num">{fmtNum(q.active)}</td>
                    <td className="num">{fmtNum(q.delayed)}</td>
                    <td className="num">{q.failed ? <Badge tone="bad">{fmtNum(q.failed)}</Badge> : "0"}</td>
                    <td className="num adm-muted">{fmtNum(q.completed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        <Card title="Расходы по моделям" subtitle="7 дней">
          <TableWrap>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Тип</th>
                  <th>Провайдер / модель</th>
                  <th className="num">Вызовы</th>
                  <th className="num">Ошибки</th>
                  <th className="num">Стоимость</th>
                </tr>
              </thead>
              <tbody>
                {spend.length === 0 ? <EmptyRow colSpan={5}>Вызовов AI за период не было</EmptyRow> : null}
                {spend.map((r) => (
                  <tr key={`${r.kind}-${r.provider}-${r.model}`}>
                    <td>
                      <Badge tone="info">{r.kind.toUpperCase()}</Badge>
                    </td>
                    <td>
                      {r.provider} <span className="adm-mono adm-muted">{r.model}</span> {r.demo ? <Badge tone="warn">demo</Badge> : null}
                    </td>
                    <td className="num">{fmtNum(r.calls)}</td>
                    <td className="num">{r.failures ? <Badge tone="bad">{fmtNum(r.failures)}</Badge> : "0"}</td>
                    <td className="num">{fmtUsd(r.costUsd, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </div>

      <Card
        title="Последние ошибки генераций"
        actions={
          <Link href="/admin/generations?status=failed" className="adm-btn adm-btn-ghost adm-btn-sm">
            Все ошибки →
          </Link>
        }
      >
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Время</th>
                <th>Пользователь</th>
                <th>Сон</th>
                <th>Формат</th>
                <th>Код ошибки</th>
                <th>Сообщение</th>
              </tr>
            </thead>
            <tbody>
              {failed.length === 0 ? <EmptyRow colSpan={6}>Ошибок нет ✨</EmptyRow> : null}
              {failed.map((f) => (
                <tr key={f.job.id}>
                  <td className="adm-nowrap">{fmtDateTime(f.job.finishedAt ?? f.job.createdAt)}</td>
                  <td>
                    <Link href={`/admin/users/${f.job.userId}`}>{userLabel({ username: f.username, telegramId: f.telegramId })}</Link>
                  </td>
                  <td>{truncate(f.dreamTitle ?? "Без названия", 40)}</td>
                  <td>{FORMAT[f.job.mediaType]}</td>
                  <td>
                    <Badge tone="bad">{f.job.errorCode ?? "—"}</Badge>
                  </td>
                  <td className="adm-muted" title={f.job.errorMessage ?? ""}>
                    {truncate(f.job.errorMessage, 90) || "—"}
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
