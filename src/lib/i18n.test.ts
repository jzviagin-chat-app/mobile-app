import en from '@locales/en.json';
import he from '@locales/he.json';

import { createI18n, fallbackLanguage, pickLanguage } from './i18n';

const locales = (...codes: (string | null)[]) => codes.map((languageCode) => ({ languageCode }));

describe('pickLanguage (the app follows the phone)', () => {
  it('uses Hebrew on a Hebrew phone', () => {
    expect(pickLanguage(locales('he'))).toBe('he');
  });

  it('accepts the legacy Android code "iw" for Hebrew', () => {
    expect(pickLanguage(locales('iw'))).toBe('he');
  });

  it('uses English on an English phone', () => {
    expect(pickLanguage(locales('en'))).toBe('en');
  });

  it('takes the first supported language in the phone’s preference order', () => {
    expect(pickLanguage(locales('ru', 'he', 'en'))).toBe('he');
  });

  it('falls back to English for unsupported languages', () => {
    expect(pickLanguage(locales('ru', 'ar'))).toBe('en');
    expect(pickLanguage(locales(null))).toBe('en');
    expect(pickLanguage([])).toBe(fallbackLanguage);
  });
});

describe('createI18n', () => {
  it('translates synchronously in both languages', () => {
    expect(createI18n('en').t('auth.phone.continue')).toBe('Continue');
    expect(createI18n('he').t('auth.phone.continue')).toBe('המשך');
  });

  it('has the same keys in Hebrew and English', () => {
    const keys = (obj: object, prefix = ''): string[] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === 'object' && v !== null ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
      );
    expect(keys(he)).toEqual(keys(en));
  });
});
