import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { createSecureItem } from './secure-item';
import { createTokenStorage, tokensFromReply } from './token-storage';

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'after-first-unlock-this-device-only',
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
    __store: store,
  };
});

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => store.clear());

describe('createSecureItem', () => {
  const item = createSecureItem('thing', z.object({ n: z.number() }));

  it('round-trips a value as JSON', async () => {
    await item.save({ n: 1 });
    expect(store.get('thing')).toBe('{"n":1}');
    await expect(item.load()).resolves.toEqual({ n: 1 });
  });

  it('returns null when nothing is saved', async () => {
    await expect(item.load()).resolves.toBeNull();
  });

  it('drops corrupt or outdated data instead of crashing', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    store.set('thing', 'not json');
    await expect(item.load()).resolves.toBeNull();
    expect(store.has('thing')).toBe(false);

    store.set('thing', '{"n":"one"}');
    await expect(item.load()).resolves.toBeNull();
    expect(store.has('thing')).toBe(false);
    expect(warn).toHaveBeenCalledWith('Discarding unreadable secure item', { key: 'thing' });
  });

  it('uses this-device-only keychain access (no backups, no other phone)', async () => {
    await item.save({ n: 1 });
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('thing', '{"n":1}', {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  });

  it('clear removes the value', async () => {
    await item.save({ n: 1 });
    await item.clear();
    await expect(item.load()).resolves.toBeNull();
  });
});

describe('token storage', () => {
  it('saves the session tokens under one key', async () => {
    const storage = createTokenStorage();
    await storage.save({ access: 'a', refresh: 'r', accessExpiresAt: 1 });
    expect([...store.keys()]).toEqual(['session']);
    await expect(storage.load()).resolves.toEqual({
      access: 'a',
      refresh: 'r',
      accessExpiresAt: 1,
    });
  });

  it('measures the access expiry on the phone clock from expires_in', () => {
    expect(
      tokensFromReply({ access_token: 'a', refresh_token: 'r', expires_in: 900 }, 1_000),
    ).toEqual({ access: 'a', refresh: 'r', accessExpiresAt: 901_000 });
  });
});
