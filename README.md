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

### Mini App на Vercel (статический хостинг, без вычислений на Vercel)

Интерфейс Mini App можно отдавать с Vercel как обычные статические файлы, а всё остальное
(API, медиа, админка, публичные страницы `/s/…`, бот, воркер, БД) оставить на backend.

* На Vercel нет серверных функций, SSR и оптимизации изображений. Сборка выполняется локально, Vercel
  только раздаёт ~2,5 МБ статики с CDN (кэш `_next/static` — год, immutable).
* Браузер обращается к API **напрямую** (CORS разрешён только для `PUBLIC_APP_URL` и `CORS_ORIGINS`).
  Видео и изображения тоже грузятся с backend — ни запросы к API, ни медиа-трафик через Vercel не идут.
* Маршруты Mini App статические: id сна передаётся в query (`/dream?id=…`), поэтому каждая страница —
  один HTML-файл.

```bash
# backend (.env): PUBLIC_APP_URL=https://<проект>.vercel.app  PUBLIC_API_URL=https://<backend>
VERCEL_TOKEN=… node scripts/deploy-miniapp-vercel.mjs --api https://<backend> --bot <bot_username> --project sonnik-miniapp
```

Скрипт копирует интерфейс в `.miniapp-build/` (без API, админки и серверного кода), собирает
`STATIC_EXPORT=1 next build` и загружает результат в проект Vercel. При смене адреса backend просто
запустите его снова — деплой статики занимает секунды.

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

**Сервер дома (DuckDNS и т. п.).** Сервис DuckDNS в compose (`--profile duckdns`, `DUCKDNS_DOMAINS`,
`DUCKDNS_TOKEN`) раз в 5 минут обновляет IP домена. Многие домашние роутеры не поддерживают NAT
loopback: из той же сети домен не открывается, хотя из интернета всё работает. При этом Mini App
показывает «Нет связи с сервером». На компьютере с сервером добавьте в `hosts`
(`C:\Windows\System32\drivers\etc\hosts` или `/etc/hosts`) строку `127.0.0.1 <ваш-домен>`.
Телефон в домашнем Wi-Fi проверяйте через мобильный интернет либо включите NAT loopback в роутере.

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

По умолчанию всё идёт через **OpenRouter** — один ключ `OPENROUTER_API_KEY` на распознавание речи,
анализ, изображения и видео. Остальные адаптеры остаются в каталоге как альтернативы.

| Задача | Провайдер (адаптер) | Переменная | По умолчанию |
|---|---|---|---|
| Распознавание речи | OpenRouter `/audio/transcriptions` (gpt-transcribe, Scribe v2, Whisper large-v3); OpenAI, Groq и любой OpenAI-совместимый, вкл. локальный faster-whisper-server | `OPENROUTER_API_KEY` / `OPENAI_API_KEY` или `STT_API_KEY` + `STT_BASE_URL` | `openai/gpt-transcribe`, автоопределение языка |
| Анализ сна | OpenRouter (структурированный вывод json_schema); Anthropic Claude напрямую (официальный SDK); OpenAI-совместимый | `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` / `LLM_OPENAI_*` | `anthropic/claude-haiku-5.5` |
| Изображения | OpenRouter Image API (Seedream 5.5, FLUX.3 klein, Nano Banana 2.1); fal.ai (Muse, FLUX, Kontext, Qwen), Replicate, OpenAI-совместимый | `OPENROUTER_API_KEY` / `FAL_KEY` / … | `or:seedream-5.5` + reference `or:seedream-5.5-edit`, запасная FLUX.3 klein |
| Видео | OpenRouter Video API (HeyGen Video, Veo 3.1 Lite, Hailuo 3 Max, Kling 3.0); fal.ai, Runway | `OPENROUTER_API_KEY` / `FAL_KEY` / `RUNWAY_API_KEY` | `or:heygen-video` (768p, 9:16) |

**Себестоимость сна через OpenRouter** (цены на ноябрь 2026 + 5.5% комиссии OpenRouter при пополнении;
8 сцен, голос 2 мин, бесплатный кадр-превью включён):

| | Слайд-шоу | Видео 10 с | Видео 30 с | Видео 60 с |
|---|---|---|---|---|
| По умолчанию (Seedream 5.5 + HeyGen 768p) | ≈ $0.27 | ≈ $0.49 | ≈ $1.36 | ≈ $2.55 |
| Бюджетно (FLUX.3 klein + Veo 3.1 Lite) | ≈ $0.12 | ≈ $0.37 | ≈ $1.05 | ≈ $2.02 |
| Премиум (Nano Banana 2.1 + Hailuo 3 Max) | ≈ $0.43 | ≈ $1.02 | ≈ $2.88 | ≈ $5.49 |

Кадр стоит $0.02 (Seedream 5.5; с референсом персонажа $0.028), секунда видео — $0.036 (HeyGen 768p),
анализ сна на Claude Haiku 5.5 — ≈ $0.003, распознавание 2 минут голоса — ≈ $0.009. Если модель
изображений отказала или так и не ответила, этот кадр рисует запасная модель (`fallbackId` в каталоге).
OpenRouter возвращает фактическую стоимость каждого вызова — она пишется в учёт расходов админки.
Модели переключаются в *Админка → Модели*.

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
