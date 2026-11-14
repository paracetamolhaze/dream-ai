"use client";

import { canDownloadFile, downloadFile } from "./telegram";

export type DownloadOutcome = "telegram" | "browser" | "declined";

/**
 * Downloads a file: Telegram's native download sheet (Bot API 8.0+) inside
 * Telegram, a regular `<a download>` elsewhere. URLs are server-signed.
 */
export async function downloadMedia(url: string, fileName: string): Promise<DownloadOutcome> {
  if (canDownloadFile()) {
    const accepted = await downloadFile(url, fileName);
    return accepted ? "telegram" : "declined";
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return "browser";
}
