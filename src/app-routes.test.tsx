import { act, fireEvent, screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { RootNavigator, RootStoreProvider } from '@/root';
import { memoryItem, testDeps } from '@/root/test-deps';
import type { StoredTokens } from '@/lib/token-storage';

// The real routes in src/app, rendered by Expo Router, with only the root layout swapped for the same
// navigator over a fake-backed store (no network, no secure storage). This file sits outside src/app:
// every file in there is a route.
function renderApp(deps = testDeps(), initialUrl = '/') {
  const RootLayout = () => (
    <RootStoreProvider deps={deps}>
      <RootNavigator />
    </RootStoreProvider>
  );
  return renderRouter({ appDir: './src/app', overrides: { _layout: RootLayout } }, { initialUrl });
}

const loggedIn = {
  status: 'logged_in',
  access_token: 'access-1',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'refresh-1',
} as const;

describe('app routes', () => {
  it('signed out, the app start (/) lands on /auth (no "Unmatched Route")', async () => {
    await renderApp();
    expect(await screen.findByText('Your phone number')).toBeOnTheScreen();
    expect(screen).toHavePathname('/auth');
  });

  it('saved tokens: the start lands on home without showing the login', async () => {
    const deps = testDeps({
      tokenStorage: memoryItem<StoredTokens>({ access: 'a', refresh: 'r', accessExpiresAt: 1 }),
    });
    await renderApp(deps);
    expect(await screen.findByText("You're signed in.")).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(screen.queryByText('Your phone number')).toBeNull();
  });

  it('a full login lands on /, and signing out goes back to /auth', async () => {
    const deps = testDeps();
    deps.fakeApi.requestCode.mockResolvedValue({
      resend_after_seconds: 60,
      expires_in_seconds: 300,
    });
    deps.fakeApi.verifyCode.mockResolvedValue(loggedIn);
    await renderApp(deps);

    await fireEvent.changeText(await screen.findByTestId('phone-input'), '0502345678');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    expect(await screen.findByText('Enter the code')).toBeOnTheScreen();
    expect(screen).toHavePathname('/auth');

    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    expect(await screen.findByText("You're signed in.")).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
    expect(deps.fakeApi.verifyCode).toHaveBeenCalledWith('+972502345678', '123456', deps.device);

    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(await screen.findByText('Your phone number')).toBeOnTheScreen();
    expect(screen).toHavePathname('/auth');
    expect(deps.fakeApi.logout).toHaveBeenCalledWith('access-1');
  });

  it('signed in, a link to /auth goes home', async () => {
    const deps = testDeps({
      tokenStorage: memoryItem<StoredTokens>({ access: 'a', refresh: 'r', accessExpiresAt: 1 }),
    });
    await renderApp(deps, '/auth');
    // The guarded screen renders a <Redirect>, which navigates on the next tick (renderRouter uses fake
    // timers).
    await act(() => jest.runOnlyPendingTimersAsync());
    expect(await screen.findByText("You're signed in.")).toBeOnTheScreen();
    expect(screen).toHavePathname('/');
  });
});
