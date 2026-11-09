import { memoryItem } from '@/root/test-deps';
import type { StoredTokens } from '@/lib/token-storage';

import { AuthStore } from './auth-store';

const tokens: StoredTokens = { access: 'access-1', refresh: 'refresh-1', accessExpiresAt: 1 };

function setup(saved: StoredTokens | null = null) {
  const tokenStorage = memoryItem<StoredTokens>(saved);
  const api = { logout: jest.fn(() => Promise.resolve()) };
  return { auth: new AuthStore({ tokenStorage, api }), tokenStorage, api };
}

describe('AuthStore', () => {
  it('is loading until restored', () => {
    expect(setup().auth.status).toBe('loading');
  });

  it('restores signed in from saved tokens, without any request', async () => {
    const { auth, api } = setup(tokens);
    await auth.restore();
    expect(auth.status).toBe('signedIn');
    expect(auth.tokens).toEqual(tokens);
    expect(api.logout).not.toHaveBeenCalled();
  });

  it('restores signed out when nothing is saved', async () => {
    const { auth } = setup();
    await auth.restore();
    expect(auth.status).toBe('signedOut');
  });

  it('restores signed out when storage fails', async () => {
    const { auth, tokenStorage } = setup();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    tokenStorage.load.mockRejectedValueOnce(new Error('keystore'));
    await auth.restore();
    expect(auth.status).toBe('signedOut');
  });

  it('isSignedIn follows the tokens', async () => {
    const { auth } = setup();
    await auth.restore();
    await auth.completeLogin(tokens);
    expect(auth.isSignedIn).toBe(true);
    await auth.signOut();
    expect(auth.isSignedIn).toBe(false);
  });

  it('completeLogin saves the tokens before switching to signed in', async () => {
    const { auth, tokenStorage } = setup();
    await auth.restore();
    let signedInWhenSaved: boolean | undefined;
    tokenStorage.save.mockImplementationOnce(async (value: StoredTokens) => {
      signedInWhenSaved = auth.isSignedIn;
      tokenStorage.value = value;
    });
    await auth.completeLogin(tokens);
    expect(signedInWhenSaved).toBe(false);
    expect(tokenStorage.value).toEqual(tokens);
    expect(auth.status).toBe('signedIn');
  });

  it('signOut clears at once and tells the server with the access token', async () => {
    const { auth, tokenStorage, api } = setup(tokens);
    await auth.restore();
    await auth.signOut();
    expect(auth.status).toBe('signedOut');
    expect(tokenStorage.value).toBeNull();
    expect(api.logout).toHaveBeenCalledWith('access-1');
  });

  it('signOut still signs out locally when the server call fails', async () => {
    const { auth, tokenStorage, api } = setup(tokens);
    jest.spyOn(console, 'info').mockImplementation(() => {});
    api.logout.mockRejectedValueOnce(new Error('offline'));
    await auth.restore();
    await auth.signOut();
    expect(auth.status).toBe('signedOut');
    expect(tokenStorage.value).toBeNull();
  });
});
