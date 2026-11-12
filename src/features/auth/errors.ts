import { ApiError, NetworkError } from '@/lib/api';
import { log } from '@/lib/log';

/**
 * Why a login action didn't succeed. Screens show `auth.errors.<code>`, except for the ones they show live
 * from the store with a countdown (`blocked`, `invalid_code`, `too_many_attempts`).
 */
export type LoginErrorCode =
  | 'invalid_phone'
  | 'country_not_available'
  | 'rate_limited'
  | 'blocked'
  | 'sms_unavailable'
  | 'invalid_code'
  | 'too_many_attempts'
  | 'code_expired'
  | 'account_blocked'
  | 'invalid_name'
  | 'registration_expired'
  | 'already_registered'
  | 'no_connection'
  | 'server_error';

export type LoginError = { code: LoginErrorCode; retryAfterSeconds?: number };

/** What every login action returns: the store never throws to the screen. */
export type LoginResult = { ok: true } | { ok: false; error: LoginError };

export const ok: LoginResult = { ok: true };
export const fail = (code: LoginErrorCode, retryAfterSeconds?: number): LoginResult => ({
  ok: false,
  error: retryAfterSeconds === undefined ? { code } : { code, retryAfterSeconds },
});

/** Maps a failed API call to a LoginError (codes the action didn't handle itself). */
export function toLoginError(error: unknown): LoginResult {
  if (error instanceof NetworkError) return fail('no_connection');
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'invalid_phone':
      case 'sms_unavailable':
      case 'invalid_code':
      case 'code_expired':
      case 'account_blocked':
      case 'already_registered':
        return fail(error.code);
      case 'rate_limited':
        return fail('rate_limited');
      case 'invalid_registration_token':
        return fail('registration_expired');
      default:
        // e.g. the ingress's own 429 (200 requests / 10 s per IP) has no JSON body.
        if (error.status === 429) return fail('rate_limited');
        log.warn('Login call failed', { status: error.status, code: error.code });
        return fail('server_error');
    }
  }
  log.error('Unexpected login error', { name: error instanceof Error ? error.name : 'unknown' });
  return fail('server_error');
}
