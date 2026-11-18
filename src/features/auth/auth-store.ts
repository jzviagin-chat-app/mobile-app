import { flow, makeAutoObservable } from 'mobx';

import type { AuthApi } from '@/lib/api';
import { log } from '@/lib/log';
import type { StoredTokens, TokenStorage } from '@/lib/token-storage';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export type AuthStoreDeps = {
  tokenStorage: TokenStorage;
  api: Pick<AuthApi, 'logout'>;
};

/**
 * The session: who is signed in on this phone. Signed in = we hold tokens (`isSignedIn` is computed from
 * them). The root layout shows the (app) or auth routes from `status`.
 *
 * Auto login sends no request: saved tokens mean signed in, also offline. Token refresh comes in step 3:
 * before each logged-in request if the access token expires within 60 s, and on 401 invalid_token
 * (README §7).
 */
export class AuthStore {
  tokens: StoredTokens | null = null;
  /** False until secure storage has been read once (the splash screen stays up until then). */
  restored = false;

  private readonly deps: AuthStoreDeps;

  constructor(deps: AuthStoreDeps) {
    this.deps = deps;
    makeAutoObservable<this, 'deps'>(this, { deps: false }, { autoBind: true });
  }

  get isSignedIn(): boolean {
    return this.tokens !== null;
  }

  get status(): AuthStatus {
    if (!this.restored) return 'loading';
    return this.isSignedIn ? 'signedIn' : 'signedOut';
  }

  /** Called once at startup: the saved tokens, if any. */
  restore = flow(function* (this: AuthStore) {
    try {
      this.tokens = yield this.deps.tokenStorage.load();
    } catch {
      log.error('Could not read the saved session');
      this.tokens = null;
    }
    this.restored = true;
  });

  /** After otp/verify or register: tokens are saved first, then the app switches to signed in. */
  completeLogin = flow(function* (this: AuthStore, tokens: StoredTokens) {
    yield this.deps.tokenStorage.save(tokens);
    this.tokens = tokens;
  });

  /**
   * Signs out at once on the phone, then tells the server (POST /auth/logout). Not waiting for the server
   * means no spinner and no dependence on the network; if logout fails (offline, or 401 for an expired
   * access token until refresh exists), the device stays active on the server until the next SMS login
   * replaces it.
   */
  signOut = flow(function* (this: AuthStore) {
    const access = this.tokens?.access;
    yield this.deps.tokenStorage.clear();
    this.tokens = null;
    if (access) {
      this.deps.api
        .logout(access)
        .catch(() => log.info('Logout request failed; signed out locally'));
    }
  });

  dispose(): void {
    // Nothing to clean up yet (step 3: the refresh in flight).
  }
}
