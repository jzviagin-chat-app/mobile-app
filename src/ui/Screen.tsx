import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from './useTheme';

type Props = {
  children: ReactNode;
  /** Pinned to the bottom (main actions: Continue, …); rises with the keyboard. */
  footer?: ReactNode;
  /** Centre the content (e.g. empty or welcome screens). */
  centered?: boolean;
  style?: ViewStyle;
};

/**
 * A full screen with the theme background, safe-area insets and standard padding: content at the top,
 * an optional footer at the bottom, which sits right above the keyboard when it's open.
 *
 * Keyboard: react-native-keyboard-controller's KeyboardAvoidingView (Expo SDK 58 keyboard-handling
 * guide). It follows the keyboard natively, also with Android's edge-to-edge display, where the window
 * doesn't shrink for the keyboard. React Native's own KeyboardAvoidingView, and tracking the keyboard
 * height in JavaScript, both failed on Android when a login step switched with the keyboard open.
 */
export function Screen({ children, footer, centered = false, style }: Props) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <View
          style={[
            styles.fill,
            { padding: theme.spacing.lg, gap: theme.spacing.md },
            centered && styles.centered,
            style,
          ]}
        >
          {children}
        </View>
        {footer ? (
          <View
            style={{
              paddingHorizontal: theme.spacing.lg,
              paddingBottom: theme.spacing.lg,
              gap: theme.spacing.sm,
            }}
          >
            {footer}
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
