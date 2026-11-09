import { useRef, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from './Text';
import { useTheme } from './useTheme';

type Props = {
  value: string;
  onChange: (digits: string) => void;
  /** Called once the last digit is in (typed, pasted or autofilled from the SMS). */
  onComplete?: (code: string) => void;
  length?: number;
  label: string;
  error?: boolean;
  editable?: boolean;
  autoFocus?: boolean;
};

/**
 * A one-time-code field drawn as boxes. There is ONE real (invisible) TextInput behind them, so paste and
 * the keyboard's SMS autofill (iOS oneTimeCode, Android sms-otp) fill every box at once, and backspace
 * just works. Separate inputs per digit would break both.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  length = 6,
  label,
  error = false,
  editable = true,
  autoFocus = false,
}: Props) {
  const theme = useTheme();
  const input = useRef<ComponentRef<typeof TextInput>>(null);

  function handleChange(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, length);
    onChange(digits);
    if (digits.length === length) onComplete?.(digits);
  }

  return (
    <Pressable
      onPress={() => input.current?.focus()}
      accessible={false}
      style={[styles.row, { gap: theme.spacing.sm }]}
    >
      {Array.from({ length }, (_, i) => {
        const filled = i < value.length;
        const active = editable && i === Math.min(value.length, length - 1);
        return (
          <View
            key={i}
            style={[
              styles.box,
              {
                backgroundColor: theme.colors.surface,
                borderColor: error
                  ? theme.colors.danger
                  : active
                    ? theme.colors.primary
                    : theme.colors.border,
              },
            ]}
          >
            <Text variant="title">{filled ? value[i] : ''}</Text>
          </View>
        );
      })}
      <TextInput
        ref={input}
        testID="otp-input"
        accessibilityLabel={label}
        value={value}
        onChangeText={handleChange}
        maxLength={length}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        editable={editable}
        autoFocus={autoFocus}
        caretHidden
        style={styles.hidden}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Codes read left-to-right also in Hebrew.
  row: { flexDirection: 'row', direction: 'ltr', justifyContent: 'center' },
  box: {
    width: 46,
    height: 56,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Covers the boxes (so a long-press "Paste" lands on it) but is invisible.
  hidden: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    opacity: 0.011,
    color: 'transparent',
  },
});
