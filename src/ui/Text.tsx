import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useTheme } from './useTheme';

type Variant = 'title' | 'body' | 'caption';

export type TextProps = RNTextProps & {
  variant?: Variant;
  muted?: boolean;
};

/** Themed text. Alignment follows the layout direction (start = right in Hebrew). */
export function Text({ variant = 'body', muted = false, style, ...rest }: TextProps) {
  const theme = useTheme();
  return (
    <RNText
      style={[
        theme.typography[variant],
        { color: muted ? theme.colors.textMuted : theme.colors.text, textAlign: 'auto' },
        style,
      ]}
      {...rest}
    />
  );
}
