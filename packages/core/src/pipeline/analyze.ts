import { and, eq } from "drizzle-orm";
import { UnrecoverableError } from "bullmq";
import { analysisSystemPrompt, analysisUserPrompt, DreamAnalysisSchema, STYLE_IDS, type DreamAnalysis } from "../ai/analysis";
import { getLlmProvider } from "../ai/registry";
import type { StructuredResult } from "../ai/types";
import { getDb } from "../db/client";
import { dreamScenes, dreams, users, visualStyles } from "../db/schema";
import type { CharacterBibleEntry, DreamBible, LocationBibleEntry } from "../db/types";
import { AppError } from "../errors";
import { errorText, msg, type Locale } from "../i18n";
import { logger } from "../logger";
import { enqueue, jobIdFor, QUEUES, type AnalysisPayload } from "../queue";
import { recordUsage } from "../services/ai-usage";
import { track } from "../services/analytics";
import { sendToChat } from "../services/notify";
import { qualifyReferral } from "../services/referrals";
import { getUserSettings, userLocale } from "../services/users";
import { getSettings } from "../settings";
import { InlineKeyboard, webAppUrl } from "../telegram/bot-api";
import { clamp, seedFrom, sha256, truncate } from "../utils";
import { classifyError, isFinalAttempt, releaseLock, tryLock, type AttemptInfo } from "./common";
import { routes } from "../routes";

const log = logger.child({ step: "analysis" });

// ─── Post-processing (pure, unit-tested) ────────────────────────────────────

const DREAMER_ALIASES = new Set(["dreamer", "me", "i", "myself", "narrator", "self", "я", "мне", "меня", "сновидец", "рассказчик"]);

