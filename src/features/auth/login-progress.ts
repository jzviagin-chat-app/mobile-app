import { z } from 'zod';

import { createSecureItem, type SecureItem } from '@/lib/secure-item';

const progressSchema = z.object({
  country: z.string().length(2),
  /** Only the code and name steps are saved: back to the phone step clears everything. */
  step: z.enum(['code', 'name']),
  phone: z.string(),
  /** Unix ms on the phone's clock. */
  resendAvailableAt: z.number().nullable(),
  codeExpiresAt: z.number().nullable(),
  /** `too_many_attempts`: the code is used up; the field stays disabled until a new code is sent. */
  codeState: z.enum(['active', 'too_many_attempts']),
  attemptsLeft: z.number().nullable(),
  /** When the next try is allowed, if the server asked to wait after a wrong code. */
  codeRetryAvailableAt: z.number().nullable(),
  registrationToken: z.string().nullable(),
  registrationExpiresAt: z.number().nullable(),
});

/**
 * A login in progress on the code or name step, saved so closing the app doesn't cost a 429 or a new SMS
 * (owner decision 2026-11-09). Holds a phone number and, for up to 10 minutes, the registration token:
 * secure storage only, deleted on use, expiry, back and sign-in.
 */
export type LoginProgress = z.infer<typeof progressSchema>;
export type LoginProgressStorage = SecureItem<LoginProgress>;

export function createLoginProgressStorage(): LoginProgressStorage {
  return createSecureItem('login-progress', progressSchema);
}
