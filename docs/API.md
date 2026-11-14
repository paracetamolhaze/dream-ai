# DREAM AI — Mini App API

All endpoints are Next.js route handlers under `apps/web/src/app/api`. Request/response types live in
`packages/core/src/dto.ts` (type-only, importable from client code as `@dream/core/dto`).

**Auth:** every request (except `/api/media/*`, `/api/health`, `/api/auth/dev`) sends
`Authorization: tma <Telegram.WebApp.initData>`. In development (`ALLOW_DEV_AUTH=true`, never in
production) a browser outside Telegram gets a signed dev initData from `GET /api/auth/dev`.

**Errors:** `{ "error": { "code": ErrorCode, "message"?: string, "details"?: object } }` with an HTTP
status. Codes are listed in `packages/core/src/errors.ts`; the UI maps codes to localized texts.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/health` | – | `{ ok: true }` |
| GET | `/api/auth/dev?id=&name=` | – (dev only) | `{ initData }` |
| POST | `/api/session` | `{}` | `SessionDto` (upserts user, resolves deep-link `redirect`) |
| GET | `/api/profile` | – | `ProfileDto` |
| PATCH | `/api/profile` | `{ language?, notifications?: Partial<NotificationPrefsDto>, timezone? }` | `ProfileDto` |
| DELETE | `/api/profile` | – | `204` — schedules full account deletion |
| GET | `/api/profile/payments` | – | `PaymentDto[]` |
| GET | `/api/profile/transactions` | – | `CreditTxDto[]` |
| POST | `/api/profile/promo` | `{ code }` | `{ credits, balance }` |
| POST | `/api/profile/delete-audio` | `{}` | `{ deleted: number }` |
| GET | `/api/products` | – | `ProductDto[]` |
| POST | `/api/payments/invoice` | `{ productId, intent?: { dreamId, body: StartGenerationBody } }` | `InvoiceDto` → open with `Telegram.WebApp.openInvoice(invoiceUrl)` |
| GET | `/api/payments/:id` | – | `{ status, jobId: string \| null }` |
| GET | `/api/dreams?tab=all\|slideshow\|video&sort=new\|old&favorites=1&status=ready\|processing&q=&cursor=` | – | `LibraryPageDto` |
| POST | `/api/dreams/voice` | multipart: `audio` (Blob), `durationSec` | `{ dream: DreamDetailDto }` (status `transcribing`) |
| POST | `/api/dreams` | `{ text }` | `{ dream }` (status `analyzing` — typed text needs no review) |
| GET | `/api/dreams/:id` | – | `DreamDetailDto` (poll while `transcribing`/`analyzing` or jobs active) |
| PATCH | `/api/dreams/:id` | `{ title?, editedText?, isFavorite?, publicationConsent? }` | `DreamDetailDto` |
| DELETE | `/api/dreams/:id` | – | `204` |
| POST | `/api/dreams/:id/audio` | multipart re-record (`audio`, `durationSec`) | `{ dream }` |
| POST | `/api/dreams/:id/confirm` | `{ text? }` | `{ dream }` — starts story analysis (status `analyzing` → `ready`) |
| GET | `/api/dreams/:id/quote` | – | `QuoteDto` (prices, free allowance, styles, music, video durations) |
| POST | `/api/dreams/:id/generate` | `StartGenerationBody` | `{ job: JobDto }`; `402 insufficient_credits` → show purchase sheet |
| POST | `/api/dreams/:id/scenes/:sceneId/regenerate` | `{ kind: "image"\|"video", idempotencyKey }` | `{ job }` |
| GET | `/api/jobs/:id` | – | `JobDto` (poll every 2–3 s) |
| POST | `/api/jobs/:id/cancel` | `{}` | `JobDto` |
| GET | `/api/dreams/:id/share` | – | `ShareLinkDto[]` |
| POST | `/api/dreams/:id/share` | `{ mediaId, showTitle, showText }` | `ShareLinkDto` (explicit user action) |
| DELETE | `/api/share/:linkId` | – | `204` |
| POST | `/api/dreams/:id/send-to-chat` | `{ mediaId }` | `{ ok: true }` — bot sends the file into the user's chat |
| POST | `/api/dreams/:id/prepared-message` | `{ mediaId }` | `{ id }` → `Telegram.WebApp.shareMessage(id)` |
| POST | `/api/music` | multipart `audio`, `title` | `MusicTrackDto` (user's own track) |
| POST | `/api/bot/voice-fallback` | `{}` | `{ ok: true }` — bot asks the user for a voice message in chat |
| POST | `/api/events` | `{ events: { name, props? }[] }` | `204` |
| GET | `/api/media/:id?v=&exp=&sig=&dl=` | – (HMAC-signed URL) | file stream with Range support |

`/api/media/:id` ids: a `dream_media` uuid, `audio-<dreamId>` (original recording), `music-<trackId>`.
All media URLs inside DTOs are already signed and short-lived; never build them on the client.

Public page: `/s/<token>` (share link) — rendered server-side, shows only what the owner allowed.
