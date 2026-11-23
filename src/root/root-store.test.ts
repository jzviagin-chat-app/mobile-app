import { ApiError, SignedOutError } from '@/lib/api';
import type { StoredTokens } from '@/lib/token-storage';

import { RootStore } from './root-store';
import { memoryItem, testDeps } from './test-deps';

describe('RootStore', () => {
  it('starts loading; restore() ends signed out when nothing is saved', async () => {
    const root = new RootStore(testDeps());
    expect(root.auth.status).toBe('loading');
    await root.restore();
    expect(root.auth.status).toBe('signedOut');
    expect(root.login.step).toBe('phone');
    root.dispose();
  });

  it('restore() signs in from saved tokens without any request', async () => {
    const deps = testDeps({
      tokenStorage: memoryItem({ access: 'a', refresh: 'r', accessExpiresAt: 1 }),
    });
    const root = new RootStore(deps);
    await root.restore();
    expect(root.auth.status).toBe('signedIn');
    for (const call of Object.values(deps.fakeApi)) expect(call).not.toHaveBeenCalled();
    root.dispose();
  });

  it('the first launch after an install wipes what a previous install left (iOS Keychain)', async () => {
    const tokenStorage = memoryItem({ access: 'a', refresh: 'r', accessExpiresAt: 1 });
    const loginProgress = memoryItem({
      country: 'IL',
      step: 'code' as const,
      phone: '+972502345678',
      resendAvailableAt: null,
      codeExpiresAt: Date.now() + 60_000,
      codeState: 'active' as const,
      attemptsLeft: null,
      codeRetryAvailableAt: null,
      registrationToken: null,
      registrationExpiresAt: null,
    });
    const sendBlocks = memoryItem({
      all: null,
      numbers: [{ phone: '+972502345678', until: 1e15 }],
    });
    const root = new RootStore(
      testDeps({ tokenStorage, loginProgress, sendBlocks, isFirstLaunchAfterInstall: () => true }),
    );
    await root.restore();
    expect(root.auth.status).toBe('signedOut');
    expect(tokenStorage.value).toBeNull();
    expect(loginProgress.value).toBeNull();
    expect(sendBlocks.value).toBeNull();
    root.dispose();
  });

  it('a completed login switches the session to signed in', async () => {
    const tokenStorage = memoryItem<StoredTokens>();
    const deps = testDeps({ tokenStorage });
    deps.fakeApi.requestCode.mockResolvedValue({
      resend_after_seconds: 60,
      expires_in_seconds: 300,
    });
    deps.fakeApi.verifyCode.mockResolvedValue({
      status: 'logged_in',
      access_token: 'a',
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: 'r',
    });
    const root = new RootStore(deps);
    await root.restore();
    await root.login.requestCode('050-234-5678');
    await root.login.verifyCode('123456');
    expect(root.auth.status).toBe('signedIn');
    expect(tokenStorage.value).toMatchObject({ access: 'a', refresh: 'r' });
    root.dispose();
  });

  it('picks the app language from the phone', () => {
    const he = new RootStore(testDeps({ locales: [{ languageCode: 'he' }] }));
    const ru = new RootStore(testDeps({ locales: [{ languageCode: 'ru' }] }));
    expect(he.i18n.language).toBe('he');
    expect(ru.i18n.language).toBe('en');
    he.dispose();
    ru.dispose();
  });

  it('builds independent instances (no shared singletons between tests)', () => {
    const a = new RootStore(testDeps());
    const b = new RootStore(testDeps());
    expect(a.auth).not.toBe(b.auth);
    expect(a.queryClient).not.toBe(b.queryClient);
    a.dispose();
    b.dispose();
  });

  it('dispose() clears the server-data cache', () => {
    const root = new RootStore(testDeps());
    root.queryClient.setQueryData(['example'], { ok: true });
    root.dispose();
    expect(root.queryClient.getQueryData(['example'])).toBeUndefined();
  });

  describe('the session wiring', () => {
    const expired = { access: 'a1', refresh: 'r1', accessExpiresAt: 0 };

    it('a refused refresh during a call signs out and the phone step says why (dev detail too)', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const deps = testDeps({ tokenStorage: memoryItem(expired) });
      deps.fakeApi.refreshTokens.mockRejectedValueOnce(new ApiError(401, 'invalid_refresh_token'));
      const root = new RootStore(deps);
      await root.restore();
      const call = jest.fn();
      await expect(root.authorized(call)).rejects.toBeInstanceOf(SignedOutError);
      expect(call).not.toHaveBeenCalled();
      expect(root.auth.status).toBe('signedOut');
      expect(root.login.notice).toBe('session_ended');
      expect(root.login.noticeDetail).toMatch(
        /^refresh → 401 invalid_refresh_token · \d\d:\d\d:\d\d$/,
      );
      root.dispose();
    });

    it('403 account_blocked on a call signs out with its notice', async () => {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      const deps = testDeps({
        tokenStorage: memoryItem({ ...expired, accessExpiresAt: Date.now() + 600_000 }),
      });
      const root = new RootStore(deps);
      await root.restore();
      const blocked = new ApiError(403, 'account_blocked');
      await expect(root.authorized(() => Promise.reject(blocked))).rejects.toBe(blocked);
      await Promise.resolve();
      expect(root.auth.status).toBe('signedOut');
      expect(root.login.notice).toBe('account_blocked');
      root.dispose();
    });
  });
});
