import { ApiError, createAuthApi, NetworkError } from '.';

const device = { platform: 'android', name: 'Test S22' } as const;

/** A fake fetch that records requests and answers with the given response. */
function fakeFetch(answer: () => Response | Promise<Response>) {
  const requests: { url: string; method: string; body: unknown; auth: string | null }[] = [];
  const fetch = jest.fn(async (input: RequestInfo | URL) => {
    const request = input as Request;
    const text = await request.text();
    requests.push({
      url: request.url,
      method: request.method,
      body: text ? JSON.parse(text) : undefined,
      auth: request.headers.get('authorization'),
    });
    return answer();
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, requests };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const api = (fetch: typeof globalThis.fetch, timeoutMs?: number) =>
  createAuthApi({ baseUrl: 'https://auth.test', fetch, timeoutMs });

describe('createAuthApi', () => {
  it.each([
    ['ip_hour', { limit: 'ip_hour' }],
    ['phone_day', { limit: 'phone_day' }],
    ['an unknown name', {}],
    ['a wrong type', {}],
  ])(
    'requestCode reads the planned limit of a long wait in the 202 (%s)',
    async (_case, expected) => {
      const limit = _case === 'an unknown name' ? 'moon' : _case === 'a wrong type' ? 7 : _case;
      const { fetch } = fakeFetch(() =>
        json(202, { resend_after_seconds: 3000, expires_in_seconds: 300, limit }),
      );
      await expect(api(fetch).requestCode('+972502345678')).resolves.toEqual({
        resend_after_seconds: 3000,
        expires_in_seconds: 300,
        ...expected,
      });
    },
  );

  it('requestCode posts the phone and returns the timers', async () => {
    const { fetch, requests } = fakeFetch(() =>
      json(202, { resend_after_seconds: 60, expires_in_seconds: 300 }),
    );
    await expect(api(fetch).requestCode('+972502345678')).resolves.toEqual({
      resend_after_seconds: 60,
      expires_in_seconds: 300,
    });
    expect(requests).toEqual([
      {
        url: 'https://auth.test/auth/otp/request',
        method: 'POST',
        body: { phone: '+972502345678' },
        auth: null,
      },
    ]);
  });

  it('verifyCode sends phone, code and device', async () => {
    const { fetch, requests } = fakeFetch(() =>
      json(200, { status: 'registration_required', registration_token: 'r', expires_in: 600 }),
    );
    const result = await api(fetch).verifyCode('+972502345678', '123456', device);
    expect(result.status).toBe('registration_required');
    expect(requests[0]?.body).toEqual({ phone: '+972502345678', code: '123456', device });
  });

  it('register sends the registration token and display name', async () => {
    const tokens = {
      status: 'logged_in',
      access_token: 'a',
      token_type: 'Bearer',
      expires_in: 900,
      refresh_token: 'r',
    };
    const { fetch, requests } = fakeFetch(() => json(201, tokens));
    await expect(api(fetch).register('reg', 'Jacob', device)).resolves.toEqual(tokens);
    expect(requests[0]?.body).toEqual({
      registration_token: 'reg',
      display_name: 'Jacob',
      device,
    });
  });

  it('logout sends the access token as a Bearer header', async () => {
    const { fetch, requests } = fakeFetch(() => new Response(null, { status: 204 }));
    await api(fetch).logout('access-1');
    expect(requests[0]).toMatchObject({
      url: 'https://auth.test/auth/logout',
      auth: 'Bearer access-1',
    });
  });

  it('turns an error body into ApiError with its code', async () => {
    const { fetch } = fakeFetch(() =>
      json(400, { error: 'invalid_code', message: 'Wrong code, 4 tries left' }),
    );
    const error = await api(fetch)
      .verifyCode('+972502345678', '000000', device)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'invalid_code' });
    expect((error as Error).message).not.toContain('tries'); // never the server's text
  });

  it('reads Retry-After on 429', async () => {
    const { fetch } = fakeFetch(() =>
      json(429, { error: 'rate_limited', message: 'Slow down' }, { 'Retry-After': '42' }),
    );
    await expect(api(fetch).requestCode('+972502345678')).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSeconds: 42,
    });
  });

  // The exact answers from auth-service#14 (local ENVIRONMENT=dev server).
  it('reads the 429 limit and wait from the body', async () => {
    const { fetch } = fakeFetch(() =>
      json(
        429,
        {
          error: 'rate_limited',
          message: 'Too many code requests; try again later',
          limit: 'phone_hour',
          retry_after_seconds: 3599,
        },
        { 'Retry-After': '3599' },
      ),
    );
    const error = (await api(fetch)
      .requestCode('+972502345678')
      .catch((e: unknown) => e)) as ApiError;
    expect(error.details).toEqual({ limit: 'phone_hour', retryAfterSeconds: 3599 });
  });

  it.each([
    [
      {
        error: 'invalid_code',
        message: 'Wrong code; 4 attempts left',
        attempts_left: 4,
        resend_after_seconds: 60,
      },
      { attemptsLeft: 4, resendAfterSeconds: 60 },
    ],
    [
      { error: 'too_many_attempts', message: 'Too many wrong tries', resend_after_seconds: 60 },
      { resendAfterSeconds: 60 },
    ],
    [
      {
        error: 'code_expired',
        message: "This code can't be used anymore",
        resend_after_seconds: 0,
      },
      { resendAfterSeconds: 0 },
    ],
  ])('reads the verify error fields of %j', async (body, details) => {
    const { fetch } = fakeFetch(() => json(400, body));
    const error = (await api(fetch)
      .verifyCode('+972502345678', '000000', device)
      .catch((e: unknown) => e)) as ApiError;
    expect(error.code).toBe(body.error);
    expect(error.details).toEqual(details);
  });

  it('drops wrong or unknown field values instead of trusting them', async () => {
    const { fetch } = fakeFetch(() =>
      json(429, {
        error: 'rate_limited',
        limit: 'galaxy_day',
        retry_after_seconds: -5,
        attempts_left: '3',
        resend_after_seconds: 1.5,
      }),
    );
    const error = (await api(fetch)
      .requestCode('+972502345678')
      .catch((e: unknown) => e)) as ApiError;
    expect(error.details).toEqual({});
  });

  it('the daily SMS cap: 503 with Retry-After only in the header', async () => {
    const { fetch } = fakeFetch(() =>
      json(503, { error: 'sms_unavailable', message: "Can't send" }, { 'Retry-After': '2133' }),
    );
    await expect(api(fetch).requestCode('+972502345678')).rejects.toMatchObject({
      code: 'sms_unavailable',
      retryAfterSeconds: 2133,
    });
  });

  it('maps a non-JSON error (e.g. a proxy 502 page) to unknown', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api(fetch).requestCode('+972502345678')).rejects.toMatchObject({
      status: 502,
      code: 'unknown',
    });
  });

  it('maps an unknown error code to unknown', async () => {
    const { fetch } = fakeFetch(() => json(418, { error: 'teapot', message: '' }));
    await expect(api(fetch).requestCode('+972502345678')).rejects.toMatchObject({
      code: 'unknown',
    });
  });

  it('reports no connection as NetworkError(offline)', async () => {
    const fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    const error = await api(fetch as unknown as typeof globalThis.fetch)
      .requestCode('+972502345678')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).toMatchObject({ reason: 'offline' });
  });

  it('aborts after the timeout with NetworkError(timeout)', async () => {
    const fetch = jest.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((_resolve, reject) => {
          (input as Request).signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    await expect(
      api(fetch as unknown as typeof globalThis.fetch, 20).requestCode('+972502345678'),
    ).rejects.toMatchObject({ name: 'NetworkError', reason: 'timeout' });
  });
});
