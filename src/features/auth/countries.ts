import { getCountries, getCountryCallingCode } from 'libphonenumber-js/mobile';

import type { Language } from '@/lib/i18n';

import names from './country-names.json';
import type { CountryCode } from './phone';

/**
 * Countries the picker lets you choose; numbers are validated and formatted for them on the device.
 * Hard-coded (owner decision 2026-11-09): when the server supports more, switch to a list from the server.
 */
export const SELECTABLE_COUNTRIES: readonly CountryCode[] = [
  'IL',
  'US',
  'GB',
  'DE',
  'FR',
  'ES',
  'CA',
];

/** Countries the server accepts for sign-in (auth-service: Israeli mobiles only, an SMS cost guard). */
export const SIGN_IN_COUNTRIES: readonly CountryCode[] = ['IL'];

export const DEFAULT_COUNTRY: CountryCode = 'IL';

export type Country = {
  code: CountryCode;
  /** Without the plus: "972". */
  callingCode: string;
  flag: string;
  name: string;
  selectable: boolean;
};

const countryNames = names as Record<string, { en: string; he: string }>;

/** 🇮🇱 from "IL": each letter becomes its regional-indicator symbol. */
export function flagOf(code: string): string {
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export function countryName(code: CountryCode, language: Language): string {
  return countryNames[code]?.[language] ?? code;
}

export function canSignIn(code: CountryCode): boolean {
  return SIGN_IN_COUNTRIES.includes(code);
}

export function getCountry(code: CountryCode, language: Language): Country {
  return {
    code,
    callingCode: getCountryCallingCode(code),
    flag: flagOf(code),
    name: countryName(code, language),
    selectable: SELECTABLE_COUNTRIES.includes(code),
  };
}

/** Every country: the selectable ones first (in their fixed order), then the rest by name. */
export function listCountries(language: Language): Country[] {
  const all = getCountries().map((code) => getCountry(code, language));
  const selectable = SELECTABLE_COUNTRIES.map((code) => getCountry(code, language));
  const rest = all
    .filter((country) => !country.selectable)
    .sort((a, b) => a.name.localeCompare(b.name, language));
  return [...selectable, ...rest];
}

/**
 * Filters by the name in Hebrew or English (so either works whatever the app language), the ISO code,
 * or the calling code ("972", "+972").
 */
export function searchCountries(countries: Country[], query: string): Country[] {
  const q = query.trim().toLowerCase();
  if (!q) return countries;
  const digits = q.replace(/^\+/, '');
  return countries.filter((country) => {
    const n = countryNames[country.code];
    return (
      country.code.toLowerCase() === q ||
      (/^\d+$/.test(digits) && country.callingCode.startsWith(digits)) ||
      n?.en.toLowerCase().includes(q) ||
      n?.he.includes(q)
    );
  });
}
