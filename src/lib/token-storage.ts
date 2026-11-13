import { z } from 'zod';

import { createSecureItem, type SecureItem } from './secure-item';

const tokensSchema = z.object({
  access: z.string().min(1),
  refresh: z.string().min(1),
  /** Unix ms on the phone's own clock: time of receipt + expires_in (not the JWT's exp, server time). */
  accessExpiresAt: z.number(),
});

/** The session tokens, saved as one item so the three values are always consistent. */
export type StoredTokens = z.infer<typeof tokensSchema>;

export type TokenStorage = SecureItem<StoredTokens>;

export function createTokenStorage(): TokenStorage {
  return createSecureItem('session', tokensSchema);
}

/** Tokens from an auth-service login/refresh reply, with the expiry measured on this phone's clock. */
export function tokensFromReply(
  reply: { access_token: string; refresh_token: string; expires_in: number },
  now: number,
): StoredTokens {
  return {
    access: reply.access_token,
    refresh: reply.refresh_token,
    accessExpiresAt: now + reply.expires_in * 1000,
  };
}
