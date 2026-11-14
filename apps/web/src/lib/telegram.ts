"use client";

/**
 * Thin typed wrapper around the official Telegram Mini Apps SDK
 * (`telegram-web-app.js`, window.Telegram.WebApp). Every call is guarded by
 * `isVersionAtLeast` so older clients never hit unsupported methods, and
 * everything degrades gracefully in a regular browser.
 */

export type InvoiceStatus = "paid" | "cancelled" | "failed" | "pending";
type ImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
type NotificationType = "error" | "success" | "warning";

interface BackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface HapticFeedback {
  impactOccurred(style: ImpactStyle): void;
  notificationOccurred(type: NotificationType): void;
  selectionChanged(): void;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string; photo_url?: string; allows_write_to_pm?: boolean };
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  BackButton: BackButton;
  HapticFeedback: HapticFeedback;
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  openLink(url: string, options?: { try_instant_view?: boolean }): void;
  openTelegramLink(url: string): void;
  openInvoice(url: string, callback?: (status: InvoiceStatus) => void): void;
  shareMessage?(msgId: string, callback?: (sent: boolean) => void): void;
  downloadFile?(params: { url: string; file_name: string }, callback?: (accepted: boolean) => void): void;
  requestWriteAccess?(callback?: (granted: boolean) => void): void;
  showConfirm?(message: string, callback?: (ok: boolean) => void): void;
  onEvent(event: string, cb: (...args: unknown[]) => void): void;
  offEvent(event: string, cb: (...args: unknown[]) => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/** True only when opened inside a Telegram client (initData present). */
export function isInTelegram(): boolean {
  const wa = getWebApp();
  return Boolean(wa && typeof wa.initData === "string" && wa.initData.length > 0);
}

export function supports(version: string): boolean {
  const wa = getWebApp();
  if (!wa || !isInTelegram() || typeof wa.isVersionAtLeast !== "function") return false;
  try {
    return wa.isVersionAtLeast(version);
  } catch {
    return false;
  }
}

function call(fn: () => void): void {
  try {
    fn();
  } catch {
    /* unsupported in this client */
  }
}

/** One-time Mini App setup: ready, expand, colours, no accidental swipe-to-close. */
export function initTelegram(background: string): void {
  const wa = getWebApp();
  if (!wa || !isInTelegram()) return;
  call(() => wa.ready());
  call(() => wa.expand());
  if (supports("6.1")) {
    call(() => wa.setHeaderColor(background));
    call(() => wa.setBackgroundColor(background));
  }
  if (supports("7.10")) call(() => wa.setBottomBarColor?.(background));
  if (supports("7.7")) call(() => wa.disableVerticalSwipes?.());
}

export const haptic = {
  impact(style: ImpactStyle = "light") {
    if (supports("6.1")) call(() => getWebApp()!.HapticFeedback.impactOccurred(style));
  },
  notify(type: NotificationType) {
    if (supports("6.1")) call(() => getWebApp()!.HapticFeedback.notificationOccurred(type));
  },
  select() {
    if (supports("6.1")) call(() => getWebApp()!.HapticFeedback.selectionChanged());
  },
};

export function openTelegramLink(url: string): void {
  const wa = getWebApp();
  if (wa && isInTelegram() && /^https:\/\/t\.me\//.test(url)) {
    call(() => wa.openTelegramLink(url));
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function openExternalLink(url: string): void {
  const wa = getWebApp();
  if (wa && isInTelegram() && supports("6.1")) {
    call(() => wa.openLink(url));
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Asks for confirmation before the Mini App is closed (e.g. while a recording is unsaved). */
export function setClosingConfirmation(enabled: boolean): void {
  const wa = getWebApp();
  if (!wa || !supports("6.2")) return;
  call(() => (enabled ? wa.enableClosingConfirmation?.() : wa.disableClosingConfirmation?.()));
}

export function closeApp(): void {
  const wa = getWebApp();
  if (wa && isInTelegram()) call(() => wa.close());
}

export function canPayInTelegram(): boolean {
  return supports("6.1");
}

export function openInvoice(url: string): Promise<InvoiceStatus> {
  return new Promise((resolve) => {
    const wa = getWebApp();
    if (!wa || !canPayInTelegram()) {
      resolve("failed");
      return;
    }
    try {
      wa.openInvoice(url, (status) => resolve(status));
    } catch {
      resolve("failed");
    }
  });
}

export function canShareMessage(): boolean {
  return supports("8.0") && typeof getWebApp()?.shareMessage === "function";
}

export function shareMessage(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wa = getWebApp();
    if (!wa || !canShareMessage()) {
      resolve(false);
      return;
    }
    try {
      wa.shareMessage!(id, (sent) => resolve(Boolean(sent)));
    } catch {
      resolve(false);
    }
  });
}

export function canDownloadFile(): boolean {
  return supports("8.0") && typeof getWebApp()?.downloadFile === "function";
}

export function downloadFile(url: string, fileName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const wa = getWebApp();
    if (!wa || !canDownloadFile()) {
      resolve(false);
      return;
    }
    try {
      wa.downloadFile!({ url, file_name: fileName }, (accepted) => resolve(Boolean(accepted)));
    } catch {
      resolve(false);
    }
  });
}

export function canRequestWriteAccess(): boolean {
  return supports("6.9") && typeof getWebApp()?.requestWriteAccess === "function";
}

export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    const wa = getWebApp();
    if (!wa || !canRequestWriteAccess()) {
      resolve(false);
      return;
    }
    try {
      wa.requestWriteAccess!((granted) => resolve(Boolean(granted)));
    } catch {
      resolve(false);
    }
  });
}

/** Telegram user's language before the profile is loaded. */
export function telegramLanguage(): string | undefined {
  return getWebApp()?.initDataUnsafe?.user?.language_code;
}

export function allowsWriteToPm(): boolean {
  return Boolean(getWebApp()?.initDataUnsafe?.user?.allows_write_to_pm);
}
