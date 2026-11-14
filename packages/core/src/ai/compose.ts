import type { DreamBible } from "../db/types";
import { truncate } from "../utils";

/**
 * Deterministic prompt composition. The LLM writes only the per-scene visual
 * content; style, character and location descriptions are injected here from
 * the bibles verbatim, which keeps every frame consistent.
 */

export interface StylePreset {
  id: string;
  promptPrefix: string;
  promptSuffix: string;
  negativePrompt: string;
}

export interface ComposableScene {
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt?: string | null;
  cameraAngle?: string | null;
  composition?: string | null;
  motion?: string | null;
  mood?: string | null;
  characters: string[];
  location?: string | null;
}

export function composeImagePrompt(scene: ComposableScene, bible: DreamBible, style: StylePreset, opts: { withReference?: boolean } = {}): string {
  const chars = scene.characters
    .map((k) => bible.characters.find((c) => c.key === k))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => `${c.name === "Я" || c.name === "Me" ? "the dreamer" : c.key.replace(/_/g, " ")}: ${c.visualTag}`);
  const loc = bible.locations.find((l) => l.key === scene.location);
  const parts = [
    style.promptPrefix,
    opts.withReference && chars.length > 0 ? "Keep the same character as in the reference image, same face, hair and clothing" : null,
    scene.imagePrompt,
    chars.length > 0 ? `Characters — ${chars.join("; ")}` : null,
    loc ? `Setting — ${loc.visualTag}${loc.lighting ? `, ${loc.lighting}` : ""}${loc.timeOfDay ? `, ${loc.timeOfDay}` : ""}` : null,
    scene.cameraAngle ? `Shot: ${scene.cameraAngle}` : null,
    scene.composition,
    `Color palette: ${bible.style.palette}. Lighting: ${bible.style.lighting}. ${bible.style.lens}. ${bible.style.texture}`,
    scene.mood ? `Mood: ${scene.mood}` : null,
    "vertical 9:16 frame, no text, no captions, no watermark",
    style.promptSuffix,
  ];
  return truncate(parts.filter(Boolean).join(". ").replace(/\.\s*\./g, ".").replace(/\s+/g, " "), 1800);
}

export function composeNegativePrompt(scene: ComposableScene, style: StylePreset): string {
  return [style.negativePrompt, scene.negativePrompt, "text, letters, watermark, logo, deformed hands, extra limbs"].filter(Boolean).join(", ");
}

export function composeVideoPrompt(scene: ComposableScene, bible: DreamBible): string {
  return truncate([scene.videoPrompt, scene.motion ? `Camera: ${scene.motion}` : null, `Atmosphere: ${bible.style.mood}, ${bible.style.texture}`, "smooth cinematic motion, consistent characters"].filter(Boolean).join(". "), 900);
}

export function composeReferencePortraitPrompt(character: DreamBible["characters"][number], bible: DreamBible, style: StylePreset): string {
  return truncate(
    [
      style.promptPrefix,
      `Character reference portrait: ${character.visualTag}`,
      character.appearance,
      character.hair ? `Hair: ${character.hair}` : null,
      character.clothing ? `Clothing: ${character.clothing}` : null,
      character.distinctiveFeatures,
      "full body, neutral pose, plain softly lit background, centered",
      `Palette: ${character.palette || bible.style.palette}`,
      "vertical frame, no text",
      style.promptSuffix,
    ]
      .filter(Boolean)
      .join(". "),
    1500,
  );
}

// ─── Video duration planning ────────────────────────────────────────────────

export interface ClipPlanItem {
  sceneIndex: number;
  durationSec: number;
}

export interface ClipPlan {
  clips: ClipPlanItem[];
  totalSec: number;
}

/**
 * Builds a clip plan whose total length is achievable with the model's
 * supported clip durations. Prefers one clip per scene (keeping the most
 * important scenes when there are more scenes than clips).
 */
export function planVideoClips(targetSec: number, clipDurations: number[], scenes: { importance: number }[]): ClipPlan {
  const durations = [...new Set(clipDurations)].sort((a, b) => a - b);
  if (durations.length === 0 || scenes.length === 0) return { clips: [], totalSec: 0 };
  const maxClips = Math.max(1, scenes.length);
  let best: { n: number; picks: number[]; total: number; score: number } | undefined;
  for (let n = 1; n <= Math.min(maxClips, 24); n++) {
    const per = targetSec / n;
    const pick = durations.reduce((b, d) => (Math.abs(d - per) < Math.abs(b - per) ? d : b), durations[0]!);
    const picks = Array<number>(n).fill(pick);
    // Fine-tune: upgrade clips one by one while it brings the total closer to target.
    let total = pick * n;
    for (let i = 0; i < n; i++) {
      for (const d of durations) {
        const candidate = total - picks[i]! + d;
        if (Math.abs(candidate - targetSec) < Math.abs(total - targetSec)) {
          total = candidate;
          picks[i] = d;
        }
      }
    }
    // Score: distance to target, then prefer more distinct scenes (closer to scene count).
    const score = Math.abs(total - targetSec) * 10 + Math.abs(scenes.length - n) * 0.5;
    if (!best || score < best.score) best = { n, picks, total, score };
  }
  const chosen = best!;
  const ranked = scenes
    .map((s, i) => ({ i, importance: s.importance }))
    .sort((a, b) => b.importance - a.importance || a.i - b.i)
    .slice(0, chosen.n)
    .map((s) => s.i)
    .sort((a, b) => a - b);
  return { clips: ranked.map((sceneIndex, k) => ({ sceneIndex, durationSec: chosen.picks[k]! })), totalSec: chosen.total };
}

/** Distinct achievable total durations for the offered targets (what the UI shows). */
export function videoDurationOptions(targets: number[], maxSec: number, clipDurations: number[], sceneCount: number): { targetSec: number; actualSec: number; clips: number }[] {
  const scenes = Array.from({ length: Math.max(1, sceneCount) }, () => ({ importance: 2 }));
  const seen = new Set<number>();
  const out: { targetSec: number; actualSec: number; clips: number }[] = [];
  for (const t of [...targets].sort((a, b) => a - b)) {
    if (t > maxSec) continue;
    const plan = planVideoClips(t, clipDurations, scenes);
    if (plan.totalSec <= 0 || plan.totalSec > maxSec || seen.has(plan.totalSec)) continue;
    seen.add(plan.totalSec);
    out.push({ targetSec: t, actualSec: plan.totalSec, clips: plan.clips.length });
  }
  return out;
}

/** Pricing action for a video of a given length. */
export function videoActionFor(totalSec: number): "video_short" | "video_medium" | "video_long" {
  if (totalSec <= 15) return "video_short";
  if (totalSec <= 30) return "video_medium";
  return "video_long";
}
