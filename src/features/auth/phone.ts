import {
  AsYouType,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/mobile';

// Phone numbers in the login: parsed and checked on the device for instant feedback (an invalid number
// never costs a request). The server checks again and has the final say (400 invalid_phone).
// "libphonenumber-js/mobile" carries metadata for mobile numbers only, so a landline is invalid.

/** auth-service's exact rule (README §8): Israeli mobiles only, the SMS cost guard. */
const SERVER_RULE_IL = /^\+9725\d{8}$/;

export type { CountryCode };

/**
 * What was typed (national form with or without the leading 0, spaces, dashes, or a pasted +972…) as
 * E.164, or null if it isn't a mobile number of that country.
 *
 * Israel uses the server's rule exactly: libphonenumber also knows which number ranges are allocated and
 * rejects e.g. 050-1xx-xxxx, which the server accepts; the device must never block what the server takes.
 */
export function toE164(country: CountryCode, input: string): string | null {
  const parsed = parsePhoneNumberFromString(input, country);
  if (!parsed) return null;
  if (parsed.countryCallingCode !== getCountryCallingCode(country)) return null; // +44… typed under IL
  if (country === 'IL') return SERVER_RULE_IL.test(parsed.number) ? parsed.number : null;
  return parsed.isValid() ? parsed.number : null;
}

/** Formats while typing: "0502345" → "050-234-5". */
export function formatAsYouType(country: CountryCode, input: string): string {
  return new AsYouType(country).input(input);
}

/** "+972502345678" → "050-234-5678" (the user's own number, shown on the code step). */
export function formatNational(e164: string): string {
  return parsePhoneNumberFromString(e164)?.formatNational() ?? e164;
}
