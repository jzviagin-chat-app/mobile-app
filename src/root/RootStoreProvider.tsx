import { getLocales } from 'expo-localization';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { createLoginProgressStorage, createSendBlocksStorage } from '@/features/auth';
import { createAuthApi } from '@/lib/api';
import { createClock } from '@/lib/clock';
import { getConfig } from '@/lib/config';
import { getDeviceInfo } from '@/lib/device';
import { isFirstLaunchAfterInstall } from '@/lib/fresh-install';
import { createTokenStorage } from '@/lib/token-storage';

import { RootStore, type RootStoreDeps } from './root-store';

const RootStoreContext = createContext<RootStore | null>(null);

/** The real dependencies: the server from the config, secure storage, this phone, the real clock. */
function realDeps(): RootStoreDeps {
  return {
    locales: getLocales(),
    api: createAuthApi({ baseUrl: getConfig().apiUrl }),
    tokenStorage: createTokenStorage(),
    loginProgress: createLoginProgressStorage(),
    sendBlocks: createSendBlocksStorage(),
    device: getDeviceInfo(),
    clock: createClock(),
    isFirstLaunchAfterInstall,
  };
}

type Props = {
  /** Tests pass fakes (src/root/test-deps.ts). The app passes nothing and gets the real ones. */
  deps?: RootStoreDeps;
  children: ReactNode;
};

/**
 * Creates the app's one RootStore, restores the saved session and login progress, disposes it on
 * unmount, and gives it (and its i18n instance) to everything inside. `useState`'s initializer runs only on
 * the first render, so re-renders never create a second store.
 */
export function RootStoreProvider({ deps, children }: Props) {
  const [store] = useState(() => new RootStore(deps ?? realDeps()));

  useEffect(() => {
    void store.restore();
    return () => store.dispose();
  }, [store]);

  return (
    <RootStoreContext.Provider value={store}>
      <I18nextProvider i18n={store.i18n}>{children}</I18nextProvider>
    </RootStoreContext.Provider>
  );
}

/** The root store (use inside `observer` components so reads re-render on change). */
export function useRootStore(): RootStore {
  const store = useContext(RootStoreContext);
  if (!store) throw new Error('useRootStore() must be used inside <RootStoreProvider>');
  return store;
}
