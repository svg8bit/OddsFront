"use client";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { TelegramKeyStorage, TelegramWebApp } from "./webapp.ts";

/**
 * The Telegram wallet's owner key lives only on the player's device: Telegram SecureStorage (iOS Keychain /
 * Android Keystore) on phones, Telegram DeviceStorage on clients without it (Telegram Desktop). OddsFront's
 * servers only ever see the public address.
 */

const KEY_NAME = "of_tg_owner_key_v1";
const PRIVATE_KEY = /^0x[0-9a-f]{64}$/;

export type DeviceKeyStore = {
  kind: "secure" | "device";
  storage: TelegramKeyStorage;
};

export type DeviceKey = {
  privateKey: `0x${string}`;
  address: `0x${string}`;
};

/** Key stores this client exposes, best first (an exposed store may still answer UNSUPPORTED). */
export function deviceKeyStores(app: TelegramWebApp | null): DeviceKeyStore[] {
  if (!app) return [];
  const at = (version: string) => app.isVersionAtLeast?.(version) ?? false;
  if (!at("9.0")) return [];
  const stores: DeviceKeyStore[] = [];
  if (app.SecureStorage) stores.push({ kind: "secure", storage: app.SecureStorage });
  if (app.DeviceStorage) stores.push({ kind: "device", storage: app.DeviceStorage });
  return stores;
}

/**
 * The first store that actually works on this device. Telegram Desktop exposes SecureStorage but
 * answers every call with UNSUPPORTED (it exists on iOS and Android only), so each store is probed.
 */
export async function pickDeviceKeyStore(stores: DeviceKeyStore[]): Promise<DeviceKeyStore | null> {
  for (const store of stores) {
    try {
      await call<string | null>((callback) => store.storage.getItem(KEY_NAME, callback));
      return store;
    } catch {
      // UNSUPPORTED (or a broken client): try the next store.
    }
  }
  return null;
}

function call<T>(run: (callback: (error: string | null, value?: T) => void) => void) {
  return new Promise<T | undefined>((resolve, reject) => {
    try {
      run((error, value) => (error ? reject(new Error(String(error))) : resolve(value)));
    } catch (error) {
      reject(error);
    }
  });
}

function toDeviceKey(value: unknown): DeviceKey | null {
  const privateKey = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!PRIVATE_KEY.test(privateKey)) return null;
  return { privateKey: privateKey as `0x${string}`, address: privateKeyToAccount(privateKey as `0x${string}`).address };
}

export async function loadDeviceKey(store: DeviceKeyStore): Promise<DeviceKey | null> {
  const stored = await call<string | null>((callback) => store.storage.getItem(KEY_NAME, callback)).catch(() => null);
  const key = toDeviceKey(stored);
  if (key || store.kind !== "secure" || !store.storage.restoreItem) return key;
  // After a reinstall SecureStorage keeps the Keychain entry but asks the player to restore it.
  const restored = await call<string | null>((callback) => store.storage.restoreItem?.(KEY_NAME, callback)).catch(() => null);
  return toDeviceKey(restored);
}

export async function saveDeviceKey(store: DeviceKeyStore, privateKey: `0x${string}`) {
  const key = toDeviceKey(privateKey);
  if (!key) throw new Error("This key is not a valid wallet key.");
  await call<boolean>((callback) => store.storage.setItem(KEY_NAME, key.privateKey, callback));
  const check = await loadDeviceKey(store);
  if (check?.privateKey !== key.privateKey) throw new Error("Telegram could not save the wallet key on this device.");
  return key;
}

export async function createDeviceKey(store: DeviceKeyStore) {
  return saveDeviceKey(store, generatePrivateKey());
}

/** Accept a pasted key with or without the 0x prefix. */
export function parsePastedKey(value: string): `0x${string}` | null {
  const trimmed = value.trim().toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(trimmed) ? (`0x${trimmed}` as `0x${string}`) : null;
}
