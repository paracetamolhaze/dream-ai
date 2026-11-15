"use server";

import { z } from "zod";
import { AppError } from "@dream/core/errors";
import { IMAGE_MODELS, STT_MODELS, VIDEO_MODELS } from "@dream/core/ai/models";
import { getSettings, updateSettings } from "@dream/core/settings";
import { adminAction, zInt, zNum } from "@/server/admin/action";

export const saveModelsAction = adminAction({
  name: "settings.models",
  revalidate: ["/admin/models"],
  schema: z.object({
    stt: z.string().min(3),
    sttCustomModel: z.string().trim().max(80).optional(),
    sttLanguage: z.enum(["auto", "ru", "en"]),
    llmProvider: z.enum(["openrouter", "anthropic", "openai", "demo"]),
    llmModel: z.string().trim().min(1).max(120),
    imageModel: z.string().min(3),
    referenceModel: z.string().optional(),
    videoModel: z.string().min(3),
  }),
  async run(input, admin) {
    const [sttProvider, ...rest] = input.stt.split(":");
    const custom = input.stt === "openai:custom";
    if (custom && !input.sttCustomModel) throw new AppError("validation_failed", "Enter the custom STT model name");
    // Catalog entries carry their adapter (Groq models run through the OpenAI-compatible one).
    const sttSpec = STT_MODELS.find((m) => m.id === input.stt);
    const sttModel = custom ? input.sttCustomModel! : (sttSpec?.model ?? rest.join(":"));
    if (!custom && !STT_MODELS.some((m) => m.id === input.stt)) throw new AppError("validation_failed", "Unknown STT model");
    const imageSpec = IMAGE_MODELS.find((m) => m.id === input.imageModel);
    if (!imageSpec) throw new AppError("validation_failed", "Unknown image model");
    if (imageSpec.requiresReferenceImage) throw new AppError("validation_failed", "The main image model must draw from text; edit-only models belong in the reference field");
    const reference = input.referenceModel ? IMAGE_MODELS.find((m) => m.id === input.referenceModel) : null;
    if (input.referenceModel && (!reference || !reference.supportsReferenceImage)) throw new AppError("validation_failed", "Reference model must accept a reference image");
    if (!VIDEO_MODELS.some((m) => m.id === input.videoModel)) throw new AppError("validation_failed", "Unknown video model");
    const value = {
      stt: { provider: sttSpec?.provider ?? sttProvider, model: sttModel, language: input.sttLanguage },
      llm: { provider: input.llmProvider, model: input.llmProvider === "demo" ? "demo" : input.llmModel },
      image: { model: input.imageModel, referenceModel: reference?.id ?? null },
      video: { model: input.videoModel },
    };
    const before = (await getSettings({ fresh: true })).models;
    await updateSettings("models", value, admin.telegramId);
    return { message: "Модели сохранены. Воркер применит их к новым задачам.", target: { type: "settings", id: "models" }, payload: { before, after: value } };
  },
});

export const saveConcurrencyAction = adminAction({
  name: "settings.concurrency",
  revalidate: ["/admin/models"],
  schema: z.object({
    transcription: zInt(1, 20),
    analysis: zInt(1, 20),
    slideshow: zInt(1, 20),
    video: zInt(1, 10),
    imagesPerJob: zInt(1, 8),
    clipsPerJob: zInt(1, 6),
  }),
  async run(input, admin) {
    await updateSettings("concurrency", input, admin.telegramId);
    return { message: "Лимиты параллельной обработки сохранены", target: { type: "settings", id: "concurrency" }, payload: input };
  },
});

export const saveGenerationAction = adminAction({
  name: "settings.generation",
  revalidate: ["/admin/models"],
  schema: z.object({
    slideshowMinScenes: zInt(1, 20),
    slideshowMaxScenes: zInt(1, 24),
    slideshowSecondsPerScene: zNum(2, 10),
    videoDurations: z
      .string()
      .transform((s) =>
        s
          .split(/[\s,;]+/)
          .filter(Boolean)
          .map(Number),
      )
      .pipe(z.array(z.number().int().min(5).max(120)).min(1).max(8)),
    maxVideoDurationSec: zInt(5, 180),
    outputWidth: zInt(360, 2160),
    outputHeight: zInt(640, 3840),
    fps: zInt(24, 60),
    jobTimeoutMinutes: zInt(5, 240),
    maxAttempts: zInt(1, 6),
  }),
  async run(input, admin) {
    if (input.slideshowMinScenes > input.slideshowMaxScenes) throw new AppError("validation_failed", "Min scenes > max scenes");
    if (input.outputWidth % 2 || input.outputHeight % 2) throw new AppError("validation_failed", "Resolution must be even (H.264)");
    const value = { ...input, videoDurations: [...new Set(input.videoDurations)].sort((a, b) => a - b) };
    await updateSettings("generation", value, admin.telegramId);
    return { message: "Параметры генерации сохранены", target: { type: "settings", id: "generation" }, payload: value };
  },
});

export const saveRetentionAction = adminAction({
  name: "settings.retention",
  revalidate: ["/admin/models"],
  schema: z.object({ audioRetentionDays: zInt(-1, 3650), deletedPurgeDays: zInt(0, 365) }),
  async run(input, admin) {
    await updateSettings("retention", input, admin.telegramId);
    return { message: "Политика хранения сохранена", target: { type: "settings", id: "retention" }, payload: input };
  },
});
