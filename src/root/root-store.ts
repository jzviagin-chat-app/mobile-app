import { QueryClient } from '@tanstack/query-core';
import type { i18n } from 'i18next';

import {
  AuthStore,
  LoginFlowStore,
  type LoginProgressStorage,
  type SendBlocksStorage,
} from '@/features/auth';
import { createAuthorized, type AuthApi, type Authorized } from '@/lib/api';
import type { Clock } from '@/lib/clock';
import type { DeviceInfo } from '@/lib/device';
import { createI18n, pickLanguage } from '@/lib/i18n';
import { log } from '@/lib/log';
import type { TokenStorage } from '@/lib/token-storage';

export type RootStoreDeps = {
  /** The phone's preferred languages, most preferred first (expo-localization getLocales()). */
  locales: readonly { languageCode: string | null }[];
  api: AuthApi;
  tokenStorage: TokenStorage;
  loginProgress: LoginProgressStorage;
  sendBlocks: SendBlocksStorage;
  device: DeviceInfo;
  clock: Clock;
  /** True on the first launch after an install (see lib/fresh-install.ts). */
  isFirstLaunchAfterInstall: () => boolean;
};

/**
 * Creates, owns and wires every store and shared service (no module singletons); tests build a fresh one with
 * fakes, like building an Express app per test. Each store gets only what it needs through its constructor
 * (e.g. the API client, token storage, another store's action), never the whole root: features never import
 * root.
 */
export class RootStore {
  readonly i18n: i18n;
  readonly queryClient: QueryClient;
  readonly auth: AuthStore;
  readonly login: LoginFlowStore;
  /** Runs a logged-in call with a fresh access token (refresh, one retry on 401); for the stores that need it. */
  readonly authorized: Authorized;

  private readonly deps: RootStoreDeps;

  constructor(deps: RootStoreDeps) {
    this.deps = deps;
    this.i18n = createI18n(pickLanguage(deps.locales));
    this.queryClient = new QueryClient();
    this.queryClient.mount();
    this.auth = new AuthStore({
      tokenStorage: deps.tokenStorage,
      api: deps.api,
      clock: deps.clock,
      onSessionEnded: (reason, detail) => this.login.showNotice(reason, detail),
    });
    this.login = new LoginFlowStore({
      api: deps.api,
      completeLogin: (tokens) => this.auth.completeLogin(tokens),
      device: deps.device,
      progress: deps.loginProgress,
      blocks: deps.sendBlocks,
      clock: deps.clock,
    });
    this.authorized = createAuthorized({
      getAccessToken: () => this.auth.freshAccessToken(),
      renewAfterRejection: (rejected) => this.auth.renewAfterRejection(rejected),
      onBlocked: (error) => void this.auth.endSession('account_blocked', 'request', error),
    });
  }

  /**
   * At startup, while the splash screen is up: drop what a previous install left behind (the iOS Keychain
   * survives uninstalling), then read the saved session and any login in progress. Sends no requests.
   */
  async restore(): Promise<void> {
    if (this.deps.isFirstLaunchAfterInstall()) {
      await Promise.all([
        this.deps.tokenStorage.clear(),
        this.deps.loginProgress.clear(),
        this.deps.sendBlocks.clear(),
      ]).catch(() => log.warn('Could not clear storage after a fresh install'));
    }
    await Promise.all([this.auth.restore(), this.login.restore()]);
  }

  dispose(): void {
    this.auth.dispose();
    this.login.dispose();
    this.queryClient.unmount();
    this.queryClient.clear();
  }
}
