import '@/root/mobx-config';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';

import { getConfig } from '@/lib/config';
import { RootStoreProvider, useStores } from '@/root';
import { useTheme } from '@/ui';

// Keep the native splash screen up until we know whether someone is logged in.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useState(getConfig); // fail fast on a bad EXPO_PUBLIC_API_URL (once, before the store exists)

  return (
    <RootStoreProvider>
      <RootNavigator />
    </RootStoreProvider>
  );
}

/** Shows the (auth) or the (app) routes depending on the session; history is cleared on every switch. */
const RootNavigator = observer(function RootNavigator() {
  const { auth } = useStores();
  const theme = useTheme();
  const ready = auth.status !== 'loading';

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
        <Stack.Protected guard={auth.isSignedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!auth.isSignedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </>
  );
});
