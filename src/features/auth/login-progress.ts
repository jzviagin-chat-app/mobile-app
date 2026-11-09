import { z } from 'zod';

import { createSecureItem, type SecureItem } from '@/lib/secure-item';

const timersSchema = z.object({ resendAvailableAt: z.number(), expiresAt: z.number() });

const progressSchema = z.object({
  country: z.string().length(2),
  step: z.enum(['phone', 'code', 'name']),
  phone: z.string().nullable(),
  /** Per E.164 number: when a resend is allowed and when its code expires (Unix ms, phone clock). */
  codes: z.record(z.string(), timersSchema),
  registrationToken: z.string().nullable(),
  registrationExpiresAt: z.number().nullable(),
});

/**
 * A login in progress, saved so closing the app doesn't cost a 429 or a new SMS (owner decision
 * 2026-11-09). Holds a phone number and, for up to 10 minutes, the registration token: secure storage only,
 * deleted on use, expiry, back and sign-in.
 */
export type LoginProgress = z.infer<typeof progressSchema>;
export type CodeTimers = z.infer<typeof timersSchema>;
export type LoginProgressStorage = SecureItem<LoginProgress>;

export function createLoginProgressStorage(): LoginProgressStorage {
  return createSecureItem('login-progress', progressSchema);
}
