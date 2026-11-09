import { createInstance, type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '@locales/en.json';
import he from '@locales/he.json';

export const supportedLanguages = ['he', 'en'] as const;
export type Language = (typeof supportedLanguages)[number];
export const fallbackLanguage: Language = 'en';

/** Text direction of each supported language (Hebrew is right-to-left). */
export const languageDirection: Record<Language, 'rtl' | 'ltr'> = { he: 'rtl', en: 'ltr' };

// Typed keys: t('auth.loggedOut.title') is checked against en.json; a typo is a type error.
declare module 'i18next' {
  interface CustomTypeOptions {
    resources: { translation: typeof en };
  }
}

function isSupported(code: string): code is Language {
  return (supportedLanguages as readonly string[]).includes(code);
}

/**
 * The app follows the phone: the first of the phone's preferred languages that we support,
 * otherwise English. `locales` is expo-localization's getLocales() (most preferred first).
 */
export function pickLanguage(locales: readonly { languageCode: string | null }[]): Language {
  for (const { languageCode } of locales) {
    const code = languageCode?.toLowerCase();
    // "iw" is the legacy code some Android versions report for Hebrew.
    const normalised = code === 'iw' ? 'he' : code;
    if (normalised && isSupported(normalised)) return normalised;
  }
  return fallbackLanguage;
}

/** A ready, synchronous i18next instance (resources are bundled, nothing is loaded over the network). */
export function createI18n(language: Language): i18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: language,
    fallbackLng: fallbackLanguage,
    resources: { en: { translation: en }, he: { translation: he } },
    initAsync: false,
    interpolation: { escapeValue: false }, // React already escapes rendered text
    returnNull: false,
  });
  return instance;
}
