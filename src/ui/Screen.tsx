import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from './useTheme';

type Props = {
  children: ReactNode;
  /** Centre the content (e.g. empty or welcome screens). */
  centered?: boolean;
  style?: ViewStyle;
};

/**
 * A full screen with the theme background, safe-area insets and standard padding. The content moves up
 * when the keyboard opens (iOS needs this; Android resizes the window itself).
 */
export function Screen({ children, centered = false, style }: Props) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
