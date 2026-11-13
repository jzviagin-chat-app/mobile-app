import '@/root/mobx-config';

import * as SplashScreen from 'expo-splash-screen';
import { useState } from 'react';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { getConfig } from '@/lib/config';
import { RootNavigator, RootStoreProvider } from '@/root';

// Keep the native splash screen up until we know whether someone is logged in.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useState(getConfig); // fail fast on a bad EXPO_PUBLIC_API_URL (once, before the store exists)

  return (
    <KeyboardProvider>
      <RootStoreProvider>
        <RootNavigator />
      </RootStoreProvider>
    </KeyboardProvider>
  );
}
