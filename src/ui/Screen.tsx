import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from './useTheme';

type Props = {
  children: ReactNode;
  /** Centre the content (e.g. empty or welcome screens). */
  centered?: boolean;
  style?: ViewStyle;
};

/** A full screen with the theme background, safe-area insets and standard padding. */
export function Screen({ children, centered = false, style }: Props) {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: theme.colors.background }]}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  centered: { justifyContent: 'center', alignItems: 'center' },
});
