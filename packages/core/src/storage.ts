import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutBucketPolicyCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { env, mediaSigningSecret, publicAppUrl } from "./env";
import { hmacSha256, safeEqual } from "./utils";

declare global {
  // eslint-disable-next-line no-var
  var __dreamS3: S3Client | undefined;
}

export function s3(): S3Client {
  if (!globalThis.__dreamS3) {
    const e = env();
    globalThis.__dreamS3 = new S3Client({
      region: e.S3_REGION,
      endpoint: e.S3_ENDPOINT,
      forcePathStyle: e.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: e.S3_ACCESS_KEY_ID, secretAccessKey: e.S3_SECRET_ACCESS_KEY },
    });
  }
  return globalThis.__dreamS3;
}

const bucket = () => env().S3_BUCKET;

/** Storage key layout — everything belonging to a user lives under `u/<userId>/` for easy deletion. */
export const keys = {
  userPrefix: (userId: string) => `u/${userId}/`,
  dreamPrefix: (userId: string, dreamId: string) => `u/${userId}/d/${dreamId}/`,
  audio: (userId: string, dreamId: string, ext: string) => `u/${userId}/d/${dreamId}/audio/original-${Date.now()}.${ext}`,
  media: (userId: string, dreamId: string, mediaId: string, ext: string) => `u/${userId}/d/${dreamId}/media/${mediaId}.${ext}`,
  thumb: (userId: string, dreamId: string, mediaId: string) => `u/${userId}/d/${dreamId}/media/${mediaId}.thumb.jpg`,
  userMusic: (userId: string, trackId: string, ext: string) => `u/${userId}/music/${trackId}.${ext}`,
  libraryMusic: (trackId: string, ext: string) => `library/music/${trackId}.${ext}`,
  libraryAsset: (name: string) => `library/assets/${name}`,
};

export async function ensureBucket(): Promise<void> {
  const client = s3();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket() }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket() }));
  }
  // Explicitly private: deny anonymous reads (MinIO honours bucket policies).
  try {
    await client.send(
      new PutBucketPolicyCommand({
        Bucket: bucket(),
        Policy: JSON.stringify({
          Version: "2012-10-17",
          Statement: [{ Effect: "Deny", Principal: "*", Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${bucket()}/*`], Condition: { StringEquals: { "aws:PrincipalType": "Anonymous" } } }],
        }),
      }),
    );
  } catch {
    /* Some S3-compatible providers do not support policies; buckets are private by default anyway. */
  }
}

export async function putObject(key: string, body: Buffer | Uint8Array | string, contentType: string): Promise<void> {
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }));
}

export async function uploadFile(key: string, filePath: string, contentType: string): Promise<{ size: number }> {
  const { size } = await stat(filePath);
  const upload = new Upload({
    client: s3(),
    params: { Bucket: bucket(), Key: key, Body: createReadStream(filePath), ContentType: contentType, ContentLength: size },
    queueSize: 3,
    partSize: 8 * 1024 * 1024,
  });
  await upload.done();
  return { size };
}

export async function uploadStream(key: string, body: Readable, contentType: string): Promise<void> {
  const upload = new Upload({ client: s3(), params: { Bucket: bucket(), Key: key, Body: body, ContentType: contentType } });
  await upload.done();
}

export async function getObjectStream(key: string, range?: string) {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key, Range: range }));
  return {
    body: res.Body as Readable,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
    contentRange: res.ContentRange,
    etag: res.ETag,
    lastModified: res.LastModified,
  };
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const bytes = await (res.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
  return Buffer.from(bytes);
}

export async function downloadToFile(key: string, filePath: string): Promise<void> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  await pipeline(res.Body as Readable, createWriteStream(filePath));
}

export async function headObject(key: string): Promise<{ size: number; contentType?: string } | null> {
  try {
    const res = await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return { size: res.ContentLength ?? 0, contentType: res.ContentType };
  } catch {
    return null;
  }
}

export async function deleteObjects(objectKeys: string[]): Promise<void> {
  const unique = [...new Set(objectKeys.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 1000) {
    const chunk = unique.slice(i, i + 1000);
    const res = await s3().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
    // DeleteObjects reports per-key failures in the body, not as an exception.
    const failed = (res.Errors ?? []).filter((e) => e.Code !== "NoSuchKey");
    if (failed.length > 0) throw new Error(`S3 delete failed for ${failed.length} object(s): ${failed[0]?.Code ?? "unknown"}`);
  }
}

export async function deletePrefix(prefix: string): Promise<number> {
  let token: string | undefined;
  let deleted = 0;
  do {
    const res = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }));
    const objectKeys = (res.Contents ?? []).map((o) => o.Key!).filter(Boolean);
    if (objectKeys.length > 0) {
      await deleteObjects(objectKeys);
      deleted += objectKeys.length;
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}

export async function presignGet(key: string, expiresInSec: number, downloadName?: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: downloadName ? `attachment; filename="${encodeURIComponent(downloadName)}"` : undefined,
    }),
    { expiresIn: expiresInSec },
  );
}

// ─── Signed app media URLs ──────────────────────────────────────────────────
// The bucket is private; clients receive short-lived HMAC-signed URLs to
// /api/media/<id>, which re-checks the signature and streams from S3.

export type MediaVariant = "file" | "thumb";

function signaturePayload(mediaId: string, variant: MediaVariant, exp: number, download: boolean): string {
  return `${mediaId}.${variant}.${exp}.${download ? 1 : 0}`;
}

export function signMediaUrl(mediaId: string, opts: { variant?: MediaVariant; ttlSec?: number; download?: boolean; absolute?: boolean } = {}): string {
  const variant = opts.variant ?? "file";
  const ttl = opts.ttlSec ?? 6 * 3600;
  // Round expiry to 10 minutes so URLs are cache-friendly within a session.
  const exp = Math.ceil((Date.now() / 1000 + ttl) / 600) * 600;
  const download = opts.download ?? false;
  const sig = hmacSha256(mediaSigningSecret(), signaturePayload(mediaId, variant, exp, download)).toString("base64url");
  const qs = new URLSearchParams({ v: variant, exp: String(exp), sig });
  if (download) qs.set("dl", "1");
  const path = `/api/media/${mediaId}?${qs.toString()}`;
  return opts.absolute ? `${publicAppUrl()}${path}` : path;
}

export function verifyMediaSignature(mediaId: string, params: URLSearchParams): { ok: boolean; variant: MediaVariant; download: boolean } {
  const variant = (params.get("v") === "thumb" ? "thumb" : "file") as MediaVariant;
  const exp = Number(params.get("exp"));
  const sig = params.get("sig") ?? "";
  const download = params.get("dl") === "1";
  if (!Number.isFinite(exp) || exp < Date.now() / 1000) return { ok: false, variant, download };
  const expected = hmacSha256(mediaSigningSecret(), signaturePayload(mediaId, variant, exp, download)).toString("base64url");
  return { ok: safeEqual(expected, sig), variant, download };
}

/** URL that external AI providers can fetch (needs a public HTTPS origin). */
export function providerAccessibleUrl(mediaId: string): string | null {
  const base = publicAppUrl();
  if (!base.startsWith("https://") || /localhost|127\.0\.0\.1/.test(base)) return null;
  return signMediaUrl(mediaId, { ttlSec: 3 * 3600, absolute: true });
}
