import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type ComponentRef,
  type ReactNode,
} from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { FOCUS_DELAY_MS } from './focus';
import { Text } from './Text';
import { useTheme } from './useTheme';

type Props = Omit<TextInputProps, 'style'> & {
  label: string;
  error?: string | null;
  /**
   * 'ltr' for phone numbers and codes: they read left-to-right also in Hebrew. Default: follows the
   * language.
   */
  direction?: 'ltr' | 'auto';
  /** Shown before the input, e.g. the country button (start side: right in Hebrew, unless ltr). */
  prefix?: ReactNode;
};

export const TextField = forwardRef<ComponentRef<typeof TextInput>, Props>(function TextField(
  { label, error, direction = 'auto', prefix, autoFocus = false, ...input },
  ref,
) {
  const theme = useTheme();
  const inner = useRef<ComponentRef<typeof TextInput>>(null);
  useImperativeHandle(ref, () => inner.current as ComponentRef<typeof TextInput>);

  // autoFocus a moment after mounting (see FOCUS_DELAY_MS): React Native's own autoFocus often leaves
  // the keyboard closed when a field appears right after a screen switch on Android.
  useEffect(() => {
    if (!autoFocus) return;
    const timer = setTimeout(() => inner.current?.focus(), FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [autoFocus]);
  const ltr = direction === 'ltr';
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <Text variant="caption" muted>
        {label}
      </Text>
      <View
        style={[
          styles.row,
          ltr && styles.ltr,
          {
            gap: theme.spacing.sm,
            borderColor: error ? theme.colors.danger : theme.colors.border,
            backgroundColor: theme.colors.surface,
            paddingHorizontal: theme.spacing.md,
          },
        ]}
      >
        {prefix}
        <TextInput
          ref={inner}
          accessibilityLabel={label}
          placeholderTextColor={theme.colors.textMuted}
          style={[
            styles.input,
            theme.typography.body,
            { color: theme.colors.text, textAlign: ltr ? 'left' : 'auto' },
          ]}
          {...input}
        />
      </View>
      {error ? (
        <Text
          variant="caption"
          style={{ color: theme.colors.danger }}
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
  },
  // Force left-to-right for numbers even in an RTL layout (the whole row: prefix stays on the left).
  ltr: { direction: 'ltr' },
  input: { flex: 1, paddingVertical: 12 },
});
