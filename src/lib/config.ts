import { z } from 'zod';

// The only file that reads process.env. EXPO_PUBLIC_* values are inlined into the bundle at build time
// (from .env.development / .env.production), so they are public: never a secret here.

const schema = z.object({
  apiUrl: z.url({ protocol: /^https?$/ }).transform((url) => url.replace(/\/+$/, '')), // no trailing slash: paths start with "/"
});

export type AppConfig = z.infer<typeof schema>;

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/** Validates raw values; throws ConfigError naming the bad setting (never echoing values). */
export function parseConfig(raw: { apiUrl: string | undefined }): AppConfig {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new ConfigError(
      `Invalid app config (${fields}). Check EXPO_PUBLIC_API_URL in .env.development / .env.production.`,
    );
  }
  return result.data;
}

let cached: AppConfig | undefined;

/** The app's config, validated once. Fails fast at startup, like pydantic-settings. */
export function getConfig(): AppConfig {
  // Must stay a literal `process.env.EXPO_PUBLIC_…` member access: that is what Expo inlines.
  cached ??= parseConfig({ apiUrl: process.env.EXPO_PUBLIC_API_URL });
  return cached;
}
