import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "../src/db/client";
import { dreamMedia, dreams, generationJobs, payments, users } from "../src/db/schema";
import { closeQueues } from "../src/queue";
import { closeRedis } from "../src/redis";
import { getDreamDetail, getOwnedDream, renameDream } from "../src/services/dreams";
import { listLibrary } from "../src/services/library";
import { purgeAccount, purgeDream } from "../src/services/account";
import { putObject, headObject, keys } from "../src/storage";
import { createReadyDream, createUser, integration, uniqueTelegramId } from "./helpers";
import { upsertTelegramUser } from "../src/services/users";
import { createShareLink, resolveShareToken } from "../src/services/share";
import { getSettings, updateSettings } from "../src/settings";

async function addResult(userId: string, dreamId: string, type: "slideshow" | "video", durationSec = 42) {
  const [m] = await getDb()
    .insert(dreamMedia)
    .values({ dreamId, userId, mediaType: type, format: "mp4", storageKey: `u/${userId}/d/${dreamId}/media/${type}.mp4`, status: "ready", durationSec })
    .returning();
  return m!;
}

describe.skipIf(!integration)("library: formats, filters, isolation", () => {
  afterAll(async () => {
    await closeQueues();
    await closeRedis();
    await closeDb();
  });

  it("one dream with both formats appears in both tabs without duplication", async () => {
    const u = await createUser();
    const both = await createReadyDream(u.id, { title: "Город без людей" });
    await addResult(u.id, both.id, "slideshow");
    await addResult(u.id, both.id, "video", 30);
    const onlySlides = await createReadyDream(u.id, { title: "Красное небо" });
    await addResult(u.id, onlySlides.id, "slideshow");
    const pendingVideo = await createReadyDream(u.id, { title: "Последний поезд" });
    await getDb()
      .insert(generationJobs)
      .values({ userId: u.id, dreamId: pendingVideo.id, mediaType: "video", status: "generating_video", options: { styleId: "cinematic", watermark: false, action: "video_short", locale: "ru" } });
    const awaiting = await createReadyDream(u.id, { title: "Дом на краю океана" });

    const all = await listLibrary(u.id, { tab: "all", sort: "new" });
    expect(all.items.map((i) => i.id).sort()).toEqual([both.id, onlySlides.id, pendingVideo.id, awaiting.id].sort());
    expect(new Set(all.items.map((i) => i.id)).size).toBe(all.items.length);
    expect(all.stats).toEqual({ total: 4, slideshows: 2, videos: 1 });

    const slides = await listLibrary(u.id, { tab: "slideshow", sort: "new" });
    expect(slides.items.map((i) => i.id).sort()).toEqual([both.id, onlySlides.id].sort());

    const videos = await listLibrary(u.id, { tab: "video", sort: "new" });
    expect(videos.items.map((i) => i.id).sort()).toEqual([both.id, pendingVideo.id].sort());
    const pv = videos.items.find((i) => i.id === pendingVideo.id)!;
    expect(pv.status).toBe("processing");
    expect(videos.items.find((i) => i.id === both.id)!.durationSec).toBe(30);
    expect(all.items.find((i) => i.id === awaiting.id)!.status).toBe("awaiting");

    const detail = await getDreamDetail(u, both.id);
    expect(detail.slideshows).toHaveLength(1);
    expect(detail.videos).toHaveLength(1);
  });

  it("sorts, filters favorites/ready/processing and searches title and text", async () => {
    const u = await createUser();
    const a = await createReadyDream(u.id, { title: "Человек без лица", text: "Я встретил человека без лица у старой двери." });
    await new Promise((r) => setTimeout(r, 15));
    const b = await createReadyDream(u.id, { title: "Океан", text: "Синий дом стоял на краю океана, вокруг летали медузы." });
    await addResult(u.id, b.id, "slideshow");
    await getDb().update(dreams).set({ isFavorite: true }).where(eq(dreams.id, a.id));

    expect((await listLibrary(u.id, { tab: "all", sort: "new" })).items[0]!.id).toBe(b.id);
    expect((await listLibrary(u.id, { tab: "all", sort: "old" })).items[0]!.id).toBe(a.id);
    expect((await listLibrary(u.id, { tab: "all", sort: "new", favorites: true })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await listLibrary(u.id, { tab: "all", sort: "new", status: "ready" })).items.map((i) => i.id)).toEqual([b.id]);
    expect((await listLibrary(u.id, { tab: "all", sort: "new", q: "медуз" })).items.map((i) => i.id)).toEqual([b.id]);
    expect((await listLibrary(u.id, { tab: "all", sort: "new", q: "без лица" })).items.map((i) => i.id)).toEqual([a.id]);
    expect((await listLibrary(u.id, { tab: "all", sort: "new", q: "100%_" })).items).toHaveLength(0);

    // Cursor pagination
    const p1 = await listLibrary(u.id, { tab: "all", sort: "new", limit: 1 });
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listLibrary(u.id, { tab: "all", sort: "new", limit: 1, cursor: p1.nextCursor });
    expect(p2.items[0]!.id).toBe(a.id);
    expect(p2.nextCursor).toBeNull();
  });

  it("isolates users: no access to someone else's dreams", async () => {
    const owner = await createUser();
    const stranger = await createUser();
    const d = await createReadyDream(owner.id);
    await expect(getOwnedDream(stranger.id, d.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(getDreamDetail(stranger, d.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(renameDream(stranger, d.id, "hacked")).rejects.toMatchObject({ code: "not_found" });
    expect((await listLibrary(stranger.id, { tab: "all", sort: "new" })).items).toHaveLength(0);
  });
});

describe.skipIf(!integration || process.env.S3_AVAILABLE !== "1")("data deletion", () => {
  it("purges a dream's files and rows", async () => {
    const u = await createUser();
    const d = await createReadyDream(u.id);
    const key = keys.media(u.id, d.id, "x", "jpg");
    await putObject(key, Buffer.from("frame"), "image/jpeg");
    await getDb().update(dreams).set({ deletedAt: new Date() }).where(eq(dreams.id, d.id));
    const res = await purgeDream(u.id, d.id);
    expect(res.files).toBe(1);
    expect(await headObject(key)).toBeNull();
    expect(await getDb().select().from(dreams).where(eq(dreams.id, d.id))).toHaveLength(0);
  });

  it("re-registering after erasure does not mint new free generations, bonus or referral", async () => {
    const original = (await getSettings({ fresh: true })).limits;
    await updateSettings("limits", { ...original, signupBonusCredits: 7, freeSlideshowsPerUser: 1 });
    try {
      const inviter = await createUser();
      const u = await createUser({ freeSlideshowsUsed: 1 });
      await purgeAccount(u.id, u.telegramId);
      const { user: back } = await upsertTelegramUser({ id: u.telegramId, first_name: "Again" }, { startParam: `ref_${inviter.referralCode}` });
      expect(back.freeSlideshowsUsed).toBe(1);
      expect(back.creditsBalance).toBe(0);
      expect(back.referredBy).toBeNull();
      // A genuinely new account still gets the bonus.
      const { user: fresh } = await upsertTelegramUser({ id: uniqueTelegramId(), first_name: "New" });
      expect(fresh.creditsBalance).toBe(7);
    } finally {
      await updateSettings("limits", original);
    }
  });

  it("share links stop working while the owner's account is being deleted", async () => {
    const u = await createUser();
    const d = await createReadyDream(u.id);
    const m = await addResult(u.id, d.id, "slideshow");
    const link = await createShareLink(u, d.id, m.id, { showTitle: false, showText: false });
    const shared = await resolveShareToken(link.token);
    expect(shared?.title).toBeNull();
    expect(shared?.media.downloadUrl).toBeNull();
    await getDb().update(users).set({ status: "deleted" }).where(eq(users.id, u.id));
    expect(await resolveShareToken(link.token)).toBeNull();
  });

  it("purges an account but keeps anonymized payment records", async () => {
    const u = await createUser({ creditsBalance: 10 });
    const d = await createReadyDream(u.id);
    const key = keys.audio(u.id, d.id, "ogg");
    await putObject(key, Buffer.from("OggS"), "audio/ogg");
    const [p] = await getDb().insert(payments).values({ userId: u.id, telegramUserId: u.telegramId, starsAmount: 99, creditsAmount: 50, invoicePayload: `del-${u.id}`, status: "paid" }).returning();
    await purgeAccount(u.id);
    expect(await headObject(key)).toBeNull();
    expect(await getDb().select().from(dreams).where(eq(dreams.userId, u.id))).toHaveLength(0);
    const [kept] = await getDb().select().from(payments).where(eq(payments.id, p!.id));
    expect(kept!.userId).toBeNull();
  });
});
