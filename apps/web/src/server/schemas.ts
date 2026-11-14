import "server-only";
import { z } from "zod";

export const StartGenerationSchema = z.object({
  format: z.enum(["slideshow", "video"]),
  styleId: z.string().min(1).max(40),
  targetDurationSec: z.number().int().min(1).max(600).optional(),
  musicTrackId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().min(8).max(80),
});

export const UuidParam = z.string().uuid();
