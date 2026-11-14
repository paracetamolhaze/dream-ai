# DREAM AI 🌙

Telegram Bot + Mini App, which turns a dream told by voice into a cinematic slideshow or an AI video.

> «Открыл → Рассказал сон → Выбрал формат → Получил красивый результат»

* **Mini App** (Next.js 16) — запись голоса с реальной аудиоволной, проверка текста, выбор формата и стиля,
  экран генерации с реальным прогрессом, библиотека «Мои сны» (Все | Слайд-шоу | Видео), просмотр,
  скачивание, шаринг, профиль, покупки за Telegram Stars, рефералы.
* **Telegram Bot** (grammY) — /start, голосовые и текстовые сны прямо в чате (та же библиотека),
  уведомления о готовности, оплата Stars, /paysupport, вход в админку.
* **Worker** (BullMQ + FFmpeg) — STT → анализ сюжета (Character/Location/Style Bible, Scene Graph) →
  изображения → видео-клипы → монтаж MP4. Резервирование/списание/возврат кредитов, восстановление после рестарта.
* **Admin** (`/admin`) — дашборд, пользователи, генерации, платежи и возвраты, модели, цены и лимиты,
  промокоды, кампании, публикации в канал, стили, музыка, поддержка, аудит.

Архитектура и модель данных: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Контракт API: [docs/API.md](docs/API.md).

---

## Быстрый старт (локально, demo-режим)

Нужны Docker, Node.js ≥ 22 и FFmpeg (для локального воркера).

```bash
cp .env.example .env            # затем отредактируйте (см. ниже минимальный локальный набор)
docker compose up -d postgres redis minio
npm install
npm run db:migrate              # миграции + стили/тарифы + bucket
npm run dev:web                 # http://localhost:3000
npm run dev:worker              # в отдельном терминале
npm run dev:bot                 # в отдельном терминале (нужен TELEGRAM_BOT_TOKEN, BOT_MODE=polling)
```

Минимальный `.env` для разработки:

```env
APP_ENV=development
PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=postgres://dream:dream@localhost:5432/dream
REDIS_URL=redis://localhost:6379
S3_ENDPOINT=http://localhost:9000
S3_ACCESS_KEY_ID=dreamminio
S3_SECRET_ACCESS_KEY=dreamminio-secret
ALLOW_DEV_AUTH=true      # открыть Mini App в обычном браузере (в production запрещено)
DEMO_MODE=true           # без AI-ключей — явно помеченный демо-режим
BOT_MODE=polling
```

**Demo-режим** — честный: распознавание речи возвращает подсказку «[ДЕМО-РЕЖИМ]…» (текст нужно ввести
самому), анализ — эвристическое разбиение, кадры — процедурные градиенты с надписью
«DEMO · NOT AI GENERATED», видео — движение камеры по этим кадрам с надписью «DEMO · NOT AI VIDEO».
В интерфейсе такие результаты отмечены бейджем DEMO. Никакие заранее подготовленные изображения не
выдаются за AI.

### Весь стек в Docker локально + сквозная проверка

```bash
# .env.docker.local: APP_ENV=staging, DEMO_MODE=true, ALLOW_DEV_AUTH=true,
# APP_DOMAIN=:80, HTTP_PORT=8088, PUBLIC_APP_URL=http://localhost:8088 (+ секреты)
docker compose --env-file .env.docker.local --profile app up -d --build
node scripts/e2e-smoke.mjs http://localhost:8088
```

`scripts/e2e-smoke.mjs` проходит весь путь пользователя через настоящий API: голосовое → распознавание →
проверка текста → разбор сюжета → слайд-шоу → скачивание MP4 (Range) → вкладка «Слайд-шоу» →
промокод → AI-видео → вкладка «Видео» → у одного сна два результата. Работает только там, где
включён `ALLOW_DEV_AUTH` (никогда не в production).

## Production: одна команда

```bash
cp .env.example .env     # заполните обязательные переменные
docker compose --profile app up -d --build
```

Поднимутся `caddy` (HTTPS), `web`, `bot`, `worker`, `postgres`, `redis` (AOF), `minio`, одноразовый
`migrate`. Данные — в именованных volume, у сервисов healthcheck и `restart: unless-stopped`.
Для внешних управляемых сервисов (RDS, ElastiCache, S3) укажите `DATABASE_URL`/`REDIS_URL`/`S3_*` —
встроенные контейнеры тогда можно не запускать.

> Образ `minio/minio` больше не публикуется в Docker Hub, поэтому по умолчанию используется сборка
> MinIO от Bitnami (`bitnamilegacy/minio`). Любой S3-совместимый сервер подходит: `MINIO_IMAGE=…`
> или внешний S3 через `S3_ENDPOINT`.

### Обязательные переменные production

