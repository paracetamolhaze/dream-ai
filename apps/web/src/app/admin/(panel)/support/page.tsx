import Link from "next/link";
import { listTickets } from "@dream/core/services/support";
import { ActionForm, Submit } from "../../_components/action-form";
import { Badge, Card, Empty, FilterTabs, Mono, PageHeader, StatusBadge } from "../../_components/ui";
import { TICKET_STATUS } from "../../_lib/dict";
import { fmtDateTime, sp } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { closeTicketAction, replyTicketAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Поддержка" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage("support");
  const params = await searchParams;
  const filter = sp(params, "status") ?? "open";
  const all = await listTickets(300);
  const tickets = filter === "all" ? all : all.filter((t) => t.status === filter);
  const counts = { open: all.filter((t) => t.status === "open").length, answered: all.filter((t) => t.status === "answered").length, closed: all.filter((t) => t.status === "closed").length };

  return (
    <>
      <PageHeader title="Поддержка" subtitle="Обращения из /support и /paysupport. Ответ уходит пользователю сообщением от бота." />
      <FilterTabs
        active={filter}
        items={[
          { key: "open", label: `Открытые (${counts.open})`, href: "/admin/support" },
          { key: "answered", label: `Отвеченные (${counts.answered})`, href: "/admin/support?status=answered" },
          { key: "closed", label: `Закрытые (${counts.closed})`, href: "/admin/support?status=closed" },
          { key: "all", label: "Все", href: "/admin/support?status=all" },
        ]}
      />
      {tickets.length === 0 ? <Empty>Обращений нет</Empty> : null}
      <div className="adm-stack">
        {tickets.map((t) => (
          <Card
            key={t.id}
            title={
              <span className="adm-row">
                <span>#{t.id.slice(0, 8)}</span>
                <StatusBadge map={TICKET_STATUS} value={t.status} />
                <Badge tone={t.topic === "payment" ? "warn" : "info"}>{t.topic === "payment" ? "Оплата" : "Общий вопрос"}</Badge>
              </span>
            }
            subtitle={
              <>
                {fmtDateTime(t.createdAt)} · TG <Mono>{t.telegramUserId ?? "—"}</Mono>
                {t.userId ? (
                  <>
                    {" "}
                    · <Link href={`/admin/users/${t.userId}`}>профиль →</Link>
                  </>
                ) : null}
                {t.paymentId ? (
                  <>
                    {" "}
                    · <Link href={`/admin/payments?q=${t.paymentId}`}>платёж →</Link>
                  </>
                ) : null}
              </>
            }
          >
            <blockquote className="adm-quote">{t.message}</blockquote>
            {t.reply ? (
              <div className="adm-reply">
                <div className="adm-faint adm-small">
                  Ответ {t.repliedBy ? `от ${t.repliedBy}` : ""} · {fmtDateTime(t.repliedAt)}
                </div>
                <p>{t.reply}</p>
              </div>
            ) : null}
            {t.status !== "closed" && t.telegramUserId ? (
              <div className="adm-stack">
                <ActionForm action={replyTicketAction} resetOnSuccess>
                  <input type="hidden" name="ticketId" value={t.id} />
                  <textarea name="reply" rows={3} required minLength={2} maxLength={3500} className="adm-textarea" placeholder="Ответ пользователю…" />
                  <Submit size="sm">Отправить ответ</Submit>
                </ActionForm>
                <ActionForm action={closeTicketAction} inline>
                  <input type="hidden" name="ticketId" value={t.id} />
                  <Submit size="sm" variant="ghost">
                    Закрыть без ответа
                  </Submit>
                </ActionForm>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}
