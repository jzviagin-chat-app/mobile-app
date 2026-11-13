// node scripts/gen-country-names.mjs: writes country names in Hebrew and English for the phone picker.
// Generated once with Node's Intl.DisplayNames (full ICU data) and committed, so the app doesn't depend on
// the phone's JavaScript engine (Hermes) supporting Intl.DisplayNames.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { getCountries } = require('libphonenumber-js/mobile');

const he = new Intl.DisplayNames(['he'], { type: 'region' });
const en = new Intl.DisplayNames(['en'], { type: 'region' });
const names = Object.fromEntries(
  getCountries().map((code) => [code, { en: en.of(code), he: he.of(code) }]),
);
const path = 'src/features/auth/country-names.json';
writeFileSync(path, `${JSON.stringify(names, null, 2)}\n`);
console.log(`Wrote ${Object.keys(names).length} countries to ${path}`);
