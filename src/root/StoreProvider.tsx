import { createContext, useContext, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import type { RootStore } from './root-store';

const RootStoreContext = createContext<RootStore | null>(null);

/** Gives the screens the root store and its i18n instance. The value never changes; stores do. */
export function StoreProvider({ store, children }: { store: RootStore; children: ReactNode }) {
  return (
    <RootStoreContext.Provider value={store}>
      <I18nextProvider i18n={store.i18n}>{children}</I18nextProvider>
    </RootStoreContext.Provider>
  );
}

/** The root store (use inside `observer` components so reads re-render on change). */
export function useStores(): RootStore {
  const store = useContext(RootStoreContext);
  if (!store) throw new Error('useStores() must be used inside <StoreProvider>');
  return store;
}
