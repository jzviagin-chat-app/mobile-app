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

/** The server answered with a non-2xx status. */
export class ApiError extends Error {
  override name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    /** From the `Retry-After` header (429), in seconds. */
    readonly retryAfterSeconds?: number,
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

/** Builds an ApiError from a failed response and its (already parsed) body. */
export function toApiError(response: Response, body: unknown): ApiError {
  const code =
    typeof body === 'object' && body !== null && 'error' in body && isErrorCode(body.error)
      ? body.error
      : 'unknown';
  const retryAfter = Number(response.headers.get('retry-after'));
  return new ApiError(
    response.status,
    code,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}
