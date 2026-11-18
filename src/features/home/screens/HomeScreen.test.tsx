import { fireEvent, render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';

import type { StoredTokens } from '@/lib/token-storage';
import { RootStoreProvider, useRootStore } from '@/root';
import { memoryItem, testDeps } from '@/root/test-deps';
import { getTheme } from '@/ui';

import { HomeScreen } from './HomeScreen';

function Home() {
  const { auth } = useRootStore();
  return <HomeScreen auth={auth} />;
}

async function renderHome(language = 'en', scheme: 'light' | 'dark' = 'light') {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
  const tokenStorage = memoryItem<StoredTokens>({ access: 'a', refresh: 'r', accessExpiresAt: 1 });
  const deps = testDeps({ locales: [{ languageCode: language }], tokenStorage });
  await render(
    <RootStoreProvider deps={deps}>
      <Home />
    </RootStoreProvider>,
  );
  return { deps, tokenStorage };
}

describe('HomeScreen', () => {
  it.each([
    ['en', 'Chats', 'Sign out'],
    ['he', "צ'אטים", 'יציאה'],
  ])('renders in %s', async (language, title, signOut) => {
    await renderHome(language);
    expect(await screen.findByRole('header', { name: title })).toBeOnTheScreen();
    expect(screen.getByText(signOut)).toBeOnTheScreen();
  });

  it.each(['light', 'dark'] as const)('uses the %s palette', async (scheme) => {
    await renderHome('en', scheme);
    expect(await screen.findByText('Chats')).toHaveStyle({ color: getTheme(scheme).colors.text });
  });

  it('signs out: tokens deleted, the server told', async () => {
    const { deps, tokenStorage } = await renderHome();
    await fireEvent.press(await screen.findByTestId('sign-out'));
    expect(tokenStorage.value).toBeNull();
    expect(deps.fakeApi.logout).toHaveBeenCalledWith('a');
  });
});
