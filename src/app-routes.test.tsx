import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

// The real routes in src/app, rendered by Expo Router (this file sits outside src/app: every file in there is a route).
describe('app routes', () => {
  // Jest doesn't read the .env files; the root layout checks the config at startup.
  beforeEach(() => {
    process.env.EXPO_PUBLIC_API_URL = 'https://example.test';
  });

  it('signed out, the app start (/) lands on the welcome screen, not "Unmatched Route"', async () => {
    await renderRouter('./src/app', { initialUrl: '/' });

    expect(await screen.findByText('Welcome to Walkie Talkie')).toBeOnTheScreen();
    expect(screen).toHavePathname('/welcome');
  });
});
