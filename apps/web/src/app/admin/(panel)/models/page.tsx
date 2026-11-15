import { IMAGE_MODELS, LLM_MODELS, STT_MODELS, VIDEO_MODELS } from "@dream/core/ai/models";
import { credentialStatus, isDemoSelection } from "@dream/core/ai/registry";
import { env } from "@dream/core/env";
import { getSettings } from "@dream/core/settings";
import { ActionForm, Submit } from "../../_components/action-form";
import { Badge, Card, Field, Mono, Notice, PageHeader, TableWrap } from "../../_components/ui";
import { fmtUsd } from "../../_lib/format";
import { requireAdminPage } from "@/server/admin/session";
import { saveConcurrencyAction, saveGenerationAction, saveModelsAction, saveRetentionAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Модели и лимиты" };

const yes = (v: boolean) => (v ? <Badge tone="good">да</Badge> : <span className="adm-faint">нет</span>);

export default async function ModelsPage() {
  await requireAdminPage("admin");
  const settings = await getSettings({ fresh: true });
  const m = settings.models;
  const demo = isDemoSelection(settings);
  const creds = credentialStatus();
  const sttValue = STT_MODELS.find((s) => s.provider === m.stt.provider && s.model === m.stt.model)?.id ?? `${m.stt.provider}:${m.stt.model}`;
  const sttIsCustom = !STT_MODELS.some((s) => s.id === sttValue);
  const c = settings.concurrency;
  const g = settings.generation;
  const r = settings.retention;
  const anyDemo = demo.stt || demo.llm || demo.image || demo.video;

  return (
    <>
      <PageHeader title="Модели и лимиты" subtitle="Провайдеры AI, ёмкость обработки и параметры рендера. Ключи API задаются только переменными окружения на сервере." />

      {anyDemo ? (
        <Notice tone="warn">
          Сейчас в демо-режиме работают: {[demo.stt && "распознавание", demo.llm && "анализ сюжета", demo.image && "изображения", demo.video && "видео"].filter(Boolean).join(", ")}.
          {env().DEMO_MODE ? " DEMO_MODE включён — провайдеры без ключей заменяются помеченными демо-провайдерами." : " Укажите ключи API или выберите другого провайдера."}
        </Notice>
      ) : null}

      <div className="adm-grid adm-grid-2">
        <Card title="Выбор моделей">
          <ActionForm action={saveModelsAction}>
            <div className="adm-form-grid">
              <Field label="Распознавание речи (STT)" hint={demo.stt ? "будет использован демо-провайдер" : undefined}>
                <select name="stt" className="adm-select" defaultValue={sttIsCustom ? "openai:custom" : sttValue}>
                  {STT_MODELS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label} · {fmtUsd(s.costPerMinuteUsd, 3)}/мин
                    </option>
                  ))}
                  <option value="openai:custom">OpenAI-совместимый (своя модель)</option>
                </select>
              </Field>
              <Field label="Своя STT-модель" hint="Только для варианта «своя модель», например Systran/faster-whisper-large-v3 на локальном сервере (STT_BASE_URL)">
                <input name="sttCustomModel" className="adm-input" defaultValue={sttIsCustom ? m.stt.model : ""} placeholder="имя модели" />
              </Field>
              <Field label="Язык распознавания">
                <select name="sttLanguage" className="adm-select" defaultValue={m.stt.language}>
                  <option value="auto">Автоопределение</option>
                  <option value="ru">Русский</option>
                  <option value="en">English</option>
                </select>
              </Field>
              <Field label="LLM-провайдер (анализ сна)" hint={demo.llm ? "будет использован демо-провайдер" : undefined}>
                <select name="llmProvider" className="adm-select" defaultValue={m.llm.provider}>
                  <option value="openrouter">OpenRouter (один ключ на всё)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI-совместимый</option>
                  <option value="demo">Демо (эвристика, без AI)</option>
                </select>
              </Field>
              <Field label="LLM-модель">
                <input name="llmModel" className="adm-input" list="llm-models" defaultValue={m.llm.model} required />
                <datalist id="llm-models">
                  {LLM_MODELS.map((l) => (
                    <option key={`${l.provider}-${l.model}`} value={l.model}>
                      {l.label}
                    </option>
                  ))}
                </datalist>
              </Field>
              <Field label="Модель изображений" hint={demo.image ? "будет использован демо-провайдер" : undefined}>
                <select name="imageModel" className="adm-select" defaultValue={m.image.model}>
                  {IMAGE_MODELS.filter((i) => !i.requiresReferenceImage || i.id === m.image.model).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Модель для референсов персонажей" hint="Используется для сцен с повторяющимися персонажами. Только модели, принимающие reference image.">
                <select name="referenceModel" className="adm-select" defaultValue={m.image.referenceModel ?? ""}>
                  <option value="">Не использовать (только текст + seed)</option>
                  {IMAGE_MODELS.filter((i) => i.supportsReferenceImage).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Видео-модель" hint={demo.video ? "будет использован демо-провайдер" : undefined}>
                <select name="videoModel" className="adm-select" defaultValue={m.video.model}>
                  {VIDEO_MODELS.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} · клипы {v.clipDurations.join("/")} с
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Submit>Сохранить модели</Submit>
          </ActionForm>
        </Card>

        <Card title="Ключи и подключения" subtitle="Значения не показываются полностью и меняются только в .env на сервере">
          <TableWrap>
            <table className="adm-table">
              <thead>
                <tr>
                  <th>Переменная</th>
                  <th>Назначение</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {creds.map((cr) => (
                  <tr key={cr.name}>
                    <td className="adm-mono">{cr.name}</td>
                    <td className="adm-muted">{cr.usedFor}</td>
                    <td>{cr.masked ? <Badge tone="good">{cr.masked}</Badge> : <Badge>не задан</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>
      </div>

      <Card title="Каталог моделей изображений" subtitle="Возможности описаны в packages/core/src/ai/models.ts — только то, что документирует API провайдера">
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Модель</th>
                <th>Seed</th>
                <th>Negative prompt</th>
                <th>Reference image</th>
                <th className="num">≈ $/кадр</th>
              </tr>
            </thead>
            <tbody>
              {IMAGE_MODELS.map((i) => (
                <tr key={i.id} className={i.id === m.image.model || i.id === m.image.referenceModel ? "is-selected" : undefined}>
                  <td className="adm-mono">{i.id}</td>
                  <td>
                    {i.label} <span className="adm-faint adm-mono">{i.model}</span>
                  </td>
                  <td>{yes(i.supportsSeed)}</td>
                  <td>{yes(i.supportsNegativePrompt)}</td>
                  <td>{i.requiresReferenceImage ? <Badge tone="accent">обязателен</Badge> : yes(i.supportsReferenceImage)}</td>
                  <td className="num">{fmtUsd(i.costPerImageUsd, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card title="Каталог видео-моделей" subtitle="Длительность итогового видео собирается только из поддерживаемых длин клипов">
        <TableWrap>
          <table className="adm-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Модель</th>
                <th>Длины клипов</th>
                <th>Negative prompt</th>
                <th>Seed</th>
                <th>Отмена</th>
                <th className="num">≈ $/сек</th>
              </tr>
            </thead>
            <tbody>
              {VIDEO_MODELS.map((v) => (
                <tr key={v.id} className={v.id === m.video.model ? "is-selected" : undefined}>
                  <td className="adm-mono">{v.id}</td>
                  <td>
                    {v.label} <span className="adm-faint adm-mono">{v.model}</span>
                  </td>
                  <td>{v.clipDurations.map((d) => `${d} с`).join(", ")}</td>
                  <td>{yes(v.supportsNegativePrompt)}</td>
                  <td>{yes(v.supportsSeed)}</td>
                  <td>{yes(v.supportsCancel)}</td>
                  <td className="num">{fmtUsd(v.costPerSecondUsd, 3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <div className="adm-grid adm-grid-2">
        <Card title="Параллельная обработка" subtitle="Одновременных задач на воркер; применяется без перезапуска">
          <ActionForm action={saveConcurrencyAction}>
            <div className="adm-form-grid">
              <Field label="Распознавание">
                <input name="transcription" type="number" min={1} max={20} defaultValue={c.transcription} className="adm-input" />
              </Field>
              <Field label="Анализ сюжета">
                <input name="analysis" type="number" min={1} max={20} defaultValue={c.analysis} className="adm-input" />
              </Field>
              <Field label="Слайд-шоу">
                <input name="slideshow" type="number" min={1} max={20} defaultValue={c.slideshow} className="adm-input" />
              </Field>
              <Field label="Видео">
                <input name="video" type="number" min={1} max={10} defaultValue={c.video} className="adm-input" />
              </Field>
              <Field label="Кадров параллельно в задаче">
                <input name="imagesPerJob" type="number" min={1} max={8} defaultValue={c.imagesPerJob} className="adm-input" />
              </Field>
              <Field label="Клипов параллельно в задаче">
                <input name="clipsPerJob" type="number" min={1} max={6} defaultValue={c.clipsPerJob} className="adm-input" />
              </Field>
            </div>
            <Submit>Сохранить</Submit>
          </ActionForm>
        </Card>

        <Card title="Хранение данных">
          <ActionForm action={saveRetentionAction}>
            <div className="adm-form-grid">
              <Field label="Хранить исходные аудио, дней" hint="0 — удалять сразу после распознавания, −1 — хранить всегда">
                <input name="audioRetentionDays" type="number" min={-1} max={3650} defaultValue={r.audioRetentionDays} className="adm-input" />
              </Field>
              <Field label="Очистка удалённых снов, дней">
                <input name="deletedPurgeDays" type="number" min={0} max={365} defaultValue={r.deletedPurgeDays} className="adm-input" />
              </Field>
            </div>
            <Submit>Сохранить</Submit>
          </ActionForm>
        </Card>
      </div>

      <Card title="Параметры генерации и рендера">
        <ActionForm action={saveGenerationAction}>
          <div className="adm-form-grid">
            <Field label="Мин. сцен в слайд-шоу">
              <input name="slideshowMinScenes" type="number" min={1} max={20} defaultValue={g.slideshowMinScenes} className="adm-input" />
            </Field>
            <Field label="Макс. сцен в слайд-шоу">
              <input name="slideshowMaxScenes" type="number" min={1} max={24} defaultValue={g.slideshowMaxScenes} className="adm-input" />
            </Field>
            <Field label="Секунд на кадр">
              <input name="slideshowSecondsPerScene" type="number" min={2} max={10} step={0.5} defaultValue={g.slideshowSecondsPerScene} className="adm-input" />
            </Field>
            <Field label="Варианты длительности видео, с" hint="Через запятую; показываются только достижимые для модели">
              <input name="videoDurations" defaultValue={g.videoDurations.join(", ")} className="adm-input" />
            </Field>
            <Field label="Макс. длительность видео, с">
              <input name="maxVideoDurationSec" type="number" min={5} max={180} defaultValue={g.maxVideoDurationSec} className="adm-input" />
            </Field>
            <Field label="Ширина кадра">
              <input name="outputWidth" type="number" min={360} max={2160} step={2} defaultValue={g.outputWidth} className="adm-input" />
            </Field>
            <Field label="Высота кадра">
              <input name="outputHeight" type="number" min={640} max={3840} step={2} defaultValue={g.outputHeight} className="adm-input" />
            </Field>
            <Field label="FPS">
              <input name="fps" type="number" min={24} max={60} defaultValue={g.fps} className="adm-input" />
            </Field>
            <Field label="Таймаут задачи, мин">
              <input name="jobTimeoutMinutes" type="number" min={5} max={240} defaultValue={g.jobTimeoutMinutes} className="adm-input" />
            </Field>
            <Field label="Попыток на задачу">
              <input name="maxAttempts" type="number" min={1} max={6} defaultValue={g.maxAttempts} className="adm-input" />
            </Field>
          </div>
          <p className="adm-muted adm-small">
            Текущее разрешение: <Mono>{`${g.outputWidth}×${g.outputHeight}@${g.fps}`}</Mono>
          </p>
          <Submit>Сохранить</Submit>
        </ActionForm>
      </Card>
    </>
  );
}
