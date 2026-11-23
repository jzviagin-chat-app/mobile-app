import { ApiError, NetworkError, SignedOutError, type LoggedIn } from '@/lib/api';
import type { StoredTokens } from '@/lib/token-storage';
import { memoryItem } from '@/root/test-deps';

import { AuthStore } from './auth-store';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

/** Signed in with an access token that has `msLeft` to live. */
function tokensFor(msLeft: number, n = 1): StoredTokens {
  return { access: `access-${n}`, refresh: `refresh-${n}`, accessExpiresAt: NOW + msLeft };
}

function reply(n: number): LoggedIn {
  return {
    status: 'logged_in',
    access_token: `access-${n}`,
    token_type: 'Bearer',
    expires_in: 900,
    refresh_token: `refresh-${n}`,
  };
}

/** A promise the test resolves or rejects when it wants. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function setup(saved: StoredTokens | null = null) {
  const tokenStorage = memoryItem<StoredTokens>(saved);
  const api = {
    logout: jest.fn((_access: string) => Promise.resolve()),
    refreshTokens: jest.fn((_refresh: string): Promise<LoggedIn> => Promise.resolve(reply(2))),
  };
  const clock = { now: NOW };
  const onSessionEnded = jest.fn();
  const auth = new AuthStore({ tokenStorage, api, clock, onSessionEnded });
  await auth.restore();
  return { auth, tokenStorage, api, clock, onSessionEnded };
}

/** Lets queued promise callbacks run (fake API calls answer at once). */
const settle = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('AuthStore: the session', () => {
  it('is loading until restored', () => {
    const auth = new AuthStore({
      tokenStorage: memoryItem<StoredTokens>(),
      api: { logout: jest.fn(), refreshTokens: jest.fn() },
      clock: { now: NOW },
      onSessionEnded: jest.fn(),
    });
    expect(auth.status).toBe('loading');
  });

  it('restores signed in from saved tokens without any request, also with an expired access token', async () => {
    const { auth, api } = await setup(tokensFor(-10 * MIN));
    expect(auth.status).toBe('signedIn');
    expect(api.logout).not.toHaveBeenCalled();
    expect(api.refreshTokens).not.toHaveBeenCalled();
  });

  it('restores signed out when nothing is saved', async () => {
    const { auth } = await setup();
    expect(auth.status).toBe('signedOut');
  });

  it('restores signed out when storage fails', async () => {
    const tokenStorage = memoryItem<StoredTokens>();
    tokenStorage.load.mockRejectedValueOnce(new Error('keystore'));
    const auth = new AuthStore({
      tokenStorage,
      api: { logout: jest.fn(), refreshTokens: jest.fn() },
      clock: { now: NOW },
      onSessionEnded: jest.fn(),
    });
    await auth.restore();
    expect(auth.status).toBe('signedOut');
  });

  it('completeLogin saves the tokens before switching to signed in', async () => {
    const { auth, tokenStorage } = await setup();
    let signedInWhenSaved: boolean | undefined;
    tokenStorage.save.mockImplementationOnce(async (value: StoredTokens) => {
      signedInWhenSaved = auth.isSignedIn;
      tokenStorage.value = value;
    });
    await auth.completeLogin(tokensFor(15 * MIN));
    expect(signedInWhenSaved).toBe(false);
    expect(tokenStorage.value).toEqual(tokensFor(15 * MIN));
    expect(auth.status).toBe('signedIn');
  });
});

