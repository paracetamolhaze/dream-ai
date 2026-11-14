# DREAM AI — технический план

## Архитектура

```
                ┌──────────────┐   HTTPS    ┌──────────────────────────┐
 Telegram ────▶ │    Caddy     │ ─────────▶ │ web (Next.js 16)         │
 (Mini App,     │ reverse proxy│            │  • Mini App (/)          │
  webhook)      └──────┬───────┘            │  • Admin (/admin)        │
                       │ /telegram/*        │  • REST API (/api/*)     │
                       ▼                    └──────────┬───────────────┘
               ┌──────────────┐                        │
               │ bot (grammY) │                        │  enqueue
               └──────┬───────┘                        ▼
                      │ enqueue           ┌────────────────────────────┐
                      └─────────────────▶ │ Redis 7 + BullMQ queues    │
                                          └──────────┬─────────────────┘
                                                     ▼
                                          ┌────────────────────────────┐
                                          │ worker                     │
                                          │  STT → LLM → Image → Video │
                                          │  FFmpeg render, notify bot │
                                          └──────────┬─────────────────┘
                          ┌──────────────────────────┴──────────┐
                          ▼                                     ▼
                 PostgreSQL 17 (Drizzle)              MinIO / S3 (private bucket)
```

Шесть контейнеров (`compose.yaml`): `caddy`, `web`, `bot`, `worker`, `postgres`, `redis`, `minio`
(+ одноразовые `migrate` и `minio-init`). Никаких микросервисов сверх этого.

## Структура директорий

```
packages/core     общий домен: env, БД (схема + миграции), сервисы, AI-провайдеры,
                  очереди, хранилище, Telegram (initData, Bot API), i18n серверных сообщений
apps/web          Next.js: Mini App, админ-панель, API route handlers, публичные share-страницы
apps/bot          grammY-бот: команды, голосовые/текстовые сны, платежи Stars, поддержка
apps/worker       BullMQ-воркер: транскрибация, анализ, генерация, FFmpeg, обслуживание
docker/           Caddyfile и вспомогательные скрипты
```

## Модель данных (основное)

* `users`, `user_settings` — Telegram-пользователь, баланс (`credits_balance` ≥ 0, `credits_reserved`)
* `dreams` — один сон = одна запись; `bible` (Character/Location/Style Bible) в jsonb
* `dream_scenes` — Scene Graph, версионируется `analysis_version`
* `dream_media` — все результаты: `image`, `reference`, `video_clip`, `slideshow`, `video`
  (у одного сна сколько угодно версий обоих форматов — без дублирования сна)
* `generation_jobs` — фоновые задачи; частичный уникальный индекс запрещает две активные
  задачи одного типа для одного сна; `idempotency_key` уникален на пользователя
* `credit_transactions` — журнал (сумма = баланс); уникальные индексы исключают двойное
  резервирование/возврат/начисление
* `payments` — Stars-платежи; `telegram_payment_charge_id` уникален
* `referrals`, `campaigns`, `promo_codes`, `promo_redemptions`, `pricing_plans`, `action_prices`,
  `app_settings`, `visual_styles`, `music_tracks`, `share_links`, `channel_posts`,
  `support_tickets`, `analytics_events`, `ai_usage`, `admin_users`, `admin_audit_logs`

## Библиотеки

Next.js 16 (App Router, standalone), React 19, Tailwind CSS 4, компоненты в стиле shadcn/ui
(Radix + cva), Motion, TanStack Query; Drizzle ORM + `pg`; BullMQ 5 + ioredis; grammY; zod 4;
AWS SDK v3 (S3/MinIO); jose (сессии админки); `@anthropic-ai/sdk`; FFmpeg (системный бинарник);
Vitest. Официальный `telegram-web-app.js` как Mini Apps SDK.

## AI pipeline

1. **STT** (`SttProvider`): OpenAI-совместимый `/v1/audio/transcriptions` (OpenAI Whisper,
   Groq, локальный faster-whisper-server) или demo. Аудио нормализуется FFmpeg → mp3 16 кГц.
2. **LLM** (`LlmProvider`): анализ сна в строгий JSON (zod-схема): название, атмосфера,
   Character/Location/Style Bible, сцены. Адаптеры: Anthropic (Claude), OpenAI-совместимый
   (json_schema), demo (эвристический разбор, явно помечен).
3. **Prompt composer**: финальные промпты собираются кодом детерминированно — визуальные
   теги персонажей и локаций вставляются в каждую сцену дословно; seed фиксирован на сон.
4. **Image** (`ImageProvider`): fal.ai (FLUX, FLUX Kontext, Qwen-Image), Replicate,
   OpenAI-совместимый `/v1/images/generations`, demo (FFmpeg-градиенты с надписью DEMO).
   Возможности модели (seed, negative prompt, reference image) описаны в каталоге моделей —
   reference-изображения используются только там, где API их принимает.
5. **Video** (`VideoProvider`): fal.ai (Kling, Hailuo, Wan…), Replicate, Runway, demo.
   Image-to-video от ключевого кадра сцены → консистентность наследуется от кадров.
   Длительности строятся только из тех длин клипов, которые модель реально поддерживает.
6. **FFmpeg**: Ken Burns, xfade, музыка, водяной знак, нормализация, MP4 + превью.

Все шаги идемпотентны и кэшируются: готовые кадры/клипы переиспользуются, внешние
id видео-задач сохраняются (после рестарта воркер продолжает опрос, а не платит заново).

## Порядок реализации

1. Каркас, env, схема БД, миграции, сервисы кредитов/платежей/снов
2. AI-провайдеры, очереди, воркер, FFmpeg
3. API + Mini App (главный экран, запись, ревью, подготовка, генерация, библиотека, сон, профиль)
4. Бот (команды, голос, Stars, уведомления, поддержка)
5. Админ-панель, аналитика, канал, промокоды, кампании
6. Docker Compose, Caddy, README, тесты
