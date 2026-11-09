import { render, renderHook, screen } from '@testing-library/react-native';
import { observer } from 'mobx-react-lite';
import { Text } from 'react-native';

import type { RootStore } from './root-store';
import { RootStoreProvider, useRootStore } from './RootStoreProvider';

/** Records every store it sees and shows the session status. */
function makeProbe(seen: RootStore[]) {
  return observer(function Probe() {
    const store = useRootStore();
    seen.push(store);
    return <Text>{store.auth.status}</Text>;
  });
}

describe('RootStoreProvider', () => {
  it('creates one store, keeps it across re-renders and restores the session', async () => {
    const seen: RootStore[] = [];
    const Probe = makeProbe(seen);
    const ui = (
      <RootStoreProvider deps={{ locales: [{ languageCode: 'en' }] }}>
        <Probe />
      </RootStoreProvider>
    );

    const { rerender } = await render(ui);
    await rerender(ui);

    expect(await screen.findByText('signedOut')).toBeOnTheScreen();
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(1);
  });

  it('uses the language passed in deps', async () => {
    const seen: RootStore[] = [];
    const Probe = makeProbe(seen);
    await render(
      <RootStoreProvider deps={{ locales: [{ languageCode: 'he' }] }}>
        <Probe />
      </RootStoreProvider>,
    );
    expect(seen[0]?.i18n.language).toBe('he');
  });

  it('disposes the store on unmount', async () => {
    const seen: RootStore[] = [];
    const Probe = makeProbe(seen);
    const { unmount } = await render(
      <RootStoreProvider deps={{ locales: [] }}>
        <Probe />
      </RootStoreProvider>,
    );
    const store = seen[0]!;
    const dispose = jest.spyOn(store, 'dispose');

    await unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('useRootStore() outside the provider fails loudly', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {}); // React logs the thrown render error
    await expect(renderHook(() => useRootStore())).rejects.toThrow('inside <RootStoreProvider>');
  });
});
