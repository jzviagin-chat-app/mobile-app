import {
  canSignIn,
  flagOf,
  listCountries,
  searchCountries,
  SELECTABLE_COUNTRIES,
} from './countries';
import { formatAsYouType, formatNational, toE164 } from './phone';

describe('toE164 (Israel: the server rule +9725XXXXXXXX)', () => {
  it.each([
    '050-234-5678',
    '0502345678',
    '50 234 5678',
    '+972 50 234 5678',
    '+972502345678',
    '972502345678',
  ])('accepts %s', (input) => {
    expect(toE164('IL', input)).toBe('+972502345678');
  });

  it('accepts a range the server takes even if libphonenumber thinks it unallocated', () => {
    expect(toE164('IL', '050-123-4567')).toBe('+972501234567');
  });

  it.each([
    ['a landline', '03-123-4567'],
    ['too short', '050-234-567'],
    ['too long', '050-234-56789'],
    ['letters', 'abc'],
    ['empty', ''],
    ['a UK number typed under Israel', '+44 7400 123456'],
  ])('rejects %s', (_label, input) => {
    expect(toE164('IL', input)).toBeNull();
  });
});

describe('toE164 (other selectable countries: libphonenumber mobile rules)', () => {
  it.each([
    ['US', '(201) 555-0123', '+12015550123'],
    ['CA', '(613) 555-0123', '+16135550123'],
    ['GB', '07400 123456', '+447400123456'],
    ['DE', '01512 3456789', '+4915123456789'],
    ['FR', '06 12 34 56 78', '+33612345678'],
    ['ES', '612 34 56 78', '+34612345678'],
  ] as const)('%s accepts a mobile %s', (country, input, e164) => {
    expect(toE164(country, input)).toBe(e164);
  });

  it.each([
    ['US', '555-0123'],
    ['GB', '020 7946 0018'], // London landline
    ['DE', '030 1234567'], // Berlin landline
    ['FR', '01 23 45 67 89'], // Paris landline
    ['ES', '912 34 56 78'], // Madrid landline
  ] as const)('%s rejects %s', (country, input) => {
    expect(toE164(country, input)).toBeNull();
  });
});

describe('formatting', () => {
  it('formats while typing', () => {
    expect(formatAsYouType('IL', '0502345678')).toBe('050-234-5678');
    expect(formatAsYouType('IL', '05023')).toBe('050-23');
  });

  it('shows an E.164 number in the national form', () => {
    expect(formatNational('+972502345678')).toBe('050-234-5678');
  });
});

describe('countries', () => {
  it('puts the 7 selectable countries first, in order', () => {
    const list = listCountries('en');
    expect(list.slice(0, 7).map((c) => c.code)).toEqual(SELECTABLE_COUNTRIES);
    expect(list.slice(0, 7).every((c) => c.selectable)).toBe(true);
    expect(list.slice(7).some((c) => c.selectable)).toBe(false);
    expect(list.length).toBeGreaterThan(200);
  });

  it('lists US and Canada separately although both are +1', () => {
    const list = listCountries('en');
    expect(list.find((c) => c.code === 'US')?.callingCode).toBe('1');
    expect(list.find((c) => c.code === 'CA')?.callingCode).toBe('1');
  });

  it('names countries in the app language', () => {
    expect(listCountries('he')[0]?.name).toBe('ישראל');
    expect(listCountries('en')[0]?.name).toBe('Israel');
  });

  it.each([
    ['isr', 'IL'],
    ['ישר', 'IL'],
    ['+972', 'IL'],
    ['972', 'IL'],
    ['il', 'IL'],
    ['united k', 'GB'],
  ])('finds %s', (query, code) => {
    expect(searchCountries(listCountries('en'), query).map((c) => c.code)).toContain(code);
  });

  it('only Israel can sign in', () => {
    expect(SELECTABLE_COUNTRIES.filter(canSignIn)).toEqual(['IL']);
  });

  it('builds flag emoji', () => {
    expect(flagOf('IL')).toBe('🇮🇱');
  });
});
