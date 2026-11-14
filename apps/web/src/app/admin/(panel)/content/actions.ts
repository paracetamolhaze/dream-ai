"use server";

import { z } from "zod";
import { AppError } from "@dream/core/errors";
import { deleteLibraryTrack, setFormatExamples, setStyleActive, setTrackActive, upsertStyle, uploadLibraryTrack } from "@dream/core/services/admin-ops";
import { adminAction, zCheckbox, zInt, zOptText, zText, zUuid } from "@/server/admin/action";

export const saveStyleAction = adminAction({
  name: "style.upsert",
  revalidate: ["/admin/content"],
  schema: z.object({
    id: zText(32, 2),
    nameRu: zText(60, 1),
    nameEn: zText(60, 1),
    promptPrefix: zText(800, 3),
    promptSuffix: zText(400),
    negativePrompt: zText(500),
    swatch: zText(320, 4),
    sortOrder: zInt(-1000, 1000),
    isActive: zCheckbox,
  }),
  async run(input) {
    await upsertStyle(input);
    return { message: `Стиль «${input.nameRu}» сохранён`, target: { type: "style", id: input.id }, payload: input };
  },
});

export const toggleStyleAction = adminAction({
  name: "style.toggle",
  revalidate: ["/admin/content"],
  schema: z.object({ id: zText(32, 2), active: z.enum(["0", "1"]) }),
  async run(input) {
    await setStyleActive(input.id, input.active === "1");
    return { message: input.active === "1" ? "Стиль включён" : "Стиль скрыт из приложения", target: { type: "style", id: input.id }, payload: { active: input.active === "1" } };
  },
});

export const uploadTrackAction = adminAction({
  name: "music.upload",
  revalidate: ["/admin/content"],
  schema: z.object({
    title: zText(120, 1),
    artist: zOptText(120),
    license: zText(300, 3),
    sortOrder: zInt(-1000, 1000).default(0),
    file: z.instanceof(File),
    confirmRights: zCheckbox,
  }),
  async run(input) {
    if (!input.confirmRights) throw new AppError("validation_failed", "Confirm that you have the right to use this track");
    if (input.file.size === 0) throw new AppError("audio_empty", "Choose an audio file");
    const bytes = Buffer.from(await input.file.arrayBuffer());
    const track = await uploadLibraryTrack({ title: input.title, artist: input.artist, license: input.license, bytes, sortOrder: input.sortOrder });
    return { message: `Трек «${track.title}» загружен`, target: { type: "music_track", id: track.id }, payload: { title: track.title, license: track.license, size: input.file.size } };
  },
});

export const toggleTrackAction = adminAction({
  name: "music.toggle",
  revalidate: ["/admin/content"],
  schema: z.object({ id: zUuid, active: z.enum(["0", "1"]) }),
  async run(input) {
    await setTrackActive(input.id, input.active === "1");
    return { message: input.active === "1" ? "Трек доступен пользователям" : "Трек скрыт", target: { type: "music_track", id: input.id }, payload: { active: input.active === "1" } };
  },
});

export const deleteTrackAction = adminAction({
  name: "music.delete",
  revalidate: ["/admin/content"],
  schema: z.object({ id: zUuid }),
  async run(input) {
    await deleteLibraryTrack(input.id);
    return { message: "Трек удалён", target: { type: "music_track", id: input.id } };
  },
});

const optUuid = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().uuid().nullable());

export const saveExamplesAction = adminAction({
  name: "settings.format_examples",
  revalidate: ["/admin/content"],
  schema: z.object({ slideshowMediaId: optUuid, videoMediaId: optUuid }),
  async run(input, admin) {
    await setFormatExamples(input.slideshowMediaId, input.videoMediaId, admin.telegramId);
    return { message: "Примеры форматов сохранены", target: { type: "settings", id: "formatExamples" }, payload: input };
  },
});
