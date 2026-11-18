import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';

import { Text } from './Text';
import { useTheme } from './useTheme';

type Props = {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  /** Shows a spinner and ignores presses (e.g. while a request runs). */
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
};

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  testID,
}: Props) {
  const theme = useTheme();
  const primary = variant === 'primary';
  const inactive = disabled || loading;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          paddingVertical: theme.spacing.md - 2,
          paddingHorizontal: theme.spacing.lg,
          backgroundColor: primary ? theme.colors.primary : 'transparent',
          borderColor: primary ? theme.colors.primary : theme.colors.border,
          opacity: inactive ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? theme.colors.onPrimary : theme.colors.primary} />
      ) : (
        <Text
          style={[styles.label, { color: primary ? theme.colors.onPrimary : theme.colors.primary }]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: 12, borderWidth: 1, alignItems: 'center', minHeight: 48 },
  label: { fontWeight: '600', textAlign: 'center' },
});
