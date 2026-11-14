import Link from "next/link";
import { listJobs } from "@dream/core/services/admin-stats";
import { roleAtLeast } from "@dream/core/services/admin-ops";
import { ActionForm, Submit } from "../../_components/action-form";
import { Badge, Card, EmptyRow, FilterTabs, Mono, PageHeader, Pager, StatusBadge, TableWrap } from "../../_components/ui";
import { FORMAT, JOB_KIND, JOB_STATUS } from "../../_lib/dict";
import { fmtDateTime, fmtDuration, fmtNum, fmtUsd, pageParam, requestNow, sp, truncate, userLabel, withParams } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { retryJobAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Генерации" };

export default async function GenerationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const admin = await requireAdminPage();
  const params = await searchParams;
  const status = sp(params, "status") ?? "all";
  const format = sp(params, "format") ?? "all";
  const userId = sp(params, "user");
  const page = pageParam(params);
  const { items, hasNext } = await listJobs({ status: status === "all" ? undefined : status, format: format === "all" ? undefined : format, userId, page });
  const canManage = roleAtLeast(admin.role, "admin");
  const base = { status: status === "all" ? undefined : status, format: format === "all" ? undefined : format, user: userId };
  const now = requestNow();

  return (
    <>
      <PageHeader
        title="Генерации"
        subtitle={
          userId ? (
            <>
              Фильтр по пользователю <Mono>{userId}</Mono> · <Link href={withParams("/admin/generations", { ...base, user: undefined })}>сбросить</Link>
            </>
          ) : (
            "Все фоновые задачи генерации слайд-шоу и видео"
          )
        }
      />
      <Card>
        <div className="adm-toolbar">
          <FilterTabs
            active={status}
            items={[
              { key: "all", label: "Все", href: withParams("/admin/generations", { ...base, status: undefined }) },
              { key: "active", label: "В работе", href: withParams("/admin/generations", { ...base, status: "active" }) },
              { key: "completed", label: "Готово", href: withParams("/admin/generations", { ...base, status: "completed" }) },
              { key: "failed", label: "Ошибки", href: withParams("/admin/generations", { ...base, status: "failed" }) },
              { key: "cancelled", label: "Отменены", href: withParams("/admin/generations", { ...base, status: "cancelled" }) },
            ]}
          />
          <FilterTabs
            active={format}
            items={[
              { key: "all", label: "Все форматы", href: withParams("/admin/generations", { ...base, format: undefined }) },
              { key: "slideshow", label: "Слайд-шоу", href: withParams("/admin/generations", { ...base, format: "slideshow" }) },
              { key: "video", label: "Видео", href: withParams("/admin/generations", { ...base, format: "video" }) },
            ]}
          />
        </div>
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Создана</th>
                <th>Пользователь</th>
                <th>Сон</th>
                <th>Формат</th>
                <th>Статус</th>
                <th>Модели</th>
                <th className="num">Кредиты</th>
                <th className="num">Оценка / факт</th>
                <th className="num">Длительность</th>
                <th>Ошибка</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? <EmptyRow colSpan={11}>Задач не найдено</EmptyRow> : null}
              {items.map(({ job, user, dreamTitle, dreamDeleted }) => {
                const duration = job.startedAt && job.finishedAt ? job.finishedAt.getTime() - job.startedAt.getTime() : job.startedAt ? now - job.startedAt.getTime() : null;
                const retryable = canManage && (job.status === "failed" || job.status === "cancelled") && !dreamDeleted;
                return (
                  <tr key={job.id}>
                    <td className="adm-nowrap">
                      {fmtDateTime(job.createdAt)}
                      <div className="adm-faint adm-mono">{job.id.slice(0, 8)}</div>
                    </td>
                    <td>
                      <Link href={`/admin/users/${user.id}`}>{userLabel(user)}</Link>
                    </td>
                    <td>
                      {truncate(dreamTitle ?? "Без названия", 34)} {dreamDeleted ? <Badge>удалён</Badge> : null}
                    </td>
                    <td>
                      {FORMAT[job.mediaType]}
                      <div className="adm-faint">{JOB_KIND[job.kind]}</div>
                    </td>
                    <td>
                      <StatusBadge map={JOB_STATUS} value={job.status} />
                      {job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled" ? <div className="adm-faint">{job.progress}%</div> : null}
                      {job.isDemo ? <Badge tone="warn">demo</Badge> : null}
                    </td>
                    <td className="adm-mono adm-small">
                      {job.model ?? "—"}
                      {job.videoModel ? <div>{job.videoModel}</div> : null}
                    </td>
                    <td className="num">
                      {job.usedFreeAllowance ? <Badge tone="info">free</Badge> : fmtNum(job.creditsCost)}
                      <div className="adm-faint">{job.creditState}</div>
                    </td>
                    <td className="num adm-nowrap">
                      {fmtUsd(job.estimatedCostUsd, 3)} / {fmtUsd(job.actualCostUsd, 3)}
                    </td>
                    <td className="num adm-nowrap">{fmtDuration(duration)}</td>
                    <td className="adm-err-cell" title={job.errorMessage ?? undefined}>
                      {job.errorCode ? <Badge tone="bad">{job.errorCode}</Badge> : null}
                      {job.errorMessage ? <div className="adm-faint">{truncate(job.errorMessage, 80)}</div> : null}
                      {job.retryCount ? <div className="adm-faint">попыток: {job.retryCount}</div> : null}
                    </td>
                    <td>
                      {retryable ? (
                        <ActionForm action={retryJobAction} confirm="Запустить генерацию заново? Для пользователя это бесплатно, расходы AI будут списаны с проекта." inline>
                          <input type="hidden" name="jobId" value={job.id} />
                          <Submit size="sm" variant="ghost">
                            Повторить
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
        <Pager page={page} hasNext={hasNext} href={(p) => withParams("/admin/generations", { ...base, page: p })} />
      </Card>
    </>
  );
}
