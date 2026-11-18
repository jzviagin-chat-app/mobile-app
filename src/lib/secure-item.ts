import * as SecureStore from 'expo-secure-store';
import type { z } from 'zod';

import { log } from './log';

/**
 * One JSON value in secure storage (iOS Keychain / Android Keystore). Readable after the phone's first
 * unlock (background work later), never backed up or moved to another phone.
 */
export type SecureItem<T> = {
  load(): Promise<T | null>;
  save(value: T): Promise<void>;
  clear(): Promise<void>;
};

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export function createSecureItem<T>(key: string, schema: z.ZodType<T>): SecureItem<T> {
  return {
    async load() {
      const raw = await SecureStore.getItemAsync(key, options);
      if (raw === null) return null;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = undefined;
      }
      const result = schema.safeParse(parsed);
      if (result.success) return result.data;
      // Corrupt or from an older app version: drop it rather than crash (never log the value).
      log.warn('Discarding unreadable secure item', { key });
      await SecureStore.deleteItemAsync(key, options);
      return null;
    },
    async save(value) {
      await SecureStore.setItemAsync(key, JSON.stringify(value), options);
    },
    async clear() {
      await SecureStore.deleteItemAsync(key, options);
    },
  };
}
