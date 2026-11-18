import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';

import { useTheme } from '@/ui';

import { useRootStore } from './RootStoreProvider';

/**
 * The top-level navigator: the auth route or the (app) routes, from the session. Kept out of the route
 * file so tests can render the real routes with a fake-backed store (src/app-routes.test.tsx).
 */
export const RootNavigator = observer(function RootNavigator() {
  const { auth } = useRootStore();
  const theme = useTheme();
  const ready = auth.status !== 'loading';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null; // the native splash screen is still up

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        {/* Signed in: the (app) routes; signed out: /auth. Each guard redirects to the other side, so a
            start URL or a link to a blocked screen lands on an allowed one (the app starts at "/", which
            is (app)/index: without redirectTo a signed-out start would match nothing, "Unmatched Route").
            Switching removes the other side's history: back can't return to the login after signing in. */}
        <Stack.Protected guard={auth.isSignedIn} redirectTo="/auth">
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!auth.isSignedIn} redirectTo="/">
          <Stack.Screen name="auth" />
        </Stack.Protected>
      </Stack>
    </>
  );
});
