// Design tokens. Every colour exists in a light and a dark variant; components never hard-code colours.
// Layout rule: use start/end (marginStart, paddingEnd, …), never left/right, so Hebrew (RTL) mirrors correctly.

export type ColorSchemeName = 'light' | 'dark';

export type Palette = {
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  border: string;
  danger: string;
};

const palettes: Record<ColorSchemeName, Palette> = {
  light: {
    background: '#FFFFFF',
    surface: '#F2F4F7',
    text: '#101828',
    textMuted: '#667085',
    primary: '#1570EF',
    onPrimary: '#FFFFFF',
    border: '#D0D5DD',
    danger: '#D92D20',
  },
  dark: {
    background: '#0B1220',
    surface: '#161F30',
    text: '#F2F4F7',
    textMuted: '#98A2B3',
    primary: '#53B1FD',
    onPrimary: '#0B1220',
    border: '#344054',
    danger: '#F97066',
  },
};

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const typography = {
  title: { fontSize: 28, fontWeight: '700', lineHeight: 34 },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 22 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
} as const;

export type Theme = {
  scheme: ColorSchemeName;
  colors: Palette;
  spacing: typeof spacing;
  typography: typeof typography;
};

export function getTheme(scheme: ColorSchemeName): Theme {
  return { scheme, colors: palettes[scheme], spacing, typography };
}
