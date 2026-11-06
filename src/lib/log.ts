/* eslint-disable no-console -- the one place allowed to write to the console */

// App logging. Rule: never log tokens, SMS codes or full phone numbers. Callers pass short messages and
// small objects; every string value is passed through mask() as a safety net.

const PHONE = /\+?\d[\d\s-]{7,}\d/g;
// A JWT (header.payload[.signature]) or any long opaque base64url value (refresh / registration tokens).
const LONG_TOKEN = /[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{8,}){1,2}|[A-Za-z0-9_-]{24,}/g;

/** Masks phone numbers (+97250***4567) and long token-like strings in free text. */
export function mask(text: string): string {
  return text.replace(LONG_TOKEN, '[redacted]').replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, '');
    const plus = match.startsWith('+') ? '+' : '';
    if (digits.length < 9) return match;
    return `${plus}${digits.slice(0, 5)}***${digits.slice(-4)}`;
  });
}

type Fields = Record<string, string | number | boolean | null | undefined>;

function clean(fields?: Fields): Fields | undefined {
  if (!fields) return undefined;
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      typeof value === 'string' ? mask(value) : value,
    ]),
  );
}

export const log = {
  debug(message: string, fields?: Fields) {
    if (__DEV__) console.debug(mask(message), clean(fields) ?? '');
  },
  info(message: string, fields?: Fields) {
    console.info(mask(message), clean(fields) ?? '');
  },
  warn(message: string, fields?: Fields) {
    console.warn(mask(message), clean(fields) ?? '');
  },
  error(message: string, fields?: Fields) {
    console.error(mask(message), clean(fields) ?? '');
  },
};
