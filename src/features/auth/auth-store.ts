import { flow, makeAutoObservable } from 'mobx';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/**
 * Who is logged in on this phone. The root layout shows the (auth) or (app) routes from `status`.
 *
 * Skeleton: there is no login yet, so restore() always ends signed out. Step 2 adds completeLogin(tokens)
 * (save to secure storage first, then sign in); step 3 adds refresh() (one at a time) and signOut().
 */
export class AuthStore {
  status: AuthStatus = 'loading';

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get isSignedIn(): boolean {
    return this.status === 'signedIn';
  }

  /** Called once at startup. Later: read the stored tokens from secure storage. */
  restore = flow(function* (this: AuthStore) {
    yield Promise.resolve(); // later: tokens = yield root.tokenStorage.load()
    this.status = 'signedOut';
  });

  dispose(): void {
    // Nothing to clean up yet (reactions and timers will be disposed here).
  }
}
