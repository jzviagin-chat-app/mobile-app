// Errors from auth-service calls. Code branches on `code` (the server's `error` field), never on a message.

/** The `error` codes auth-service sends (its README §8), plus 'unknown' for anything else. */
export const errorCodes = [
  'invalid_request',
  'not_found',
  'method_not_allowed',
  'internal_error',
  'invalid_phone',
  'rate_limited',
  'sms_unavailable',
  'invalid_code',
  'too_many_attempts',
  'code_expired',
  'unsupported_platform',
  'account_blocked',
  'login_conflict',
  'tokens_unavailable',
  'invalid_registration_token',
  'already_registered',
  'invalid_refresh_token',
  'invalid_token',
  'action_not_allowed',
] as const;

export type ErrorCode = (typeof errorCodes)[number] | 'unknown';

/** Which limit refused `otp/request` (`429 rate_limited`). `ip_*` blocks every number on this network. */
export const rateLimits = [
  'resend_cooldown',
  'phone_hour',
  'phone_day',
  'ip_hour',
  'ip_day',
] as const;
export type RateLimit = (typeof rateLimits)[number];

/**
 * Machine-readable fields some errors add next to `error` (auth-service README §8). Only counts, seconds and
 * fixed names: never a phone number, code or token.
 */
export type ErrorDetails = {
  /** 429: which limit was hit. */
  limit?: RateLimit;
  /** 429 / 503: seconds until the request may be repeated (body field, else the Retry-After header). */
  retryAfterSeconds?: number;
  /** invalid_code: tries left for this code. */
  attemptsLeft?: number;
  /** invalid_code / too_many_attempts / code_expired: seconds until a new code may be requested (0: now). */
  resendAfterSeconds?: number;
};

/** The server answered with a non-2xx status. */
export class ApiError extends Error {
  override name = 'ApiError';

  /** Shorthand for details.retryAfterSeconds. */
  get retryAfterSeconds(): number | undefined {
    return this.details.retryAfterSeconds;
  }

  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    readonly details: ErrorDetails = {},
  ) {
    super(`HTTP ${status} ${code}`); // never the server's message: it may echo input
  }
}

/** No answer: offline, DNS, TLS, or our timeout. Nothing is known about whether the server acted. */
export class NetworkError extends Error {
  override name = 'NetworkError';

  constructor(readonly reason: 'offline' | 'timeout') {
    super(`Network error (${reason})`);
  }
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (errorCodes as readonly string[]).includes(value);
}

/** A whole number of seconds ≥ min, or undefined (a wrong value is dropped, never trusted). */
function seconds(value: unknown, min: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min ? value : undefined;
}

/** Builds an ApiError from a failed response and its (already parsed) body. */
export function toApiError(response: Response, body: unknown): ApiError {
  const fields: Record<string, unknown> =
    typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const code = isErrorCode(fields.error) ? fields.error : 'unknown';
  const details: ErrorDetails = {};
  const limit = fields.limit;
  if (typeof limit === 'string' && (rateLimits as readonly string[]).includes(limit)) {
    details.limit = limit as RateLimit;
  }
  const header = Number(response.headers.get('retry-after') ?? NaN);
  const retryAfter = seconds(fields.retry_after_seconds, 1) ?? seconds(header, 1);
  if (retryAfter !== undefined) details.retryAfterSeconds = retryAfter;
  const attemptsLeft = seconds(fields.attempts_left, 0);
  if (attemptsLeft !== undefined) details.attemptsLeft = attemptsLeft;
  const resendAfter = seconds(fields.resend_after_seconds, 0);
  if (resendAfter !== undefined) details.resendAfterSeconds = resendAfter;
  return new ApiError(response.status, code, details);
}
