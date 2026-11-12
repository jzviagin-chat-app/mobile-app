// Fakes for tests: a RootStore built from these touches no network, no secure storage and no device APIs.
import type { LoginProgress, SendBlocks } from '@/features/auth';
import type { AuthApi } from '@/lib/api';
import type { Clock } from '@/lib/clock';
import type { SecureItem } from '@/lib/secure-item';
import type { StoredTokens } from '@/lib/token-storage';

import type { RootStoreDeps } from './root-store';

/** An in-memory SecureItem (what expo-secure-store holds, without the phone). */
export type MemoryItem<T> = {
  value: T | null;
  load: jest.Mock<Promise<T | null>, []>;
  save: jest.Mock<Promise<void>, [T]>;
  clear: jest.Mock<Promise<void>, []>;
};

export function memoryItem<T>(initial: T | null = null): MemoryItem<T> & SecureItem<T> {
  const item: MemoryItem<T> = {
    value: initial,
    load: jest.fn(async () => item.value),
    save: jest.fn(async (value: T) => {
      item.value = value;
    }),
    clear: jest.fn(async () => {
      item.value = null;
    }),
  };
  return item;
}

/** Every API call is a jest.fn; a test sets the answers it needs (unset calls reject loudly). */
export function fakeApi(): { [K in keyof AuthApi]: jest.Mock } {
  const unexpected = (name: string) =>
    jest.fn(() => Promise.reject(new Error(`Unexpected API call: ${name}`)));
  return {
    requestCode: unexpected('requestCode'),
    verifyCode: unexpected('verifyCode'),
    register: unexpected('register'),
    logout: jest.fn(() => Promise.resolve()),
  };
}

/** A clock reading Date.now (jest fake timers control it) without ticking. */
export const testClock: Clock = {
  get now() {
    return Date.now();
  },
};

/**
 * A full set of fake dependencies. Unless overridden, the storage is in memory and readable in tests
 * (`deps.tokenStorage.value`, `deps.loginProgress.value`).
 */
export function testDeps(overrides: Partial<RootStoreDeps> = {}) {
  const api = fakeApi();
  const deps = {
    locales: [{ languageCode: 'en' }],
    api: api as unknown as AuthApi,
    tokenStorage: memoryItem<StoredTokens>(),
    loginProgress: memoryItem<LoginProgress>(),
    sendBlocks: memoryItem<SendBlocks>(),
    device: { platform: 'android', name: 'Test phone' },
    clock: testClock,
    isFirstLaunchAfterInstall: () => false,
  };
  return { ...deps, ...overrides, fakeApi: api } as typeof deps &
    RootStoreDeps & { fakeApi: typeof api };
}
