import '@/root/mobx-config';

import { getLocales } from 'expo-localization';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';

import { getConfig } from '@/lib/config';
import { RootStore, StoreProvider, useStores } from '@/root';
import { useTheme } from '@/ui';

// Keep the native splash screen up until we know whether someone is logged in.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [store] = useState(() => {
    getConfig(); // fail fast on a bad EXPO_PUBLIC_API_URL
    return new RootStore({ locales: getLocales() });
  });

  useEffect(() => {
    void store.session.restore();
    return () => store.dispose();
  }, [store]);

  return (
    <StoreProvider store={store}>
      <RootNavigator />
    </StoreProvider>
  );
}

/** Shows the (auth) or the (app) routes depending on the session; history is cleared on every switch. */
const RootNavigator = observer(function RootNavigator() {
  const { session } = useStores();
  const theme = useTheme();
  const ready = session.status !== 'loading';

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.background },
        }}
      >
        <Stack.Protected guard={session.isSignedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!session.isSignedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
});
