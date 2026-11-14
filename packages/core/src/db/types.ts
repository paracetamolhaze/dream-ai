/** JSON column types shared by the schema and services. */

export interface CharacterBibleEntry {
  key: string;
  name: string;
  role: string;
  appearance: string;
  hair?: string;
  clothing?: string;
  distinctiveFeatures?: string;
  age?: string;
  palette?: string;
  /** Canonical short visual description inserted verbatim into every prompt where the character appears. */
  visualTag: string;
  /** dream_media id of a generated reference portrait, if any. */
  referenceMediaId?: string;
}

export interface LocationBibleEntry {
  key: string;
  name: string;
  description: string;
  architecture?: string;
  lighting?: string;
  timeOfDay?: string;
  weather?: string;
  atmosphere?: string;
  visualTag: string;
}

export interface StyleBible {
  styleId: string;
  palette: string;
  lighting: string;
  lens: string;
  texture: string;
  mood: string;
}

export interface DreamBible {
  characters: CharacterBibleEntry[];
  locations: LocationBibleEntry[];
  style: StyleBible;
  /** Seed shared by all scenes of the dream when the provider supports seeds. */
  seed: number;
}

export interface SceneReferenceAsset {
  kind: "character" | "location" | "previous_frame";
  key?: string;
  mediaId: string;
}

export interface JobOptions {
  styleId: string;
  /** Video: target total duration in seconds (one of the offered options). */
  targetDurationSec?: number;
  /** Slideshow: library music track or user's uploaded track id. */
  musicTrackId?: string | null;
  watermark: boolean;
  /** Pricing action that was charged, e.g. slideshow | video_short. */
  action: string;
  locale: "ru" | "en";
  /** Variation index for full regenerations — changes seeds so results differ. */
  variant?: number;
}

export interface StageDetail {
  done?: number;
  total?: number;
  /** Media ids of assets finished so far (rendered progressively in the UI). */
  previewMediaIds?: string[];
  note?: string;
  /** Analysis version the job is bound to (set by the worker on first run; retries reuse it). */
  analysisVersion?: number;
  /** Video clip plan fixed on first run so retries produce the same cut. */
  plan?: { sceneId: string; durationSec: number }[];
  /** Regeneration variant fixed on first run so retries never pay for a new variation. */
  variant?: number;
  /** Frames a slideshow was rendered from (scene → image) — the base for scene regenerations. */
  frames?: { sceneId: string; mediaId: string }[];
  /** Music actually used for the render (inherited by later re-renders). */
  musicTrackId?: string | null;
}

export interface NotificationPrefs {
  generationReady: boolean;
  reminders: boolean;
  /** Local time HH:MM for morning reminders. */
  reminderTime: string;
  product: boolean;
}

export interface ChannelPostMediaRef {
  kind: "video" | "photo";
  mediaId: string;
}
