import createClient from 'openapi-fetch';

import { ApiError, NetworkError, toApiError, toRateLimit, type RateLimit } from './errors';
import type { components, paths } from './schema';

type Schemas = components['schemas'];
export type DeviceIn = Schemas['DeviceIn'];
export type LoggedIn = Schemas['LoggedInOut'];
export type RegistrationRequired = Schemas['RegistrationRequiredOut'];
/**
 * The 202 of otp/request. `limit` (planned in auth-service, not sent yet) names the limit that set
 * `resend_after_seconds` when it's longer than the cooldown (this code used a window's last slot), as in a
 * 429: `ip_hour` / `ip_day` lock every number on this network. Without it the wait is taken as this
 * number's.
 */
export type CodeSent = Schemas['OtpRequestOut'] & { limit?: RateLimit };

export type AuthApiOptions = {
  /** e.g. https://jzviagin-chat-app.129-159-150-34.sslip.io (no trailing slash). */
  baseUrl: string;
  /** Injected in tests. */
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

/**
 * The calls the app makes to auth-service, typed from its OpenAPI schema. Every call either returns the
 * success body or throws ApiError (the server said no) / NetworkError (no answer). Never logs bodies or
 * headers: they carry phone numbers, codes and tokens.
 */
export type AuthApi = ReturnType<typeof createAuthApi>;

export function createAuthApi({ baseUrl, fetch, timeoutMs = 15_000 }: AuthApiOptions) {
  const client = createClient<paths>({
    baseUrl,
    // Resolve fetch per call, so tests and dev tools that replace globalThis.fetch are honoured.
    fetch: (request) => (fetch ?? globalThis.fetch)(request),
  });

  /** Runs one request with a timeout, mapping failures to ApiError / NetworkError. */
  async function send<T>(
    call: (signal: AbortSignal) => Promise<{ data?: T; error?: unknown; response: Response }>,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let result: { data?: T; error?: unknown; response: Response };
    try {
      result = await call(controller.signal);
    } catch {
      // fetch rejects only when there is no HTTP answer at all (or when we aborted it).
      throw new NetworkError(controller.signal.aborted ? 'timeout' : 'offline');
    } finally {
      clearTimeout(timer);
    }
    if (!result.response.ok) throw toApiError(result.response, result.error);
    return result.data as T;
  }

  return {
    /** POST /auth/otp/request: sends an SMS code. */
    async requestCode(phone: string): Promise<CodeSent> {
      const sent = await send((signal) =>
        client.POST('/auth/otp/request', { body: { phone }, signal }),
      );
      const { resend_after_seconds, expires_in_seconds } = sent;
      const limit = toRateLimit((sent as Record<string, unknown>).limit);
      return limit
        ? { resend_after_seconds, expires_in_seconds, limit }
        : { resend_after_seconds, expires_in_seconds };
    },

    /** POST /auth/otp/verify: logged in (known number) or registration required (new number). */
    verifyCode(
      phone: string,
      code: string,
      device: DeviceIn,
    ): Promise<LoggedIn | RegistrationRequired> {
      return send((signal) =>
        client.POST('/auth/otp/verify', { body: { phone, code, device }, signal }),
      );
    },

    /** POST /auth/register: a new number's display name → account + tokens. */
    register(registrationToken: string, displayName: string, device: DeviceIn): Promise<LoggedIn> {
      return send((signal) =>
        client.POST('/auth/register', {
          body: { registration_token: registrationToken, display_name: displayName, device },
          signal,
        }),
      );
    },

    /** POST /auth/logout: signs this device out (always 204). */
    async logout(accessToken: string): Promise<void> {
      await send((signal) =>
        client.POST('/auth/logout', {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal,
        }),
      );
    },
  };
}

export { ApiError, NetworkError };