| Переменная | Зачем |
|---|---|
| `APP_DOMAIN`, `PUBLIC_APP_URL` | домен и HTTPS-адрес Mini App (Caddy сам получит сертификат) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | бот |
| `TELEGRAM_WEBHOOK_SECRET` | секрет вебхука (проверяется ботом) |
| `ADMIN_TELEGRAM_IDS`, `ADMIN_SESSION_SECRET` | доступ к админке |
| `MEDIA_SIGNING_SECRET` | подпись приватных ссылок на медиа |
| `POSTGRES_PASSWORD`, `S3_SECRET_ACCESS_KEY` | пароли инфраструктуры |
| ключи AI (см. ниже) | реальная генерация (или `DEMO_MODE=true`) |

Полный список с комментариями — в [.env.example](.env.example).

---

## Настройка Telegram

1. **Создать бота.** В [@BotFather](https://t.me/BotFather): `/newbot` → имя и username. Токен → `TELEGRAM_BOT_TOKEN`,
   username без `@` → `TELEGRAM_BOT_USERNAME`.
2. **Main Mini App.** `/mybots` → бот → *Bot Settings* → *Configure Mini App* → *Enable Mini App* →
   укажите `https://<APP_DOMAIN>`. Теперь работают ссылки `https://t.me/<bot>?startapp=…`.
   (Можно также `/newapp` для именованного приложения — тогда задайте `TELEGRAM_MINIAPP_SHORT_NAME`.)
3. **URL приложения.** `PUBLIC_APP_URL=https://<APP_DOMAIN>` — Telegram открывает Mini App только по HTTPS.
   Бот при старте сам ставит кнопку меню, открывающую Mini App.
4. **Токен** — только в `.env` на сервере; во frontend он не попадает (initData проверяется на backend).
5. **Webhook.** `BOT_MODE=webhook`, `TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)`. Бот при старте
   вызывает `setWebhook(PUBLIC_APP_URL + /telegram/webhook)`, Caddy проксирует `/telegram/*` в контейнер
   `bot`, запросы с неверным `X-Telegram-Bot-Api-Secret-Token` отклоняются. Повторные доставки
   обновлений отбрасываются по `update_id`. Для локальной разработки — `BOT_MODE=polling`.
6. **AI API.** Выберите провайдеров и заполните ключи (см. таблицу ниже); модели переключаются в
   *Админка → Модели* без перезапуска.
7. **Telegram Stars.** Для цифровых товаров Stars не нужен платёжный провайдер: инвойсы создаются с
   валютой `XTR` (`createInvoiceLink`), бот отвечает на `pre_checkout_query` и начисляет кредиты только по
   `successful_payment` (идемпотентно по `telegram_payment_charge_id`). Команда `/paysupport` обязательна
   по правилам Telegram и уже реализована. Возвраты — из админки (`refundStarPayment`).
8. **Администратор.** Узнайте свой Telegram id (например, у @userinfobot), впишите в `ADMIN_TELEGRAM_IDS`.
   Вход: отправьте боту `/admin` — придёт одноразовая ссылка на 10 минут; или откройте Mini App →
   Профиль → «Админ-панель».
9. **Канал.** Создайте канал, добавьте бота администратором с правом публикации, укажите
   `TELEGRAM_CHANNEL_ID` (`@name` или `-100…`) и `TELEGRAM_CHANNEL_URL`. Посты готовятся в
   *Админка → Канал*, публикуются только после подтверждения; пользовательские сны — только с явного
   согласия владельца (переключатель на странице сна). Кнопка под постом ведёт в Mini App с меткой кампании.
10. **Запуск production.** `docker compose --profile app up -d --build`, затем `docker compose logs -f bot worker`.
    Проверка: `https://<APP_DOMAIN>/api/health`.

## AI-провайдеры

| Задача | Провайдер (адаптер) | Переменная | По умолчанию |
|---|---|---|---|
| Распознавание речи | OpenAI Whisper / gpt-4o-transcribe; любой OpenAI-совместимый, вкл. локальный faster-whisper-server | `OPENAI_API_KEY` или `STT_BASE_URL` | `whisper-1`, автоопределение языка |
| Анализ сна | Anthropic Claude (официальный SDK, структурированный вывод + server-side fallback при отказе); OpenAI-совместимый (json_schema) | `ANTHROPIC_API_KEY` / `LLM_OPENAI_*` | `claude-opus-5-5` |
| Изображения | fal.ai (FLUX schnell/dev, FLUX Kontext, Qwen-Image/Edit), Replicate (FLUX schnell/dev, Kontext), OpenAI-совместимый (`gpt-image-1`, LocalAI) | `FAL_KEY` / `REPLICATE_API_TOKEN` / `IMAGE_OPENAI_*` | `fal:flux-dev` + reference `fal:flux-kontext-pro` |
| Видео | fal.ai (Kling 2.1 Standard/Master, Hailuo-02 Standard), Runway Gen-4 Turbo; адаптер Replicate готов для моделей, добавленных в каталог | `FAL_KEY` / `RUNWAY_API_KEY` / `REPLICATE_API_TOKEN` | `fal:kling-2.1-standard` |

Возможности каждой модели (seed, negative prompt, reference image, допустимые длительности клипов, цена)
описаны в каталоге [`packages/core/src/ai/models.ts`](packages/core/src/ai/models.ts). Пользователю
предлагаются только длительности, которые реально собираются из поддерживаемых длин клипов. Перед
запуском с новым провайдером сверьте имена параметров модели с её страницей у провайдера — это одна
функция `buildInput` на модель.

**Консистентность персонажей:** LLM строит Character/Location/Style Bible; канонические `visualTag`
вставляются в каждый промпт кодом (не LLM), seed фиксирован на сон, при наличии reference-модели
генерируется портрет персонажа и используется как reference image в сценах с ним; видео делается
image-to-video от ключевого кадра сцены. Сцену можно перегенерировать отдельно.

## Монетизация

Цены действий (кредиты) и пакеты (Stars) — в *Админка → Монетизация*, ничего не захардкожено в UI.
Начальные значения (сиды): слайд-шоу 10 кр., видео ≤15 с — 40, ≤30 с — 90, ≤60 с — 180; пакеты
50/150/450 кр. за 99/249/649 ⭐ и разовые покупки. **Сверьте цены со своими расходами на AI** —
себестоимость минуты видео у провайдеров существенно выше, чем слайд-шоу. Бесплатный лимит, бонус при
регистрации, бесплатный превью-кадр, дневные лимиты, дневной бюджет расходов на AI (общий и для
бесплатных действий), промокоды и реферальные награды (по первому сну или первой покупке) — настраиваются.

## Как получить первую генерацию

1. Откройте бота → «Записать сон» (или `http://localhost:3000` в браузере при `ALLOW_DEV_AUTH=true`).
2. Нажмите микрофон, расскажите сон, остановите запись, проверьте текст → «Подтвердить».
3. Дождитесь разбора сюжета, выберите «Слайд-шоу», стиль → «Создать». Первое слайд-шоу бесплатно
   (настраивается). Можно закрыть приложение — бот пришлёт готовый ролик.
4. «Мои сны» → вкладка «Слайд-шоу» → сон → «Создать другой формат» → «Видео».

## Команды разработки

```bash
npm run typecheck     # tsc strict по всем пакетам
npm run lint          # ESLint (Next.js)
npm test              # Vitest: unit + интеграционные (нужны postgres/redis/minio из compose)
npm run build         # next build + bundle bot/worker
npm run db:generate   # новая миграция после изменения schema.ts
```

Интеграционные тесты используют отдельную БД `dream_test` и Redis DB 15.

## Безопасность и приватность

* initData проверяется HMAC-SHA256 по токену бота + срок `auth_date`; владелец проверяется на сервере для
  каждого сна/файла/задачи.
* Bucket приватный; медиа отдаются только по коротким HMAC-подписанным ссылкам через `/api/media/*`
  (Range-запросы для видео).
* Аудио проверяется по сигнатуре файла, ограничены размер и длительность; текст сна изолирован от
  инструкций в промпте LLM (prompt injection), вывод валидируется схемой.
* Rate limiting (Redis) на API, бот, промокоды, поддержку; дневные лимиты генераций и бюджет AI.
* Логи — JSON с редактированием токенов/ключей; аналитика first-party, без текста снов.
* Удаление аккаунта удаляет все файлы, сны, обращения в поддержку и записи (платежи остаются обезличенными для
  бухгалтерии и возвратов; неоплаченные счета гасятся). Остаётся только анти-абуз маркер: HMAC от Telegram id и
  число использованных бесплатных генераций — чтобы удаление и повторная регистрация не выдавали заново бесплатные
  генерации, бонус и реферальную награду. Политика хранения исходных аудио настраивается (по умолчанию 30 дней от
  последнего изменения), пользователь может удалить записи сам. Удалённый сон сразу скрыт, его файлы стираются
  через 10 минут (успевают отмениться идущие генерации, кредиты возвращаются сразу).
* Dev-вход в браузере (`ALLOW_DEV_AUTH`, запрещён в production) выдаёт только идентичности из зарезервированного
  диапазона id (≥ 900 000 000 000), подписанные отдельным секретом: ими нельзя войти под реальным пользователем или
  администратором.
* Вебхук бота без `TELEGRAM_WEBHOOK_SECRET` не стартует; обновления дедуплицируются по `update_id`, а платёжное
  обновление при сбое обрабатывается повторно (начисление идемпотентно).
* Ничего не публикуется без явного действия пользователя: ссылки «Поделиться» создаются вручную и
  отзываются, публикация в канале — только с согласия.

## Структура

```
packages/core     домен: env, БД (Drizzle), сервисы, AI-адаптеры, очереди, хранилище, Telegram, i18n
apps/web          Next.js: Mini App, API, админ-панель, публичные страницы /s/<token>
apps/bot          grammY-бот
apps/worker       BullMQ-воркер, FFmpeg-рендер, обслуживание
docker/Caddyfile  HTTPS reverse proxy
```

Брендинг: название — `APP_NAME` и `apps/web/src/lib/brand.ts`, цвета — CSS-токены в
`apps/web/src/app/globals.css`, тексты — `apps/web/src/i18n/*` и `packages/core/src/i18n.ts`.
