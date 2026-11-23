import { flow, makeAutoObservable } from 'mobx';

import { ApiError, isApiError, SignedOutError, type AuthApi, type LoggedIn } from '@/lib/api';
import type { Clock } from '@/lib/clock';
import { log } from '@/lib/log';
import { tokensFromReply, type StoredTokens, type TokenStorage } from '@/lib/token-storage';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/** Why the server ended the session (the login screen says so). */
export type SessionEnd = 'session_ended' | 'account_blocked';

export type AuthStoreDeps = {
  tokenStorage: TokenStorage;
  api: Pick<AuthApi, 'logout' | 'refreshTokens'>;
  clock: Clock;
  /**
   * The server ended the session. `detail` is a debug line for development builds only
   * (`refresh → 401 invalid_refresh_token · 14:03:12`), null in release builds.
   */
  onSessionEnded: (reason: SessionEnd, detail: string | null) => void;
};

/** Refresh when the access token expires within this (README §7). */
export const REFRESH_MARGIN_MS = 60_000;

/**
 * The session: who is signed in on this phone. Signed in = we hold tokens (`isSignedIn` is computed from
 * them). The root layout shows the (app) or auth routes from `status`.
 *
 * Auto login sends no request: saved tokens mean signed in, also offline and with an expired access token
 * (the first logged-in call refreshes it).
 *
 * Refresh (README §7): before a logged-in call when the access token expires within 60 s
 * (`freshAccessToken`), and after a `401 invalid_token` (`renewAfterRejection`). One at a time: every
 * caller waits on the same refresh. The new tokens are saved before they're used. Only the server's refusal
 * (`invalid_refresh_token`, `account_blocked`) signs out; no answer keeps the tokens.
 */
export class AuthStore {
  tokens: StoredTokens | null = null;
  /** False until secure storage has been read once (the splash screen stays up until then). */
  restored = false;

  private readonly deps: AuthStoreDeps;
  /** The refresh in flight, shared by every caller (not observable: no screen shows it). */
  private refreshing: Promise<StoredTokens> | null = null;
  private disposed = false;

