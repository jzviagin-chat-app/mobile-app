import { useColorScheme } from 'react-native';

import { getTheme, type Theme } from './theme';

/** The current theme. Follows the phone's light/dark setting and re-renders when it changes. */
export function useTheme(): Theme {
  return getTheme(useColorScheme() === 'dark' ? 'dark' : 'light');
}
