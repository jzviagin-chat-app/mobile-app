import { QueryClient } from '@tanstack/query-core';
import type { i18n } from 'i18next';

import { AuthStore } from '@/features/auth';
import { createI18n, pickLanguage } from '@/lib/i18n';

export type RootStoreDeps = {
  /** The phone's preferred languages, most preferred first (expo-localization getLocales()). */
  locales: readonly { languageCode: string | null }[];
};

/**
 * Creates, owns and wires every store and shared service (no module singletons); tests build a fresh one with
 * fakes, like building an Express app per test. Each store gets only what it needs through its constructor
 * (e.g. the API client, token storage, another store), never the whole root: features never import root.
 */
export class RootStore {
  readonly i18n: i18n;
  readonly queryClient: QueryClient;
  readonly auth: AuthStore;

  constructor(deps: RootStoreDeps) {
    this.i18n = createI18n(pickLanguage(deps.locales));
    this.queryClient = new QueryClient();
    this.queryClient.mount();
    this.auth = new AuthStore();
  }

  dispose(): void {
    this.auth.dispose();
    this.queryClient.unmount();
    this.queryClient.clear();
  }
}
