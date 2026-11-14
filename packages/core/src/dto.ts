/**
 * API data contracts shared by the Next.js route handlers and the Mini App.
 * This file must stay type-only (no runtime imports) so client components can
 * import it safely.
 */

export type Locale = "ru" | "en";
export type OutputFormat = "slideshow" | "video";
export type DreamStatus = "draft" | "transcribing" | "transcription_failed" | "review" | "analyzing" | "analysis_failed" | "ready";
export type JobStatus = "queued" | "analyzing" | "preparing_scenes" | "generating_images" | "generating_video" | "rendering" | "completed" | "failed" | "cancelled";
export type MediaStatus = "pending" | "processing" | "ready" | "failed" | "deleted";

/** Library card status (derived). */
export type CardStatus = "draft" | "processing" | "awaiting" | "ready" | "failed";

export interface ApiError {
  error: { code: string; message?: string; details?: Record<string, unknown> };
}

export interface MediaDto {
  id: string;
  type: "image" | "reference" | "video_clip" | "slideshow" | "video";
  status: MediaStatus;
  /** File extension: jpg | png | webp | mp4 */
  format: string;
  url: string | null;
  thumbUrl: string | null;
  downloadUrl: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  sceneId: string | null;
  isDemo: boolean;
  hasWatermark: boolean;
  version: number;
  createdAt: string;
}

export interface SceneDto {
  id: string;
  sequenceNumber: number;
  title: string | null;
  description: string;
  cameraAngle: string | null;
  motion: string | null;
  mood: string | null;
  characters: string[];
  location: string | null;
  durationSec: number;
  status: "pending" | "generating" | "ready" | "failed";
  image: MediaDto | null;
  clip: MediaDto | null;
}

export interface CharacterDto {
  key: string;
  name: string;
  role: string;
  visualTag: string;
}

export interface LocationDto {
  key: string;
  name: string;
  description: string;
}

export interface JobDto {
  id: string;
  dreamId: string;
  mediaType: OutputFormat;
  kind: "full" | "scene_image" | "scene_video" | "rerender";
  status: JobStatus;
  progress: number;
  stage: string | null;
  stageDone: number | null;
  stageTotal: number | null;
  previews: MediaDto[];
  errorCode: string | null;
  creditsCost: number;
  creditState: "none" | "reserved" | "captured" | "released";
  usedFreeAllowance: boolean;
  isDemo: boolean;
  resultMediaId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface DreamCardDto {
  id: string;
  title: string | null;
  createdAt: string;
  status: CardStatus;
  dreamStatus: DreamStatus;
  cover: { url: string | null; thumbUrl: string | null } | null;
  formats: { slideshow: boolean; video: boolean };
  primaryFormat: OutputFormat | null;
  durationSec: number | null;
  isFavorite: boolean;
  activeJob: { id: string; mediaType: OutputFormat; progress: number; status: JobStatus } | null;
  excerpt: string;
}

export interface LibraryStatsDto {
  total: number;
  slideshows: number;
  videos: number;
}

export interface LibraryPageDto {
  items: DreamCardDto[];
  nextCursor: string | null;
  stats: LibraryStatsDto;
}

export interface DreamDetailDto {
  id: string;
  title: string | null;
  summary: string | null;
  status: DreamStatus;
  source: "miniapp_voice" | "miniapp_text" | "bot_voice" | "bot_text";
  originalText: string | null;
  editedText: string | null;
  language: string | null;
  atmosphere: string | null;
  visualStyle: string | null;
  createdAt: string;
  updatedAt: string;
  isFavorite: boolean;
  hasAudio: boolean;
  audioUrl: string | null;
  audioDurationSec: number | null;
  transcriptionIsDemo: boolean;
  analysisIsDemo: boolean;
  publicationConsent: boolean;
  errorCode: string | null;
  characters: CharacterDto[];
  locations: LocationDto[];
  scenes: SceneDto[];
  slideshows: MediaDto[];
  videos: MediaDto[];
  activeJobs: JobDto[];
  lastFailedJob: JobDto | null;
  cover: MediaDto | null;
  preview: MediaDto | null;
}

export interface StyleDto {
  id: string;
  name: string;
  swatch: string;
}

export interface MusicTrackDto {
  id: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
  isOwn: boolean;
  isGenerated: boolean;
  previewUrl: string | null;
}

export interface VideoDurationOptionDto {
  targetSec: number;
  actualSec: number;
  clips: number;
  action: string;
  credits: number;
}

export interface QuoteDto {
  balance: number;
  reserved: number;
  freeSlideshowsLeft: number;
  slideshow: { credits: number; free: boolean; sceneCount: number; estimatedSec: number; action: string };
  video: { options: VideoDurationOptionDto[]; clipDurations: number[]; modelLabel: string } ;
  sceneImageCredits: number;
  sceneVideoCredits: number;
  styles: StyleDto[];
  music: MusicTrackDto[];
  watermark: { applies: boolean; removableByPurchase: boolean };
  demo: { stt: boolean; llm: boolean; image: boolean; video: boolean };
  examples: { slideshow: MediaDto | null; video: MediaDto | null };
}

export interface ProductDto {
  id: string;
  kind: "credit_pack" | "single_slideshow" | "single_video_short" | "single_video_long";
  title: string;
  description: string;
  stars: number;
  credits: number;
  badge: string | null;
}

export interface PaymentDto {
  id: string;
  productTitle: string | null;
  stars: number;
  credits: number;
  status: "pending" | "paid" | "refunded" | "failed" | "expired";
  createdAt: string;
  paidAt: string | null;
}

export interface CreditTxDto {
  id: string;
  amount: number;
  type: string;
  createdAt: string;
  note: string | null;
}

export interface NotificationPrefsDto {
  generationReady: boolean;
  reminders: boolean;
  reminderTime: string;
  product: boolean;
}

export interface ProfileDto {
  id: string;
  telegramId: number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  language: Locale;
  createdAt: string;
  dreamsCount: number;
  balance: number;
  reserved: number;
  freeSlideshowsLeft: number;
  hasPaid: boolean;
  isAdmin: boolean;
  botChatAvailable: boolean;
  notifications: NotificationPrefsDto;
  timezone: string | null;
  referral: { code: string; link: string; miniAppLink: string; invited: number; paying: number; earned: number; rewardInviter: number; rewardInvited: number; trigger: string; enabled: boolean };
  audioRetentionDays: number;
  appName: string;
  botUsername: string | null;
  channelUrl: string | null;
}

export interface SessionDto {
  user: ProfileDto;
  /** Start parameter resolved into a route (deep links from bot/channel). */
  redirect: string | null;
  demoMode: boolean;
}

export interface ShareLinkDto {
  id: string;
  mediaId: string;
  token: string;
  url: string;
  showTitle: boolean;
  showText: boolean;
  views: number;
  createdAt: string;
}

export interface InvoiceDto {
  paymentId: string;
  invoiceUrl: string;
}

export interface UploadVoiceResponse {
  dream: DreamDetailDto;
}

export interface StartGenerationResponse {
  job: JobDto;
}

export type StartGenerationBody = {
  format: OutputFormat;
  styleId: string;
  targetDurationSec?: number;
  musicTrackId?: string | null;
  idempotencyKey: string;
};
