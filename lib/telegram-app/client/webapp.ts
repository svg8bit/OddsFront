"use client";

/**
 * The parts of `window.Telegram.WebApp` (https://core.telegram.org/bots/webapps) the OddsFront Mini App
 * uses. Everything is optional: older Telegram clients miss newer objects, and a plain browser has none.
 */

type StorageCallback<T> = (error: string | null, value?: T) => void;

export type TelegramKeyStorage = {
  setItem: (key: string, value: string, callback?: StorageCallback<boolean>) => void;
  getItem: (key: string, callback: StorageCallback<string | null>) => void;
  removeItem?: (key: string, callback?: StorageCallback<boolean>) => void;
  /** SecureStorage only: bring back a value that existed on this device before a reinstall. */
  restoreItem?: (key: string, callback?: StorageCallback<string | null>) => void;
};

export type TelegramWebApp = {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { language_code?: string; first_name?: string } };
  platform: string;
  version: string;
  colorScheme?: "light" | "dark";
  isVersionAtLeast?: (version: string) => boolean;
  ready: () => void;
  expand?: () => void;
  close?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  disableVerticalSwipes?: () => void;
  openLink?: (url: string) => void;
  openTelegramLink?: (url: string) => void;
  showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
    notificationOccurred: (type: "error" | "success" | "warning") => void;
    selectionChanged: () => void;
  };
  BackButton?: { show: () => void; hide: () => void; onClick: (handler: () => void) => void; offClick: (handler: () => void) => void };
  SecureStorage?: TelegramKeyStorage;
  DeviceStorage?: TelegramKeyStorage;
  /** Per-user storage synced across the player's devices (public data only: the owner address). */
  CloudStorage?: TelegramKeyStorage;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function telegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const app = window.Telegram?.WebApp;
  // Telegram's script also defines WebApp in a plain browser; only a real client hands over initData.
  return app && app.initData ? app : null;
}

export function haptic(kind: "success" | "error" | "warning" | "tap" | "select") {
  const feedback = telegramWebApp()?.HapticFeedback;
  if (!feedback) return;
  try {
    if (kind === "tap") feedback.impactOccurred("light");
    else if (kind === "select") feedback.selectionChanged();
    else feedback.notificationOccurred(kind);
  } catch {
    // Haptics are a nicety; an old client without them still works.
  }
}

export function confirmInTelegram(message: string): Promise<boolean> {
  const app = telegramWebApp();
  if (!app?.showConfirm) return Promise.resolve(typeof window !== "undefined" ? window.confirm(message) : false);
  return new Promise((resolve) => app.showConfirm?.(message, (confirmed) => resolve(Boolean(confirmed))));
}

/** Telegram CloudStorage read; null when the client has none or refuses. */
export function cloudGet(key: string): Promise<string | null> {
  const storage = telegramWebApp()?.CloudStorage;
  if (!storage) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      storage.getItem(key, (error, value) => resolve(error ? null : value || null));
    } catch {
      resolve(null);
    }
  });
}

export function cloudSet(key: string, value: string): Promise<boolean> {
  const storage = telegramWebApp()?.CloudStorage;
  if (!storage) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      storage.setItem(key, value, (error) => resolve(!error));
    } catch {
      resolve(false);
    }
  });
}