  constructor(deps: AuthStoreDeps) {
    this.deps = deps;
    makeAutoObservable<this, 'deps' | 'refreshing' | 'disposed' | 'logoutOnServer'>(
      this,
      { deps: false, refreshing: false, disposed: false, logoutOnServer: false },
      { autoBind: true },
    );
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

  /** An access token for a logged-in call: the saved one, or a refreshed one if it expires within 60 s. */
  async freshAccessToken(): Promise<string> {
    const tokens = this.tokens;
    if (!tokens) throw new SignedOutError();
    if (tokens.accessExpiresAt - this.deps.clock.now > REFRESH_MARGIN_MS) return tokens.access;
    return (await this.refresh()).access;
  }

  /** The server refused `rejected` (401 invalid_token): the current token if it changed meanwhile, else a refresh. */
  async renewAfterRejection(rejected: string): Promise<string> {
    const tokens = this.tokens;
    if (!tokens) throw new SignedOutError();
    if (tokens.access !== rejected) return tokens.access;
    return (await this.refresh()).access;
  }

  /** One refresh at a time: a caller arriving while one runs waits for the same result. */
  refresh(): Promise<StoredTokens> {
    if (this.refreshing) return this.refreshing;
    const running: Promise<StoredTokens> = this.runRefresh();
    this.refreshing = running;
    running
      .finally(() => {
        if (this.refreshing === running) this.refreshing = null;
      })
      .catch(() => {}); // the callers handle the error
    return running;
  }

  private runRefresh = flow(function* (this: AuthStore) {
    const used = this.tokens;
    if (!used) throw new SignedOutError();
    const sentAt = this.deps.clock.now; // the expiry counts from the send time: never too late
    let reply: LoggedIn;
    try {
      reply = yield this.deps.api.refreshTokens(used.refresh);
    } catch (error) {
      if (this.tokens !== used || this.disposed) throw new SignedOutError();
      if (isApiError(error, 401, 'invalid_refresh_token')) {
        yield this.endSession('session_ended', 'refresh', error);
        throw new SignedOutError();
      }
      if (isApiError(error, 403, 'account_blocked')) {
        yield this.endSession('account_blocked', 'refresh', error);
        throw new SignedOutError();
      }
      // No answer, a timeout, 5xx, 503 tokens_unavailable: keep the tokens. The next call retries with the
      // same refresh token, which auth-service allows (a lost reply).
      log.info('Token refresh failed; the session is kept', { error: errorName(error) });
      throw error;
    }
    // Signed out (or signed in again) while the request ran: its reply belongs to no session now.
    if (this.tokens !== used || this.disposed) throw new SignedOutError();
    const next = tokensFromReply(reply, sentAt);
    // Save FIRST: using the new refresh token makes the saved old one "discarded", and a restart that sent
    // it would sign the device out (reuse). If the save fails, keep the old one: it is still the server's
    // current token, so the next refresh with it just gets another new one.
    try {
      yield this.deps.tokenStorage.save(next);
    } catch (error) {
      log.error('Could not save the refreshed session');
      throw error;
    }
    if (this.tokens !== used) {
      // Signed out during the save: put storage back to what memory holds.
      yield this.writeStorage();
      throw new SignedOutError();
    }
    this.tokens = next;
    log.info('Token refreshed');
    return next;
  });

  /**
   * The server ended the session (refresh refused, or `403 account_blocked` on a call): delete the tokens,
   * no logout call (the device is already signed out, or the user is blocked). The login screen says why.
   */
  endSession = flow(function* (this: AuthStore, reason: SessionEnd, call: string, error: ApiError) {
    if (!this.tokens) return;
    const detail = `${call} → ${error.status} ${error.code} · ${clockTime(this.deps.clock.now)}`;
    log.warn('Signed out by the server', { detail });
    this.tokens = null;
    this.deps.onSessionEnded(reason, __DEV__ ? detail : null);
    yield this.writeStorage();
  });

  /**
   * Signs out at once on the phone, then tells the server (POST /auth/logout) in the background: no spinner,
   * no dependence on the network. If the access token has expired, it is refreshed first (nothing saved),
   * so the server learns it either way. If that fails (offline), the device stays active on the server until
   * the next SMS login replaces it.
   */
  signOut = flow(function* (this: AuthStore) {
    const tokens = this.tokens;
    if (!tokens) return;
    this.tokens = null; // memory first: a refresh finishing meanwhile sees it and keeps out of storage
    yield this.writeStorage();
    void this.logoutOnServer(tokens);
  });

  dispose(): void {
    this.disposed = true; // a refresh reply arriving later is ignored
    this.refreshing = null;
  }

  /** Storage follows memory: the tokens, or nothing. */
  private writeStorage = flow(function* (this: AuthStore) {
    try {
      if (this.tokens) yield this.deps.tokenStorage.save(this.tokens);
      else yield this.deps.tokenStorage.clear();
    } catch {
      log.error('Could not write the saved session');
    }
  });

  private async logoutOnServer(tokens: StoredTokens): Promise<void> {
    try {
      let access = tokens.access;
      if (tokens.accessExpiresAt - this.deps.clock.now <= REFRESH_MARGIN_MS) {
        // A refresh still running for this session is fine: this token is then the server's current one,
        // and using it again just gets another new pair.
        access = (await this.deps.api.refreshTokens(tokens.refresh)).access_token;
      }
      await this.deps.api.logout(access);
    } catch (error) {
      log.info('Logout request failed; signed out locally', { error: errorName(error) });
    }
  }
}

/** A short, safe name for an error in logs (never its message: it may echo a body). */
function errorName(error: unknown): string {
  if (error instanceof ApiError) return `${error.status} ${error.code}`;
  if (error instanceof Error) return error.name;
  return 'unknown';
}

function clockTime(ms: number): string {
  const date = new Date(ms);
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
}
