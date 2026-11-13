// npm run api:gen: refresh auth-service's API types.
// Needs auth-service running locally with ENVIRONMENT=dev (the schema is served only in dev).
// openapi-typescript runs through npx at a pinned version: it isn't a dependency because it declares a
// peer of TypeScript 5 while the app uses TypeScript 6 (the generated .d.ts works with both).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const url = process.env.AUTH_OPENAPI_URL ?? 'http://localhost:8000/auth/openapi.json';
const schemaPath = 'src/lib/api/schema.json';
const typesPath = 'src/lib/api/schema.d.ts';

const response = await fetch(url).catch((error) => {
  console.error(
    `Can't reach ${url} (${error.message}). Is auth-service running with ENVIRONMENT=dev?`,
  );
  process.exit(1);
});
if (!response.ok) {
  console.error(
    `${url} answered ${response.status}. Is auth-service running with ENVIRONMENT=dev?`,
  );
  process.exit(1);
}
writeFileSync(schemaPath, `${JSON.stringify(await response.json(), null, 2)}\n`);
execFileSync('npx', ['-y', 'openapi-typescript@7.13.0', schemaPath, '-o', typesPath], {
  stdio: 'inherit',
});
console.log(`Updated ${schemaPath} and ${typesPath}. Commit both.`);
