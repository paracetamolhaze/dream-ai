import { listAllProducts } from "@dream/core/services/admin-stats";
import { getActionPrices, PRICE_ACTIONS } from "@dream/core/services/pricing";
import { getSettings } from "@dream/core/settings";
import { ActionForm, Submit } from "../../_components/action-form";
import { Badge, Card, Field, Notice, PageHeader } from "../../_components/ui";
import { PRICE_ACTION, PRODUCT_KIND } from "../../_lib/dict";
import { requireAdminPage } from "@/server/admin/session";
import { saveLimitsAction, savePricesAction, saveProductAction, saveReferralAction, saveWatermarkAction, toggleProductAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Монетизация" };

type Product = Awaited<ReturnType<typeof listAllProducts>>[number];

function ProductFields({ p }: { p?: Product }) {
  return (
    <div className="adm-form-grid">
      <Field label="ID" hint={p ? "не меняется" : "латиница, цифры, _"}>
        <input name="id" className="adm-input" defaultValue={p?.id} readOnly={Boolean(p)} required pattern="[a-z0-9_]{2,40}" />
      </Field>
      <Field label="Тип">
        <select name="kind" className="adm-select" defaultValue={p?.kind ?? "credit_pack"}>
          {Object.entries(PRODUCT_KIND).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Цена, ⭐">
        <input name="starsPrice" type="number" min={1} max={100000} className="adm-input" defaultValue={p?.starsPrice ?? 100} required />
      </Field>
      <Field label="Кредиты">
        <input name="credits" type="number" min={1} className="adm-input" defaultValue={p?.credits ?? 50} required />
      </Field>
      <Field label="Название (RU)" hint="до 32 символов — так требует Telegram">
        <input name="titleRu" maxLength={32} className="adm-input" defaultValue={p?.titleRu} required />
      </Field>
      <Field label="Название (EN)">
        <input name="titleEn" maxLength={32} className="adm-input" defaultValue={p?.titleEn} required />
      </Field>
      <Field label="Описание (RU)" wide>
        <input name="descriptionRu" maxLength={255} className="adm-input" defaultValue={p?.descriptionRu} />
      </Field>
      <Field label="Описание (EN)" wide>
        <input name="descriptionEn" maxLength={255} className="adm-input" defaultValue={p?.descriptionEn} />
      </Field>
      <Field label="Бейдж">
        <select name="badge" className="adm-select" defaultValue={p?.badge ?? ""}>
          <option value="">—</option>
          <option value="popular">Популярный</option>
          <option value="best_value">Выгодно</option>
          <option value="new">Новинка</option>
        </select>
      </Field>
      <Field label="Порядок">
        <input name="sortOrder" type="number" className="adm-input" defaultValue={p?.sortOrder ?? 0} />
      </Field>
      <label className="adm-check">
        <input type="checkbox" name="removesWatermark" defaultChecked={p?.removesWatermark ?? true} /> Покупка убирает водяной знак
      </label>
      <label className="adm-check">
        <input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} /> Показывать в магазине
      </label>
    </div>
  );
}

export default async function MonetizationPage() {
  await requireAdminPage("admin");
  const [prices, products, settings] = await Promise.all([getActionPrices(), listAllProducts(), getSettings({ fresh: true })]);
  const l = settings.limits;
  const w = settings.watermark;
  const rf = settings.referral;
  const packs = products.filter((p) => p.isActive && p.credits > 0);
  const bestStarsPerCredit = packs.length ? Math.min(...packs.map((p) => p.starsPrice / p.credits)) : null;

  return (
    <>
      <PageHeader title="Монетизация" subtitle="Цены, товары Telegram Stars, бесплатные лимиты, водяной знак и реферальная программа. Ничего не захардкожено в интерфейсе." />

      <div className="adm-grid adm-grid-2">
        <Card title="Стоимость действий в кредитах" subtitle={bestStarsPerCredit ? `Самый выгодный пакет: ${bestStarsPerCredit.toFixed(2)} ⭐ за кредит` : undefined}>
          <ActionForm action={savePricesAction}>
            <div className="adm-form-grid">
              {PRICE_ACTIONS.map((a) => (
                <Field key={a} label={PRICE_ACTION[a] ?? a} hint={bestStarsPerCredit ? `≈ ${Math.round(prices[a] * bestStarsPerCredit)} ⭐` : undefined}>
                  <input name={a} type="number" min={0} max={100000} defaultValue={prices[a]} className="adm-input" required />
                </Field>
              ))}
            </div>
            <Submit>Сохранить цены</Submit>
          </ActionForm>
        </Card>

        <Card title="Бесплатное использование и лимиты" subtitle="Защита от бесконечного расхода платных API через бесплатные аккаунты">
          <ActionForm action={saveLimitsAction}>
            <div className="adm-form-grid">
              <Field label="Бесплатных слайд-шоу на пользователя">
                <input name="freeSlideshowsPerUser" type="number" min={0} max={100} defaultValue={l.freeSlideshowsPerUser} className="adm-input" />
              </Field>
              <Field label="Пробные кредиты при регистрации">
                <input name="signupBonusCredits" type="number" min={0} defaultValue={l.signupBonusCredits} className="adm-input" />
              </Field>
              <Field label="Бесплатных превью в день">
                <input name="freePreviewsPerDay" type="number" min={0} max={100} defaultValue={l.freePreviewsPerDay} className="adm-input" />
              </Field>
              <Field label="Снов в день на пользователя">
                <input name="maxDreamsPerDay" type="number" min={1} defaultValue={l.maxDreamsPerDay} className="adm-input" />
              </Field>
              <Field label="Анализов в день">
                <input name="maxAnalysesPerDay" type="number" min={1} defaultValue={l.maxAnalysesPerDay} className="adm-input" />
              </Field>
              <Field label="Генераций в день">
                <input name="maxGenerationsPerDay" type="number" min={1} defaultValue={l.maxGenerationsPerDay} className="adm-input" />
              </Field>
              <Field label="Дневной лимит расходов AI, $" hint="0 — без ограничения">
                <input name="dailySpendLimitUsd" type="number" min={0} step={0.5} defaultValue={l.dailySpendLimitUsd} className="adm-input" />
              </Field>
              <Field label="Лимит расходов на бесплатные генерации, $/день">
                <input name="freeDailySpendLimitUsd" type="number" min={0} step={0.5} defaultValue={l.freeDailySpendLimitUsd} className="adm-input" />
              </Field>
              <label className="adm-check">
                <input type="checkbox" name="freePreviewEnabled" defaultChecked={l.freePreviewEnabled} /> Бесплатное превью-кадр на экране выбора формата
              </label>
            </div>
            <Submit>Сохранить лимиты</Submit>
          </ActionForm>
        </Card>
      </div>

      <Card title="Товары Telegram Stars" subtitle="Пакеты кредитов и разовые покупки. Скрытые товары не продаются, но остаются в истории платежей.">
        <div className="adm-product-list">
          {products.map((p) => (
            <details key={p.id} className="adm-details">
              <summary>
                <span className="adm-strong">{p.titleRu}</span>
                <span className="adm-muted">
                  {p.starsPrice} ⭐ → {p.credits} кр. · {(p.starsPrice / p.credits).toFixed(2)} ⭐/кр.
                </span>
                <Badge tone="info">{PRODUCT_KIND[p.kind]}</Badge>
                {p.badge ? <Badge tone="accent">{p.badge}</Badge> : null}
                {p.isActive ? <Badge tone="good">в продаже</Badge> : <Badge>скрыт</Badge>}
              </summary>
              <div className="adm-details-body">
                <ActionForm action={saveProductAction}>
                  <ProductFields p={p} />
                  <Submit>Сохранить</Submit>
                </ActionForm>
                <ActionForm action={toggleProductAction} inline>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="active" value={p.isActive ? "0" : "1"} />
                  <Submit variant={p.isActive ? "danger" : "ghost"} size="sm">
                    {p.isActive ? "Скрыть из магазина" : "Вернуть в продажу"}
                  </Submit>
                </ActionForm>
              </div>
            </details>
          ))}
          <details className="adm-details">
            <summary>
              <span className="adm-strong">＋ Новый товар</span>
            </summary>
            <div className="adm-details-body">
              <ActionForm action={saveProductAction} resetOnSuccess>
                <ProductFields />
                <Submit>Создать товар</Submit>
              </ActionForm>
            </div>
          </details>
        </div>
      </Card>

      <div className="adm-grid adm-grid-2">
        <Card title="Водяной знак">
          <ActionForm action={saveWatermarkAction}>
            <div className="adm-form-grid">
              <Field label="Когда добавлять">
                <select name="mode" className="adm-select" defaultValue={w.mode}>
                  <option value="free_only">Только для пользователей без покупок</option>
                  <option value="always">Всегда</option>
                  <option value="never">Никогда</option>
                </select>
              </Field>
              <Field label="Текст" wide>
                <input name="text" maxLength={60} defaultValue={w.text} className="adm-input" required />
              </Field>
            </div>
            <Submit>Сохранить</Submit>
          </ActionForm>
        </Card>

        <Card title="Реферальная программа">
          {!rf.enabled ? <Notice tone="warn">Программа выключена — новые приглашения не засчитываются.</Notice> : null}
          <ActionForm action={saveReferralAction}>
            <div className="adm-form-grid">
              <Field label="Награда пригласившему, кр.">
                <input name="rewardInviter" type="number" min={0} defaultValue={rf.rewardInviter} className="adm-input" />
              </Field>
              <Field label="Награда приглашённому, кр.">
                <input name="rewardInvited" type="number" min={0} defaultValue={rf.rewardInvited} className="adm-input" />
              </Field>
              <Field label="Условие начисления">
                <select name="trigger" className="adm-select" defaultValue={rf.trigger}>
                  <option value="first_purchase">Первая покупка приглашённого</option>
                  <option value="first_dream">Первый сон приглашённого</option>
                </select>
              </Field>
              <Field label="Макс. наград на пригласившего в день">
                <input name="maxRewardsPerInviterPerDay" type="number" min={1} defaultValue={rf.maxRewardsPerInviterPerDay} className="adm-input" />
              </Field>
              <label className="adm-check">
                <input type="checkbox" name="enabled" defaultChecked={rf.enabled} /> Программа включена
              </label>
            </div>
            <Submit>Сохранить</Submit>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