describe('AuthStore: refresh before a call', () => {
  it('uses the saved access token while it has more than 60 s left', async () => {
    const { auth, api } = await setup(tokensFor(MIN + 1));
    await expect(auth.freshAccessToken()).resolves.toBe('access-1');
    expect(api.refreshTokens).not.toHaveBeenCalled();
  });

  it('refreshes when 60 s or less are left, and saves the new tokens before returning them', async () => {
    const { auth, api, tokenStorage } = await setup(tokensFor(MIN));
    let savedBeforeUse: StoredTokens | null = null;
    tokenStorage.save.mockImplementationOnce(async (value: StoredTokens) => {
      savedBeforeUse = value;
      expect(auth.tokens?.access).toBe('access-1'); // not used yet
      tokenStorage.value = value;
    });
    await expect(auth.freshAccessToken()).resolves.toBe('access-2');
    expect(api.refreshTokens).toHaveBeenCalledWith('refresh-1');
    expect(savedBeforeUse).toEqual({
      access: 'access-2',
      refresh: 'refresh-2',
      accessExpiresAt: NOW + 900_000,
    });
    expect(auth.tokens).toEqual(tokenStorage.value);
  });

  it('counts the new expiry from when the request was sent, not when the reply came', async () => {
    const { auth, api, clock } = await setup(tokensFor(0));
    const answer = deferred<LoggedIn>();
    api.refreshTokens.mockReturnValueOnce(answer.promise);
    const token = auth.freshAccessToken();
    clock.now = NOW + 10_000; // a slow reply
    answer.resolve(reply(2));
    await token;
    expect(auth.tokens?.accessExpiresAt).toBe(NOW + 900_000);
  });

  it('sends one refresh at a time: callers arriving meanwhile get the same result', async () => {
    const { auth, api } = await setup(tokensFor(0));
    const answer = deferred<LoggedIn>();
    api.refreshTokens.mockReturnValueOnce(answer.promise);
    const all = Promise.all([
      auth.freshAccessToken(),
      auth.freshAccessToken(),
      auth.freshAccessToken(),
    ]);
    answer.resolve(reply(2));
    await expect(all).resolves.toEqual(['access-2', 'access-2', 'access-2']);
    expect(api.refreshTokens).toHaveBeenCalledTimes(1);
    // The next refresh is a new one.
    await auth.refresh();
    expect(api.refreshTokens).toHaveBeenCalledTimes(2);
    expect(api.refreshTokens).toHaveBeenLastCalledWith('refresh-2');
  });

  it('a failed save keeps the old tokens; the next refresh sends the old refresh token again', async () => {
    const { auth, api, tokenStorage } = await setup(tokensFor(0));
    tokenStorage.save.mockRejectedValueOnce(new Error('keystore'));
    await expect(auth.freshAccessToken()).rejects.toThrow('keystore');
    expect(auth.tokens).toEqual(tokensFor(0));
    expect(tokenStorage.value).toEqual(tokensFor(0));
    await expect(auth.freshAccessToken()).resolves.toBe('access-2');
    expect(api.refreshTokens.mock.calls).toEqual([['refresh-1'], ['refresh-1']]);
  });

  it.each([
    ['offline', new NetworkError('offline')],
    ['a timeout', new NetworkError('timeout')],
    ['503 tokens_unavailable', new ApiError(503, 'tokens_unavailable')],
    ['500', new ApiError(500, 'internal_error')],
  ])('%s keeps the tokens and passes the error on (never signs out)', async (_name, error) => {
    const { auth, api, tokenStorage, onSessionEnded } = await setup(tokensFor(0));
    api.refreshTokens.mockRejectedValueOnce(error);
    await expect(auth.freshAccessToken()).rejects.toBe(error);
    expect(auth.status).toBe('signedIn');
    expect(tokenStorage.value).toEqual(tokensFor(0));
    expect(onSessionEnded).not.toHaveBeenCalled();
    await expect(auth.freshAccessToken()).resolves.toBe('access-2'); // retried with the same token
    expect(api.refreshTokens).toHaveBeenLastCalledWith('refresh-1');
  });

  it.each([
    ['session_ended', new ApiError(401, 'invalid_refresh_token')],
    ['account_blocked', new ApiError(403, 'account_blocked')],
  ])('a refused refresh signs out (%s), with a debug detail', async (reason, error) => {
    const { auth, api, tokenStorage, onSessionEnded } = await setup(tokensFor(0));
    api.refreshTokens.mockRejectedValueOnce(error);
    await expect(auth.freshAccessToken()).rejects.toBeInstanceOf(SignedOutError);
    expect(auth.status).toBe('signedOut');
    expect(tokenStorage.value).toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
    const time = new Date(NOW).toTimeString().slice(0, 8);
    expect(onSessionEnded).toHaveBeenCalledWith(
      reason,
      `refresh → ${error.status} ${error.code} · ${time}`,
    );
  });

  it('without a session there is no token and no request', async () => {
    const { auth, api } = await setup();
    await expect(auth.freshAccessToken()).rejects.toBeInstanceOf(SignedOutError);
    expect(api.refreshTokens).not.toHaveBeenCalled();
  });

  it('a reply arriving after sign-out is dropped: nothing saved, still signed out', async () => {
    const { auth, api, tokenStorage } = await setup(tokensFor(0));
    const answer = deferred<LoggedIn>();
    api.refreshTokens.mockReturnValueOnce(answer.promise);
    const token = auth.freshAccessToken();
    await auth.signOut();
    answer.resolve(reply(2));
    await expect(token).rejects.toBeInstanceOf(SignedOutError);
    expect(auth.tokens).toBeNull();
    expect(tokenStorage.value).toBeNull();
  });

  it('signed out while the new tokens are being saved: storage ends empty', async () => {
    const { auth, tokenStorage } = await setup(tokensFor(0));
    const saving = deferred<void>();
    tokenStorage.save.mockImplementationOnce(async (value: StoredTokens) => {
      await saving.promise;
      tokenStorage.value = value;
    });
    const token = auth.freshAccessToken();
    await settle();
    await auth.signOut();
    saving.resolve();
    await expect(token).rejects.toBeInstanceOf(SignedOutError);
    expect(tokenStorage.value).toBeNull();
  });
});

