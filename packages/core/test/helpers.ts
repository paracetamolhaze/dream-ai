import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { dreamScenes, dreams, users } from "../src/db/schema";
import type { DreamBible } from "../src/db/types";
import { sha256 } from "../src/utils";

/** Integration suites run only when the global setup reached Postgres. */
export const integration = process.env.INTEGRATION === "1" || (process.env.INTEGRATION === undefined && Boolean(process.env.DATABASE_URL));

let seq = 0;
export function uniqueTelegramId(): number {
  seq += 1;
  return 7_000_000_000 + Math.floor(Math.random() * 900_000_000) + seq;
}

export async function createUser(overrides: Partial<typeof users.$inferInsert> = {}) {
  const tg = overrides.telegramId ?? uniqueTelegramId();
  const [u] = await getDb()
    .insert(users)
    .values({ telegramId: tg, referralCode: `t${tg.toString(36)}`, firstName: "Test", ...overrides })
    .returning();
  return u!;
}

export const TEST_BIBLE: DreamBible = {
  seed: 42,
  characters: [{ key: "dreamer", name: "Я", role: "protagonist", appearance: "slim figure", clothing: "grey coat", visualTag: "a slim person in a long grey coat", palette: "grey" }],
  locations: [{ key: "city", name: "Город", description: "abandoned city", visualTag: "an abandoned city of glass towers under a red sky", lighting: "red dusk" }],
  style: { styleId: "cinematic", palette: "red, black", lighting: "dusk", lens: "35mm", texture: "film grain", mood: "eerie" },
};

/** A dream that has been analyzed and is ready for generation. */
export async function createReadyDream(userId: string, opts: { scenes?: number; title?: string; text?: string } = {}) {
  const text = opts.text ?? "Мне приснился огромный заброшенный город под красным небом. Я встретил человека без лица.";
  const [d] = await getDb()
    .insert(dreams)
    .values({
      userId,
      title: opts.title ?? "Город без людей",
      status: "ready",
      source: "miniapp_text",
      originalText: text,
      editedText: text,
      bible: TEST_BIBLE,
      analysisVersion: 1,
      analysisTextHash: sha256(text),
      visualStyle: "cinematic",
    })
    .returning();
  const n = opts.scenes ?? 4;
  for (let i = 0; i < n; i++) {
    await getDb()
      .insert(dreamScenes)
      .values({
        dreamId: d!.id,
        analysisVersion: 1,
        sequenceNumber: i + 1,
        description: `Сцена ${i + 1}`,
        imagePrompt: `scene ${i + 1}`,
        videoPrompt: `motion ${i + 1}`,
        characters: ["dreamer"],
        location: "city",
        importance: i === 0 ? 3 : 2,
        seed: 42 + i,
      });
  }
  return d!;
}

export async function getUserRow(id: string) {
  const [u] = await getDb().select().from(users).where(eq(users.id, id));
  return u!;
}
