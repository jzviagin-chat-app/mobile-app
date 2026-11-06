import { render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';

import { RootStore, StoreProvider } from '@/root';
import { getTheme } from '@/ui';

import { LoggedOutScreen } from './LoggedOutScreen';

async function renderIn(languageCode: string, scheme: 'light' | 'dark') {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
  const store = new RootStore({ locales: [{ languageCode }] });
  await render(
    <StoreProvider store={store}>
      <LoggedOutScreen />
    </StoreProvider>,
  );
  return store;
}

describe('LoggedOutScreen', () => {
  it.each([
    ['en', 'Welcome to Walkie Talkie'],
    ['he', 'ברוכים הבאים ל-Walkie Talkie'],
    ['ru', 'Welcome to Walkie Talkie'],
  ])('shows the welcome title for a %s phone', async (languageCode, title) => {
    const store = await renderIn(languageCode, 'light');
    expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
    store.dispose();
  });

  it.each(['light', 'dark'] as const)('uses the %s palette', async (scheme) => {
    const store = await renderIn('en', scheme);
    expect(screen.getByText('Welcome to Walkie Talkie')).toHaveStyle({
      color: getTheme(scheme).colors.text,
    });
    store.dispose();
  });
});
