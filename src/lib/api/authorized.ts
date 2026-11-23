import { isApiError, type ApiError } from './errors';

export type AuthorizedDeps = {
  /**
   * A valid access token: the saved one, or a refreshed one when it expires soon (AuthStore). Throws
   * SignedOutError (no session), NetworkError (the refresh got no answer) or ApiError.
   */
  getAccessToken: () => Promise<string>;
  /**
   * The server refused `rejected` (401 invalid_token: a wrong phone clock, a rotated key, a signed-out
   * device): the token to retry with. The current one if it already changed meanwhile, else a refresh.
   */
  renewAfterRejection: (rejected: string) => Promise<string>;
  /** 403 account_blocked on a logged-in call: the session ends. */
  onBlocked: (error: ApiError) => void;
};

/** Runs one logged-in call with a valid access token (README §7, "Refresh"). */
export type Authorized = <T>(call: (accessToken: string) => Promise<T>) => Promise<T>;

/**
 * Wraps logged-in calls: gets a fresh access token first, and on `401 invalid_token` renews it and retries
 * once. A second 401 fails the call (no loop: the next call refreshes and finds out). The API client itself
 * never knows about the session; stores call `authorized((token) => api.listDevices(token))`.
 */
export function createAuthorized({
  getAccessToken,
  renewAfterRejection,
  onBlocked,
}: AuthorizedDeps): Authorized {
  async function attempt<T>(call: (accessToken: string) => Promise<T>, token: string): Promise<T> {
    try {
      return await call(token);
    } catch (error) {
      if (isApiError(error, 403, 'account_blocked')) onBlocked(error);
      throw error;
    }
  }

  return async (call) => {
    const token = await getAccessToken();
    try {
      return await attempt(call, token);
    } catch (error) {
      if (!isApiError(error, 401, 'invalid_token')) throw error;
      return attempt(call, await renewAfterRejection(token));
    }
  };
}
