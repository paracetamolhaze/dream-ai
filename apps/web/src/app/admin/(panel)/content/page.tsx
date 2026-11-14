import { getResultMedia, listAllStyles, listLibraryMusic, userMusicCount } from "@dream/core/services/admin-stats";
import { mediaDto } from "@dream/core/services/media";
import { getSettings } from "@dream/core/settings";
import { signMediaUrl } from "@dream/core/storage";
import { ActionForm, Submit } from "../../_components/action-form";
import { Badge, Card, EmptyRow, Field, Mono, PageHeader, TableWrap } from "../../_components/ui";
import { fmtDateTime, fmtSec } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { deleteTrackAction, saveExamplesAction, saveStyleAction, toggleStyleAction, toggleTrackAction, uploadTrackAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Стили и музыка" };

type Style = Awaited<ReturnType<typeof listAllStyles>>[number];

/** Only CSS gradients/hex colors pass validation on save; re-check before rendering inline. */
function safeSwatch(swatch: string): string {
  return /^(linear|radial|conic)-gradient\([^;{}<>]{3,300}\)$|^#[0-9a-f]{3,8}$/i.test(swatch) ? swatch : "#333";
}

function StyleFields({ s }: { s?: Style }) {
  return (
    <div className="adm-form-grid">
      <Field label="ID" hint={s ? "не меняется" : "a–z, 0–9, _"}>
        <input name="id" defaultValue={s?.id} readOnly={Boolean(s)} required pattern="[a-z0-9_]{2,32}" className="adm-input" />
      </Field>
      <Field label="Название (RU)">
        <input name="nameRu" defaultValue={s?.nameRu} required maxLength={60} className="adm-input" />
      </Field>
      <Field label="Название (EN)">
        <input name="nameEn" defaultValue={s?.nameEn} required maxLength={60} className="adm-input" />
      </Field>
      <Field label="Порядок">
        <input name="sortOrder" type="number" defaultValue={s?.sortOrder ?? 0} className="adm-input" />
      </Field>
      <Field label="Префикс промпта (EN)" wide hint="Добавляется в начало каждого промпта изображения">
        <textarea name="promptPrefix" defaultValue={s?.promptPrefix} required rows={2} maxLength={800} className="adm-textarea" />
      </Field>
      <Field label="Суффикс промпта (EN)" wide>
        <input name="promptSuffix" defaultValue={s?.promptSuffix} maxLength={400} className="adm-input" />
      </Field>
      <Field label="Negative prompt (EN)" wide hint="Используется только моделями, которые его поддерживают">
        <input name="negativePrompt" defaultValue={s?.negativePrompt} maxLength={500} className="adm-input" />
      </Field>
      <Field label="Цвет-образец (CSS)" wide hint="linear-gradient(…), radial-gradient(…), conic-gradient(…) или #hex">
        <input name="swatch" defaultValue={s?.swatch ?? "linear-gradient(135deg,#1b1840,#5b3fd1)"} required maxLength={320} className="adm-input adm-mono" />
      </Field>
      <label className="adm-check">
        <input type="checkbox" name="isActive" defaultChecked={s?.isActive ?? true} /> Доступен пользователям
      </label>
    </div>
  );
}

export default async function ContentPage() {
  await requireAdminPage("admin");
  const [styles, tracks, ownTracks, settings] = await Promise.all([listAllStyles(), listLibraryMusic(), userMusicCount(), getSettings({ fresh: true })]);
  const ex = settings.formatExamples;
  const exampleRows = await getResultMedia([ex.slideshowMediaId, ex.videoMediaId].filter((x): x is string => Boolean(x)));
  const example = (id: string | null) => {
    const row = id ? exampleRows.find((r) => r.id === id) : undefined;
    return row && row.status === "ready" ? mediaDto(row) : null;
  };
  const slideEx = example(ex.slideshowMediaId);
  const videoEx = example(ex.videoMediaId);

  return (
    <>
      <PageHeader title="Стили и музыка" subtitle="Визуальные стили генерации, библиотека разрешённой музыки и примеры на экране выбора формата" />

      <Card title="Визуальные стили" subtitle="Порядок и состав списка стилей в Mini App. Стиль «auto» выбирается по анализу сна.">
        <div className="adm-style-grid">
          {styles.map((s) => (
            <details key={s.id} className={`adm-details adm-style ${s.isActive ? "" : "is-muted"}`}>
              <summary>
                <span className="adm-swatch" style={{ background: safeSwatch(s.swatch) }} aria-hidden />
                <span className="adm-strong">{s.nameRu}</span>
                <span className="adm-muted">{s.nameEn}</span>
                <Mono>{s.id}</Mono>
                {s.isActive ? <Badge tone="good">активен</Badge> : <Badge>скрыт</Badge>}
              </summary>
              <div className="adm-details-body">
                <ActionForm action={saveStyleAction}>
                  <StyleFields s={s} />
                  <Submit size="sm">Сохранить</Submit>
                </ActionForm>
                <ActionForm action={toggleStyleAction} inline>
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="active" value={s.isActive ? "0" : "1"} />
                  <Submit size="sm" variant={s.isActive ? "danger" : "ghost"}>
                    {s.isActive ? "Скрыть" : "Включить"}
                  </Submit>
                </ActionForm>
              </div>
            </details>
          ))}
          <details className="adm-details">
            <summary>
              <span className="adm-strong">＋ Новый стиль</span>
            </summary>
            <div className="adm-details-body">
              <ActionForm action={saveStyleAction} resetOnSuccess>
                <StyleFields />
                <Submit size="sm">Создать стиль</Submit>
              </ActionForm>
            </div>
          </details>
        </div>
      </Card>

      <div className="adm-grid adm-grid-2">
        <Card title="Загрузить трек" subtitle="Только музыка, на которую у проекта есть права (собственная, CC0, лицензия). Сгенерированные эмбиент-треки воркер добавляет сам.">
          <ActionForm action={uploadTrackAction} resetOnSuccess>
            <div className="adm-form-grid">
              <Field label="Название">
                <input name="title" required maxLength={120} className="adm-input" />
              </Field>
              <Field label="Исполнитель">
                <input name="artist" maxLength={120} className="adm-input" />
              </Field>
              <Field label="Лицензия / источник" wide>
                <input name="license" required minLength={3} maxLength={300} className="adm-input" placeholder="CC0 — freesound.org/…, или «собственная запись»" />
              </Field>
              <Field label="Порядок">
                <input name="sortOrder" type="number" defaultValue={0} className="adm-input" />
              </Field>
              <Field label="Файл" hint="mp3, m4a, ogg, wav, flac · до 20 МБ">
                <input name="file" type="file" accept="audio/*" required className="adm-input" />
              </Field>
              <label className="adm-check">
                <input type="checkbox" name="confirmRights" required /> Подтверждаю право использовать трек в пользовательских видео
              </label>
            </div>
            <Submit>Загрузить</Submit>
          </ActionForm>
        </Card>

        <Card title="Примеры форматов" subtitle="Реальные готовые результаты для карточек «Слайд-шоу» и «AI-видео». Без примеров приложение показывает нейтральную иллюстрацию.">
          <ActionForm action={saveExamplesAction}>
            <div className="adm-form-grid">
              <Field label="Слайд-шоу (dream_media id)" wide>
                <input name="slideshowMediaId" defaultValue={ex.slideshowMediaId ?? ""} className="adm-input adm-mono" placeholder="uuid" />
              </Field>
              <Field label="AI-видео (dream_media id)" wide>
                <input name="videoMediaId" defaultValue={ex.videoMediaId ?? ""} className="adm-input adm-mono" placeholder="uuid" />
              </Field>
            </div>
            <Submit>Сохранить</Submit>
          </ActionForm>
          <div className="adm-row adm-examples">
            {[
              { label: "Слайд-шоу", m: slideEx },
              { label: "Видео", m: videoEx },
            ].map(({ label, m }) =>
              m ? (
                <figure key={label} className="adm-example">
                  <video src={m.url ?? undefined} poster={m.thumbUrl ?? undefined} controls preload="none" playsInline muted />
                  <figcaption>
                    {label} {m.isDemo ? <Badge tone="warn">DEMO</Badge> : null}
                  </figcaption>
                </figure>
              ) : null,
            )}
          </div>
        </Card>
      </div>

      <Card title="Библиотека музыки" subtitle={`Пользователи также загрузили собственных треков: ${ownTracks}`}>
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>Трек</th>
                <th>Лицензия</th>
                <th>Длительность</th>
                <th>Прослушать</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tracks.length === 0 ? <EmptyRow colSpan={6}>Треков пока нет</EmptyRow> : null}
              {tracks.map((t) => (
                <tr key={t.id} className={!t.isActive ? "is-muted" : undefined}>
                  <td>
                    <div className="adm-strong">{t.title}</div>
                    <div className="adm-faint">
                      {t.artist ?? "—"} · {fmtDateTime(t.createdAt)}
                    </div>
                  </td>
                  <td className="adm-muted">
                    {t.license} {t.isGenerated ? <Badge tone="info">сгенерирован</Badge> : null}
                  </td>
                  <td>{fmtSec(t.durationSec)}</td>
                  <td>
                    <audio controls preload="none" src={signMediaUrl(`music-${t.id}`)} className="adm-audio" />
                  </td>
                  <td>{t.isActive ? <Badge tone="good">доступен</Badge> : <Badge>скрыт</Badge>}</td>
                  <td>
                    <div className="adm-row">
                      <ActionForm action={toggleTrackAction} inline>
                        <input type="hidden" name="id" value={t.id} />
                        <input type="hidden" name="active" value={t.isActive ? "0" : "1"} />
                        <Submit size="sm" variant="ghost">
                          {t.isActive ? "Скрыть" : "Включить"}
                        </Submit>
                      </ActionForm>
                      <ActionForm action={deleteTrackAction} inline confirm="Удалить трек из библиотеки? Уже созданные ролики не изменятся.">
                        <input type="hidden" name="id" value={t.id} />
                        <Submit size="sm" variant="danger">
                          Удалить
                        </Submit>
                      </ActionForm>
                    </div>
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
