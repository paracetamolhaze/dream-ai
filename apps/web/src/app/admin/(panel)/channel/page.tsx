import { env } from "@dream/core/env";
import { listCampaignStats, listChannelPosts } from "@dream/core/services/admin-stats";
import { eligibleDreamsForChannel } from "@dream/core/services/channel";
import { mediaDto } from "@dream/core/services/media";
import { ActionForm, Submit } from "../../_components/action-form";
import { Badge, Card, Empty, Field, Mono, Notice, PageHeader, StatusBadge } from "../../_components/ui";
import { FORMAT, POST_STATUS } from "../../_lib/dict";
import { fmtDateTime, toLocalInput, truncate } from "../../_lib/format";
import { telegramHtmlPreview } from "../../_lib/telegram-html";
import { requireAdminPage } from "@/server/admin/session";
import { approvePostAction, cancelPostAction, createPostAction, regenerateCaptionAction, resetPostAction, updatePostAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Telegram-канал" };

function channelMessageUrl(channelUrl: string | undefined, messageId: number | null): string | null {
  if (!channelUrl || !messageId) return null;
  const m = /^https:\/\/t\.me\/([A-Za-z0-9_]{4,})\/?$/.exec(channelUrl.trim());
  return m ? `https://t.me/${m[1]}/${messageId}` : null;
}

export default async function ChannelPage() {
  await requireAdminPage("admin");
  const e = env();
  const [posts, eligible, campaignStats] = await Promise.all([listChannelPosts(100), eligibleDreamsForChannel(60), listCampaignStats()]);
  const activeCampaigns = campaignStats.filter((c) => c.campaign.isActive).map((c) => c.campaign);
  const published = posts.filter((p) => p.post.status === "published").length;
  const scheduled = posts.filter((p) => p.post.status === "scheduled").length;

  return (
    <>
      <PageHeader title="Telegram-канал" subtitle={`Опубликовано: ${published} · в очереди: ${scheduled}. Публикация только после ручного подтверждения администратора.`} />
      {!e.TELEGRAM_CHANNEL_ID ? (
        <Notice tone="warn">
          TELEGRAM_CHANNEL_ID не задан. Добавьте бота администратором канала с правом публикации и укажите id канала (например, <Mono>-1001234567890</Mono> или <Mono>@channel</Mono>) в .env.
        </Notice>
      ) : (
        <Notice tone="info">
          Канал: <Mono>{e.TELEGRAM_CHANNEL_ID}</Mono>
          {e.TELEGRAM_CHANNEL_URL ? (
            <>
              {" "}
              ·{" "}
              <a href={e.TELEGRAM_CHANNEL_URL} target="_blank" rel="noreferrer">
                открыть
              </a>
            </>
          ) : null}
          . Запланированные посты отправляет воркер; кнопка под постом открывает Mini App с меткой кампании.
        </Notice>
      )}

      <Card title="Новый пост" subtitle="Только сны с явным согласием владельца на публикацию. Исходный текст и аудио пользователя никогда не публикуются.">
        <ActionForm action={createPostAction} resetOnSuccess>
          <div className="adm-form-grid">
            <Field label="Материал" wide hint={eligible.length === 0 ? "Пока нет снов с согласием на публикацию — доступен только текстовый пост" : `${eligible.length} результатов с согласием владельца`}>
              <select name="source" className="adm-select" defaultValue={eligible[0] ? `${eligible[0].dream.id}:${eligible[0].media.id}` : "text"}>
                {eligible.map(({ dream, media }) => (
                  <option key={media.id} value={`${dream.id}:${media.id}`}>
                    {truncate(dream.title ?? "Без названия", 50)} · {FORMAT[media.mediaType] ?? media.mediaType} v{media.version} · {fmtDateTime(media.createdAt)}
                    {media.isDemo ? " · DEMO" : ""}
                  </option>
                ))}
                <option value="text">Без медиа — текстовый пост</option>
              </select>
            </Field>
            <Field label="Подпись (Telegram HTML)" wide hint="Пусто — подпись будет сгенерирована автоматически по названию и описанию сна. До 1024 символов. Теги: <b> <i> <u> <s> <a href> <code> <blockquote> <tg-spoiler>">
              <textarea name="caption" rows={5} maxLength={1024} className="adm-textarea" placeholder="🌙 <b>Город без людей</b>…" />
            </Field>
            <Field label="Текст кнопки">
              <input name="buttonText" maxLength={64} className="adm-input" placeholder="Увидеть свой сон 🌙" />
            </Field>
            <Field label="Метка кампании" hint="для статистики переходов">
              <select name="campaignCode" className="adm-select" defaultValue="">
                <option value="">channel (по умолчанию)</option>
                {activeCampaigns.map((c) => (
                  <option key={c.id} value={c.code}>
                    {c.name} — c_{c.code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Желаемое время публикации" hint="можно изменить при подтверждении">
              <input name="scheduledAt" type="datetime-local" className="adm-input" />
            </Field>
          </div>
          <Submit>Создать черновик</Submit>
        </ActionForm>
      </Card>

      <h2 className="adm-h2 adm-section-title">Публикации</h2>
      {posts.length === 0 ? <Empty>Постов пока нет</Empty> : null}
      <div className="adm-post-grid">
        {posts.map(({ post, dreamTitle, campaignCode, media }) => {
          const m = media && media.status === "ready" ? mediaDto(media) : null;
          const link = channelMessageUrl(e.TELEGRAM_CHANNEL_URL, post.telegramMessageId);
          return (
            <article key={post.id} className="adm-card adm-post">
              <div className="adm-post-head">
                <StatusBadge map={POST_STATUS} value={post.status} />
                {campaignCode ? <Badge tone="info">c_{campaignCode}</Badge> : null}
                {m?.isDemo ? <Badge tone="warn">DEMO</Badge> : null}
                <span className="adm-faint adm-small">{fmtDateTime(post.createdAt)}</span>
              </div>
              <div className="adm-post-preview">
                {m ? (
                  m.type === "video" || m.type === "slideshow" ? (
                    <video className="adm-post-media" src={m.url ?? undefined} poster={m.thumbUrl ?? undefined} controls preload="none" playsInline muted />
                  ) : (
                    <img className="adm-post-media" src={m.url ?? ""} alt="" />
                  )
                ) : post.media ? (
                  <div className="adm-post-media adm-post-missing">медиа недоступно</div>
                ) : null}
                <div className="adm-post-caption" dangerouslySetInnerHTML={{ __html: telegramHtmlPreview(post.caption) }} />
                <div className="adm-post-button">{post.buttonText ?? "Открыть"}</div>
              </div>
              <div className="adm-post-meta adm-small adm-muted">
                {dreamTitle ? <div>Сон: {truncate(dreamTitle, 40)}</div> : null}
                {post.scheduledAt ? <div>Запланирован: {fmtDateTime(post.scheduledAt)}</div> : null}
                {post.publishedAt ? (
                  <div>
                    Опубликован: {fmtDateTime(post.publishedAt)}{" "}
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer">
                        открыть →
                      </a>
                    ) : null}
                  </div>
                ) : null}
                {post.error ? <div className="adm-neg">Ошибка: {truncate(post.error, 160)}</div> : null}
              </div>
              {post.status === "draft" ? (
                <div className="adm-stack">
                  <details className="adm-details">
                    <summary>Редактировать подпись</summary>
                    <div className="adm-details-body">
                      <ActionForm action={updatePostAction}>
                        <input type="hidden" name="postId" value={post.id} />
                        <textarea name="caption" rows={6} maxLength={1024} defaultValue={post.caption} className="adm-textarea" required />
                        <input name="buttonText" maxLength={64} defaultValue={post.buttonText ?? ""} className="adm-input" placeholder="Текст кнопки" />
                        <Submit size="sm">Сохранить</Submit>
                      </ActionForm>
                      {post.dreamId ? (
                        <ActionForm action={regenerateCaptionAction} inline confirm="Заменить подпись автоматически сгенерированной?">
                          <input type="hidden" name="postId" value={post.id} />
                          <input type="hidden" name="dreamId" value={post.dreamId} />
                          <Submit size="sm" variant="ghost">
                            Сгенерировать подпись
                          </Submit>
                        </ActionForm>
                      ) : null}
                    </div>
                  </details>
                  <ActionForm action={approvePostAction} confirm="Подтвердить публикацию этого поста в канале?">
                    <input type="hidden" name="postId" value={post.id} />
                    <Field label="Время публикации">
                      <input name="scheduledAt" type="datetime-local" defaultValue={toLocalInput(post.scheduledAt)} className="adm-input" />
                    </Field>
                    <div className="adm-row">
                      <Submit name="mode" value="schedule" size="sm">
                        Запланировать
                      </Submit>
                      <Submit name="mode" value="now" size="sm" variant="ghost">
                        Опубликовать сейчас
                      </Submit>
                    </div>
                  </ActionForm>
                  <ActionForm action={cancelPostAction} inline confirm="Отменить пост?">
                    <input type="hidden" name="postId" value={post.id} />
                    <Submit size="sm" variant="danger">
                      Отменить
                    </Submit>
                  </ActionForm>
                </div>
              ) : null}
              {post.status === "scheduled" ? (
                <ActionForm action={cancelPostAction} inline confirm="Снять пост с публикации?">
                  <input type="hidden" name="postId" value={post.id} />
                  <Submit size="sm" variant="danger">
                    Снять с публикации
                  </Submit>
                </ActionForm>
              ) : null}
              {post.status === "failed" || post.status === "cancelled" ? (
                <ActionForm action={resetPostAction} inline>
                  <input type="hidden" name="postId" value={post.id} />
                  <Submit size="sm" variant="ghost">
                    Вернуть в черновики
                  </Submit>
                </ActionForm>
              ) : null}
            </article>
          );
        })}
      </div>
    </>
  );
}