function slugKey(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

const s = (v: unknown, max: number): string => truncate(typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "", max);

function cleanTitle(raw: string, locale: Locale): string {
  const t = raw
    .replace(/[«»"“”„'`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.。]+$/, "")
    .trim();
  return truncate(t, 60) || (locale === "en" ? "Dream" : "Сон");
}

export interface PostProcessOptions {
  minScenes: number;
  maxScenes: number;
  locale: Locale;
}

/**
 * Validates and repairs the LLM output so the rest of the pipeline can rely on
 * it: unique snake_case keys, scene references that exist, a neutral "dreamer"
 * when the story is told in first person, importance 1–3, at most
 * `maxScenes` scenes (least important beats are dropped, order is kept).
 * Never invents scenes to reach a minimum.
 */
export function postProcessAnalysis(raw: DreamAnalysis, opts: PostProcessOptions): DreamAnalysis {
  const locale: Locale = raw.language === "en" ? "en" : raw.language === "ru" ? "ru" : opts.locale;

  // Characters: unique keys, alias map raw key/name → final key.
  const charAlias = new Map<string, string>();
  const characters: DreamAnalysis["characters"] = [];
  const usedChar = new Set<string>();
  raw.characters.forEach((c, i) => {
    const rawKey = (c.key ?? "").trim();
    const isDreamer = DREAMER_ALIASES.has(rawKey.toLowerCase()) || DREAMER_ALIASES.has((c.name ?? "").trim().toLowerCase());
    let key = isDreamer ? "dreamer" : slugKey(rawKey) || slugKey(c.name ?? "") || `character_${i + 1}`;
    if (usedChar.has(key)) {
      if (isDreamer) {
        charAlias.set(rawKey.toLowerCase(), "dreamer");
        return;
      }
      let n = 2;
      while (usedChar.has(`${key}_${n}`)) n++;
      key = `${key}_${n}`;
    }
    usedChar.add(key);
    // First occurrence wins: scenes referring to a duplicated raw key mean the first character.
    if (!charAlias.has(rawKey.toLowerCase())) charAlias.set(rawKey.toLowerCase(), key);
    if (c.name && !charAlias.has(c.name.trim().toLowerCase())) charAlias.set(c.name.trim().toLowerCase(), key);
    charAlias.set(key, key);
    const appearance = s(c.appearance, 400);
    const clothing = s(c.clothing, 200);
    characters.push({
      key,
      name: s(c.name, 60) || (key === "dreamer" ? (locale === "en" ? "Me" : "Я") : key.replace(/_/g, " ")),
      role: s(c.role, 40) || (key === "dreamer" ? "protagonist" : "other"),
      appearance,
      hair: s(c.hair, 160),
      clothing,
      distinctiveFeatures: s(c.distinctiveFeatures, 240),
      age: s(c.age, 60),
      palette: s(c.palette, 120),
      visualTag:
        s(c.visualTag, 260) ||
        truncate([appearance, clothing].filter(Boolean).join(", "), 260) ||
        (key === "dreamer" ? "the dreamer, a person seen from behind in soft silhouette, face not visible" : `a mysterious figure`),
    });
  });

  // Locations.
  const locAlias = new Map<string, string>();
  const locations: DreamAnalysis["locations"] = [];
  const usedLoc = new Set<string>();
  raw.locations.forEach((l, i) => {
    const rawKey = (l.key ?? "").trim();
    let key = slugKey(rawKey) || slugKey(l.name ?? "") || `location_${i + 1}`;
    if (usedLoc.has(key)) {
      let n = 2;
      while (usedLoc.has(`${key}_${n}`)) n++;
      key = `${key}_${n}`;
    }
    usedLoc.add(key);
    if (!locAlias.has(rawKey.toLowerCase())) locAlias.set(rawKey.toLowerCase(), key);
    if (l.name && !locAlias.has(l.name.trim().toLowerCase())) locAlias.set(l.name.trim().toLowerCase(), key);
    locAlias.set(key, key);
    const description = s(l.description, 400);
    locations.push({
      key,
      name: s(l.name, 60) || key.replace(/_/g, " "),
      description,
      architecture: s(l.architecture, 200),
      lighting: s(l.lighting, 160),
      timeOfDay: s(l.timeOfDay, 60),
      weather: s(l.weather, 100),
      atmosphere: s(l.atmosphere, 160),
      visualTag: s(l.visualTag, 260) || truncate(description, 260) || "a dreamlike place",
    });
  });
  if (locations.length === 0) {
    locations.push({
      key: "dreamscape",
      name: locale === "en" ? "Dreamscape" : "Место сна",
      description: s(raw.atmosphere, 200) || "a dreamlike place",
      architecture: "",
      lighting: s(raw.style?.lighting, 160) || "soft moonlight",
      timeOfDay: "night",
      weather: "",
      atmosphere: s(raw.mood, 100) || "dreamlike",
      visualTag: "a misty dreamlike place",
    });
  }

  // Scenes.
  let needsDreamer = false;
  let scenes = raw.scenes
    .filter((sc) => (sc.description ?? "").trim() || (sc.imagePrompt ?? "").trim())
    .map((sc) => {
      const chars: string[] = [];
      for (const k of sc.characters ?? []) {
        const low = String(k).trim().toLowerCase();
        const mapped = charAlias.get(low) ?? (DREAMER_ALIASES.has(low) ? "dreamer" : undefined);
        if (mapped === "dreamer" && !usedChar.has("dreamer")) needsDreamer = true;
        if (mapped && !chars.includes(mapped)) chars.push(mapped);
      }
      const loc = locAlias.get(String(sc.location ?? "").trim().toLowerCase()) ?? locations[0]!.key;
      const description = s(sc.description, 600) || s(sc.action, 600) || s(sc.imagePrompt, 600);
      return {
        title: s(sc.title, 80),
        description,
        action: s(sc.action, 400),
        mood: s(sc.mood, 60),
        characters: chars,
        location: loc,
        cameraAngle: s(sc.cameraAngle, 80) || "medium shot",
        composition: s(sc.composition, 200),
        motion: s(sc.motion, 160) || "slow push in",
        imagePrompt: s(sc.imagePrompt, 1200) || s(sc.action, 600) || description,
        videoPrompt: s(sc.videoPrompt, 600) || s(sc.action, 400) || "slow cinematic camera movement",
        negativePrompt: s(sc.negativePrompt, 300),
        importance: clamp(Math.round(Number(sc.importance) || 2), 1, 3),
      };
    });

  if (needsDreamer && !usedChar.has("dreamer")) {
    characters.unshift({
      key: "dreamer",
      name: locale === "en" ? "Me" : "Я",
      role: "protagonist",
      appearance: "a person whose face is never clearly shown",
      hair: "",
      clothing: "simple dark clothes",
      distinctiveFeatures: "",
      age: "",
      palette: "",
      visualTag: "the dreamer, a person seen from behind in soft silhouette, face not visible, simple dark clothes",
    });
    usedChar.add("dreamer");
  }
  // Drop characters no scene uses? Keep them — they may still matter for the bible. Remove dangling ones from scenes only.
  const known = new Set(characters.map((c) => c.key));
  scenes = scenes.map((sc) => ({ ...sc, characters: sc.characters.filter((k) => known.has(k)) }));

  // Trim to maxScenes: drop the least important beats, prefer dropping from the middle (keep opening and ending).
  const max = Math.max(1, opts.maxScenes);
  while (scenes.length > max) {
    const mid = (scenes.length - 1) / 2;
    let drop = -1;
    scenes.forEach((sc, i) => {
      if (drop === -1) {
        drop = i;
        return;
      }
      const cur = scenes[drop]!;
      if (sc.importance < cur.importance || (sc.importance === cur.importance && Math.abs(i - mid) < Math.abs(drop - mid))) drop = i;
    });
    scenes.splice(drop, 1);
  }

  const suggested = (STYLE_IDS as readonly string[]).includes(raw.suggestedStyle) ? raw.suggestedStyle : "cinematic";
  return {
    title: cleanTitle(raw.title ?? "", locale),
    summary: s(raw.summary, 400),
    language: raw.language,
    atmosphere: s(raw.atmosphere, 80),
    mood: s(raw.mood, 60) || "dreamlike",
    suggestedStyle: suggested as DreamAnalysis["suggestedStyle"],
    style: {
      palette: s(raw.style?.palette, 160) || "deep blue, violet, soft lavender highlights",
      lighting: s(raw.style?.lighting, 160) || "soft moonlight with volumetric haze",
      lens: s(raw.style?.lens, 120) || "35mm lens, shallow depth of field",
      texture: s(raw.style?.texture, 120) || "subtle film grain",
      mood: s(raw.style?.mood, 80) || s(raw.mood, 60) || "dreamlike",
    },
    characters,
    locations,
    scenes,
  };
}

/** Chooses the bible style: the user's default (if valid) or the model's suggestion; "auto" → cinematic. */
async function resolveStyleId(preferred: string | null | undefined, suggested: string): Promise<string> {
  const rows = await getDb().select({ id: visualStyles.id }).from(visualStyles).where(eq(visualStyles.isActive, true));
  const active = new Set(rows.map((r) => r.id));
  for (const candidate of [preferred, suggested, "cinematic"]) {
    if (candidate && candidate !== "auto" && active.has(candidate)) return candidate;
  }
  return rows.find((r) => r.id !== "auto")?.id ?? "cinematic";
}

// ─── Queue processor ────────────────────────────────────────────────────────

export async function processAnalysis(payload: AnalysisPayload, attempt: AttemptInfo): Promise<{ status: string; scenes?: number }> {
  const db = getDb();
  const [dream] = await db.select().from(dreams).where(eq(dreams.id, payload.dreamId));
  if (!dream || dream.deletedAt) return { status: "skipped_deleted" };
  if (dream.status !== "analyzing") return { status: "skipped_state" };
  const [user] = await db.select().from(users).where(eq(users.id, dream.userId));
  if (!user || user.status === "deleted") return { status: "skipped_user" };
  const locale = userLocale(user);
  const text = dream.editedText ?? "";
  const textHash = sha256(text);

  const lockKey = `lock:analysis:${dream.id}`;
  if (!(await tryLock(lockKey, attempt.owner, 15 * 60_000))) return { status: "skipped_locked" };
  try {
    if (!text.trim()) throw new AppError("analysis_failed", "dream has no text", { retryable: false });
    const settings = await getSettings();
    const g = settings.generation;
    const prefs = await getUserSettings(user.id);
    const provider = getLlmProvider(settings);
    const t0 = Date.now();
    let res: StructuredResult<DreamAnalysis>;
    try {
      res = await provider.generateStructured(
        {
          system: analysisSystemPrompt({ minScenes: g.slideshowMinScenes, maxScenes: g.slideshowMaxScenes }),
          user: analysisUserPrompt(text, prefs.defaultStyle ?? undefined),
          schema: DreamAnalysisSchema,
          schemaName: "dream_analysis",
          maxTokens: 16000,
        },
        { userId: user.id, dreamId: dream.id },
      );
    } catch (err) {
      await recordUsage({ kind: "llm", provider: provider.id, model: provider.model, costUsd: 0, success: false, error: (err as Error).message, isDemo: provider.isDemo, userId: user.id, dreamId: dream.id, durationMs: Date.now() - t0 }).catch(() => undefined);
      throw err;
    }
    await recordUsage({
      kind: "llm",
      provider: provider.id,
      model: provider.model,
      costUsd: res.costUsd,
      units: (res.inputTokens ?? 0) + (res.outputTokens ?? 0),
      unit: "token",
      durationMs: Date.now() - t0,
      isDemo: provider.isDemo,
      userId: user.id,
      dreamId: dream.id,
    });

    const analysis = postProcessAnalysis(res.data, { minScenes: g.slideshowMinScenes, maxScenes: g.slideshowMaxScenes, locale });
    if (analysis.scenes.length === 0) throw new AppError("analysis_failed", "no scenes in analysis", { retryable: false });
    const styleId = await resolveStyleId(prefs.defaultStyle, analysis.suggestedStyle);
    const bible: DreamBible = {
      characters: analysis.characters.map((c): CharacterBibleEntry => ({ ...c })),
      locations: analysis.locations.map((l): LocationBibleEntry => ({ ...l })),
      style: { styleId, ...analysis.style },
      seed: seedFrom(dream.id),
    };

    const applied = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(dreams).where(eq(dreams.id, dream.id)).for("update");
      if (!locked || locked.deletedAt || locked.status !== "analyzing" || sha256(locked.editedText ?? "") !== textHash) return null;
      const version = locked.analysisVersion + 1;
      await tx.insert(dreamScenes).values(
        analysis.scenes.map((sc, i) => ({
          dreamId: dream.id,
          analysisVersion: version,
          sequenceNumber: i + 1,
          title: sc.title || null,
          description: sc.description,
          action: sc.action || null,
          mood: sc.mood || null,
          imagePrompt: sc.imagePrompt,
          videoPrompt: sc.videoPrompt,
          negativePrompt: sc.negativePrompt || null,
          cameraAngle: sc.cameraAngle || null,
          composition: sc.composition || null,
          motion: sc.motion || null,
          characters: sc.characters,
          location: sc.location,
          importance: sc.importance,
          durationSec: g.slideshowSecondsPerScene,
          seed: bible.seed,
          status: "pending" as const,
        })),
      );
      await tx
        .update(dreams)
        .set({
          title: locked.titleEditedByUser && locked.title ? locked.title : analysis.title,
          summary: analysis.summary || null,
          language: analysis.language === "other" ? locked.language : analysis.language,
          atmosphere: analysis.atmosphere || null,
          visualStyle: styleId,
          bible,
          analysisVersion: version,
          analysisTextHash: textHash,
          analysisProvider: `${provider.id}:${provider.model}`,
          analysisIsDemo: provider.isDemo,
          status: "ready",
          errorCode: null,
        })
        .where(eq(dreams.id, dream.id));
      return { version, title: locked.titleEditedByUser && locked.title ? locked.title : analysis.title };
    });
    if (!applied) return { status: "superseded" };

    await track("analysis_completed", user.id, { scenes: analysis.scenes.length, demo: provider.isDemo });
    await qualifyReferral(user.id, "first_dream");
    if (payload.replyChatId) {
      const m = msg(locale);
      await sendToChat(payload.replyChatId, m.analysisReady(applied.title), new InlineKeyboard().webApp(m.btnChooseFormat, webAppUrl(routes.prepare(dream.id))));
    }
    if (settings.limits.freePreviewEnabled) {
      await enqueue(QUEUES.preview, { dreamId: dream.id }, { jobId: jobIdFor("preview", dream.id, applied.version), attempts: 2, backoff: { type: "exponential", delay: 10_000 } }).catch((err: Error) =>
        log.warn("preview enqueue failed", { error: err.message }),
      );
    }
    return { status: "ready", scenes: analysis.scenes.length };
  } catch (err) {
    const c = classifyError(err);
    if (c.retryable && !isFinalAttempt(attempt)) {
      log.warn("analysis attempt failed, will retry", { dreamId: dream.id, code: c.code, error: c.message });
      throw err;
    }
    const code = c.code === "internal" || c.code === "provider_unavailable" || c.code === "provider_rejected_content" ? c.code : "analysis_failed";
    log.warn("analysis failed", { dreamId: dream.id, code, error: c.message });
    await db
      .update(dreams)
      .set({ status: "analysis_failed", errorCode: code })
      .where(and(eq(dreams.id, dream.id), eq(dreams.status, "analyzing")));
    if (payload.replyChatId) await sendToChat(payload.replyChatId, errorText(code === "internal" ? "analysis_failed" : code, locale));
    throw new UnrecoverableError(`${code}: ${c.message}`);
  } finally {
    await releaseLock(lockKey, attempt.owner);
  }
}