describe('AuthStore: after 401 invalid_token', () => {
  it('refreshes when the rejected token is still the current one', async () => {
    const { auth, api } = await setup(tokensFor(10 * MIN));
    await expect(auth.renewAfterRejection('access-1')).resolves.toBe('access-2');
    expect(api.refreshTokens).toHaveBeenCalledTimes(1);
  });

  it('just returns the new token when it changed meanwhile', async () => {
    const { auth, api } = await setup(tokensFor(10 * MIN, 2));
    await expect(auth.renewAfterRejection('access-1')).resolves.toBe('access-2');
    expect(api.refreshTokens).not.toHaveBeenCalled();
  });
});

describe('AuthStore: endSession (403 account_blocked on a call)', () => {
  it('signs out with the reason, without a logout call; a second one changes nothing', async () => {
    const { auth, api, tokenStorage, onSessionEnded } = await setup(tokensFor(10 * MIN));
    await auth.endSession('account_blocked', 'request', new ApiError(403, 'account_blocked'));
    await auth.endSession('account_blocked', 'request', new ApiError(403, 'account_blocked'));
    expect(auth.status).toBe('signedOut');
    expect(tokenStorage.value).toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
    expect(onSessionEnded).toHaveBeenCalledTimes(1);
    expect(onSessionEnded.mock.calls[0]?.[1]).toMatch(/^request → 403 account_blocked · /);
  });
});

describe('AuthStore: signOut', () => {
  it('clears at once and tells the server with a still-valid access token', async () => {
    const { auth, tokenStorage, api } = await setup(tokensFor(10 * MIN));
    await auth.signOut();
    expect(auth.status).toBe('signedOut');
    expect(tokenStorage.value).toBeNull();
    await settle();
    expect(api.refreshTokens).not.toHaveBeenCalled();
    expect(api.logout).toHaveBeenCalledWith('access-1');
  });

  it('with an expired access token, refreshes first (nothing saved) and logs out with the new one', async () => {
    const { auth, tokenStorage, api } = await setup(tokensFor(-5 * MIN));
    await auth.signOut();
    await settle();
    expect(api.refreshTokens).toHaveBeenCalledWith('refresh-1');
    expect(api.logout).toHaveBeenCalledWith('access-2');
    expect(tokenStorage.value).toBeNull();
    expect(auth.tokens).toBeNull();
  });

  it('still signs out locally when the server calls fail', async () => {
    const { auth, tokenStorage, api } = await setup(tokensFor(-5 * MIN));
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});
    api.refreshTokens.mockRejectedValueOnce(new NetworkError('offline'));
    await auth.signOut();
    await settle();
    expect(auth.status).toBe('signedOut');
    expect(tokenStorage.value).toBeNull();
    expect(api.logout).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      'Logout request failed; signed out locally',
      expect.anything(),
    );
  });
});
