import { getLocales } from 'expo-localization';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { RootStore, type RootStoreDeps } from './root-store';

const RootStoreContext = createContext<RootStore | null>(null);

type Props = {
  /** Overrides for the real dependencies (tests pass fakes). The app passes nothing. */
  deps?: Partial<RootStoreDeps>;
  children: ReactNode;
};

/**
 * Creates the app's one RootStore, restores the session, disposes it on unmount, and gives it (and its i18n
 * instance) to everything inside. `useState`'s initializer runs only on the first render, so re-renders
 * never create a second store.
 */
export function RootStoreProvider({ deps, children }: Props) {
  const [store] = useState(() => new RootStore({ locales: deps?.locales ?? getLocales() }));

  useEffect(() => {
    void store.auth.restore();
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
