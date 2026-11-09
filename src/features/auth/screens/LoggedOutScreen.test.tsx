import { render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';

import { RootStoreProvider } from '@/root';
import { getTheme } from '@/ui';

import { LoggedOutScreen } from './LoggedOutScreen';

async function renderIn(languageCode: string, scheme: 'light' | 'dark') {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
  await render(
    <RootStoreProvider deps={{ locales: [{ languageCode }] }}>
      <LoggedOutScreen />
    </RootStoreProvider>,
  );
}

describe('LoggedOutScreen', () => {
  it.each([
    ['en', 'Welcome to Walkie Talkie'],
    ['he', 'ברוכים הבאים ל-Walkie Talkie'],
    ['ru', 'Welcome to Walkie Talkie'],
  ])('shows the welcome title for a %s phone', async (languageCode, title) => {
    await renderIn(languageCode, 'light');
    expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
  });

  it.each(['light', 'dark'] as const)('uses the %s palette', async (scheme) => {
    await renderIn('en', scheme);
    expect(screen.getByText('Welcome to Walkie Talkie')).toHaveStyle({
      color: getTheme(scheme).colors.text,
    });
  });
});
