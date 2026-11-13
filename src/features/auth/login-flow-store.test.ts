import { ApiError, NetworkError } from '@/lib/api';
import { toApiError } from '@/lib/api/errors';
import { createClock, type Clock } from '@/lib/clock';
import { log } from '@/lib/log';
import { fakeApi, memoryItem, testClock } from '@/root/test-deps';

import type { LoginProgress } from './login-progress';
import { LoginFlowStore } from './login-flow-store';
import type { SendBlocks } from './send-blocks';

const PHONE = '+972502345678';
const OTHER = '+972531234567';
const device = { platform: 'android', name: 'Test phone' } as const;
const loggedIn = {
  status: 'logged_in',
  access_token: 'access-1',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'refresh-1',
} as const;
const registrationRequired = {
  status: 'registration_required',
  registration_token: 'reg-secret-token-value-123',
  expires_in: 600,
} as const;
const codeSent = { resend_after_seconds: 60, expires_in_seconds: 300 };

/** An error exactly as auth-service sends it (auth-service#14 report), through the real parser. */
function server(status: number, body: object, retryAfter?: number): ApiError {
  const headers = retryAfter === undefined ? undefined : { 'Retry-After': String(retryAfter) };
  return toApiError(new Response(null, { status, headers }), body);
}
const rateLimited = (limit: string, seconds: number) =>
  server(
    429,
    {
      error: 'rate_limited',
      message: 'Too many code requests; try again later',
      limit,
      retry_after_seconds: seconds,
    },
    seconds,
  );
const invalidCode = (attemptsLeft: number, resendAfter: number, extra: object = {}) =>
  server(400, {
    error: 'invalid_code',
    message: `Wrong code; ${attemptsLeft} attempts left`,
    attempts_left: attemptsLeft,
    resend_after_seconds: resendAfter,
    ...extra,
  });
const tooManyAttempts = (resendAfter: number) =>
  server(400, {
    error: 'too_many_attempts',
    message: 'Too many wrong tries for this code; request a new one',
    resend_after_seconds: resendAfter,
  });
const codeExpired = (resendAfter: number) =>
  server(400, {
    error: 'code_expired',
    message: "This code can't be used anymore; request a new one",
    resend_after_seconds: resendAfter,
  });

const stores: LoginFlowStore[] = [];

function setup(
  saved: LoginProgress | null = null,
  savedBlocks: SendBlocks | null = null,
  clock: Clock = testClock,
) {
  const api = fakeApi();
  const progress = memoryItem<LoginProgress>(saved);
  const blocks = memoryItem<SendBlocks>(savedBlocks);
  const completeLogin = jest.fn((_tokens: unknown) => Promise.resolve());
  const login = new LoginFlowStore({ api, completeLogin, device, progress, blocks, clock });
  stores.push(login);
  return { login, api, progress, blocks, completeLogin };
}

/** The app closed and opened again: a new store from what the old one saved. */
async function reopen(previous: ReturnType<typeof setup>, clock: Clock = testClock) {
  previous.login.dispose();
  const next = setup(previous.progress.value, previous.blocks.value, clock);
  await next.login.restore();
  return next;
}

async function onCodeStep(sent = codeSent) {
  const s = setup();
  s.api.requestCode.mockResolvedValue(sent);
  await s.login.requestCode(PHONE);
  return s;
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-09T10:00:00Z') });
});
afterEach(() => {
  stores.splice(0).forEach((store) => store.dispose());
  jest.useRealTimers();
});

/** Time passes without the clock ticking (the app closed, or nothing on screen). */
const advance = (seconds: number) => jest.setSystemTime(Date.now() + seconds * 1000);

describe('LoginFlowStore: phone step', () => {
  it('requests a code and moves to the code step', async () => {
    const { login, api, progress } = setup();
    api.requestCode.mockResolvedValue(codeSent);

    await expect(login.requestCode('050-234-5678')).resolves.toEqual({ ok: true });

    expect(api.requestCode).toHaveBeenCalledWith(PHONE);
    expect(login.step).toBe('code');
    expect(login.phone).toBe(PHONE);
    expect(login.secondsUntilResend).toBe(60);
    expect(progress.value).toMatchObject({ step: 'code', phone: PHONE, codeState: 'active' });
  });

  it('rejects an invalid number without a request', async () => {
    const { login, api } = setup();
    await expect(login.requestCode('03-123-4567')).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_phone' },
    });
    expect(api.requestCode).not.toHaveBeenCalled();
  });

  it('blocks a valid number of a country that cannot sign in yet, without a request', async () => {
    const { login, api } = setup();
    login.setCountry('GB');
    await expect(login.requestCode('07400 123456')).resolves.toEqual({
      ok: false,
      error: { code: 'country_not_available' },
    });
    expect(api.requestCode).not.toHaveBeenCalled();
  });

  it('429 resend_cooldown stays on the phone step: that number waits, nothing is guessed', async () => {
    // E.g. the reply to the first request was lost, or the app was reinstalled: a code may or may not be
    // waiting, so the app doesn't open the code step (owner, 2026-11-13).
    const { login, api, blocks } = setup();
    api.requestCode.mockRejectedValueOnce(rateLimited('resend_cooldown', 42));

    await expect(login.requestCode(PHONE)).resolves.toEqual({
      ok: false,
      error: { code: 'blocked' },
    });

    expect(login.step).toBe('phone');
    expect(login.notice).toBeNull();
    expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 42 });
    expect(login.blockFor(OTHER)).toBeNull();
    expect(blocks.value?.numbers).toEqual([{ phone: PHONE, until: Date.now() + 42_000 }]);
    await login.requestCode(PHONE);
    expect(api.requestCode).toHaveBeenCalledTimes(1); // no second request while it runs

    advance(42);
    expect(login.blockFor(PHONE)).toBeNull();
    api.requestCode.mockResolvedValueOnce(codeSent);
    await expect(login.requestCode(PHONE)).resolves.toEqual({ ok: true });
    expect(login.step).toBe('code');
  });

  it('429 phone_hour blocks only that number, with the countdown, and without new requests', async () => {
    const { login, api, blocks } = setup();
    api.requestCode.mockRejectedValueOnce(rateLimited('phone_hour', 3599));

    await expect(login.requestCode(PHONE)).resolves.toEqual({
      ok: false,
      error: { code: 'blocked' },
    });
    expect(login.step).toBe('phone');
    expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 3599 });
    expect(login.blockFor(OTHER)).toBeNull();
    expect(blocks.value?.numbers).toEqual([{ phone: PHONE, until: Date.now() + 3_599_000 }]);

    // Tapping again while blocked sends nothing.
    await expect(login.requestCode(PHONE)).resolves.toEqual({
      ok: false,
      error: { code: 'blocked' },
    });
    expect(api.requestCode).toHaveBeenCalledTimes(1);

    // Another number still works.
    api.requestCode.mockResolvedValueOnce(codeSent);
    await expect(login.requestCode('053-123-4567')).resolves.toEqual({ ok: true });
  });

  it.each(['ip_hour', 'ip_day'])('429 %s blocks every number', async (limit) => {
    const { login, api } = setup();
    api.requestCode.mockRejectedValueOnce(rateLimited(limit, 3599));
    await login.requestCode(PHONE);
    expect(login.blockFor(PHONE)).toEqual({ reason: 'network', seconds: 3599 });
    expect(login.blockFor(OTHER)).toEqual({ reason: 'network', seconds: 3599 });
    expect(login.blockFor(null)).toEqual({ reason: 'network', seconds: 3599 });
    await login.requestCode('053-123-4567');
    expect(api.requestCode).toHaveBeenCalledTimes(1);
  });

  it('503 sms_unavailable with Retry-After (the daily cap) blocks every number', async () => {
    const { login, api } = setup();
    api.requestCode.mockRejectedValueOnce(
      server(503, { error: 'sms_unavailable', message: "Can't send codes right now" }, 2133),
    );
    await expect(login.requestCode(PHONE)).resolves.toEqual({
      ok: false,
      error: { code: 'blocked' },
    });
    expect(login.blockFor(OTHER)).toEqual({ reason: 'sms', seconds: 2133 });
  });

  it.each([
    [new ApiError(503, 'sms_unavailable'), 'sms_unavailable'],
    [new ApiError(429, 'unknown'), 'rate_limited'], // the ingress's own 429: no body, no wait
    [new ApiError(400, 'invalid_phone'), 'invalid_phone'],
    [new NetworkError('offline'), 'no_connection'],
    [new ApiError(500, 'internal_error'), 'server_error'],
  ])('maps %s', async (error, code) => {
    jest.spyOn(log, 'warn').mockImplementation(() => {});
    const { login, api } = setup();
    api.requestCode.mockRejectedValue(error);
    await expect(login.requestCode(PHONE)).resolves.toEqual({ ok: false, error: { code } });
    expect(login.step).toBe('phone');
    expect(login.blockFor(PHONE)).toBeNull();
  });

  it('the phone step is never saved', async () => {
    const { login, progress } = setup();
    login.setCountry('GB');
    await login.requestCode('07400 123456'); // blocked on the device
    await login.requestCode('03-123-4567'); // invalid
    expect(progress.save).not.toHaveBeenCalled();
  });
});

describe('LoginFlowStore: back, resend and the countdown', () => {
  it('back is refused while the countdown runs (Change number waits like resend)', async () => {
    const { login, progress } = await onCodeStep();
    expect(login.canGoBack).toBe(false);
    await login.back();
    expect(login.step).toBe('code');
    expect(progress.value).not.toBeNull();
  });

  it('back waits for the full countdown, even an hour (after the hour’s last code)', async () => {
    const { login } = await onCodeStep({ resend_after_seconds: 3599, expires_in_seconds: 300 });
    expect(login.secondsUntilResend).toBe(3599);
    advance(60);
    expect(login.canGoBack).toBe(false);
  });

  it('back after the countdown clears everything, in memory and in storage', async () => {
    const { login, progress } = await onCodeStep();
    advance(60);
    expect(login.canGoBack).toBe(true);
    await login.back();
    expect(login).toMatchObject({
      step: 'phone',
      phone: null,
      resendAvailableAt: null,
      codeExpiresAt: null,
      country: 'IL',
      notice: null,
    });
    expect(progress.value).toBeNull();
  });

  it('back, then the same number again: a new request and a fresh countdown', async () => {
    const { login, api } = await onCodeStep();
    advance(90);
    await login.back();
    await expect(login.requestCode(PHONE)).resolves.toEqual({ ok: true });
    expect(api.requestCode).toHaveBeenCalledTimes(2);
    expect(login.secondsUntilResend).toBe(60);
  });

  it('resend waits for the countdown, then restarts it and opens a locked code again', async () => {
    const { login, api } = await onCodeStep();
    await expect(login.resendCode()).resolves.toEqual({ ok: false, error: { code: 'blocked' } });
    api.verifyCode.mockRejectedValue(tooManyAttempts(10));
    await login.verifyCode('000000');
    expect(login.canEnterCode).toBe(false);
    advance(60);
    await expect(login.resendCode()).resolves.toEqual({ ok: true });
    expect(api.requestCode).toHaveBeenCalledTimes(2);
    expect(login.secondsUntilResend).toBe(60);
    expect(login.codeState).toBe('active');
    expect(login.attemptsLeft).toBeNull();
    expect(login.canEnterCode).toBe(true);
  });

  it('429 resend_cooldown on resend keeps the code step with the server’s wait', async () => {
    const { login, api } = await onCodeStep();
    advance(60);
    api.requestCode.mockRejectedValue(rateLimited('resend_cooldown', 20));
    await expect(login.resendCode()).resolves.toEqual({ ok: false, error: { code: 'blocked' } });
    expect(login.step).toBe('code');
    expect(login.secondsUntilResend).toBe(20);
  });

  it('429 phone_hour on resend: the countdown and the block message for this number', async () => {
    const { login, api } = await onCodeStep();
    advance(60);
    api.requestCode.mockRejectedValue(rateLimited('phone_hour', 3000));
    await login.resendCode();
    expect(login.step).toBe('code');
    expect(login.secondsUntilResend).toBe(3000);
    expect(login.blockFor(login.phone)).toEqual({ reason: 'number', seconds: 3000 });
    expect(login.canGoBack).toBe(false);
  });
});

describe('LoginFlowStore: code step', () => {
  it('a known number signs in: tokens handed over, the flow reset and the progress cleared', async () => {
    const { login, api, completeLogin, progress, blocks } = await onCodeStep();
    api.verifyCode.mockResolvedValue(loggedIn);

    await expect(login.verifyCode('123456')).resolves.toEqual({ ok: true });

    expect(api.verifyCode).toHaveBeenCalledWith(PHONE, '123456', device);
    expect(completeLogin).toHaveBeenCalledWith({
      access: 'access-1',
      refresh: 'refresh-1',
      accessExpiresAt: Date.now() + 900_000,
    });
    expect(login.step).toBe('phone');
    expect(progress.value).toBeNull();
    // The number's wait for a new code stays (see "after signing in" below).
    expect(blocks.value?.numbers).toEqual([{ phone: PHONE, until: Date.now() + 60_000 }]);
  });

  it('a new number moves to the name step with the registration token', async () => {
    const { login, api, progress } = await onCodeStep();
    api.verifyCode.mockResolvedValue(registrationRequired);
    await login.verifyCode('123456');
    expect(login.step).toBe('name');
    expect(progress.value).toMatchObject({
      step: 'name',
      registrationToken: 'reg-secret-token-value-123',
      registrationExpiresAt: Date.now() + 600_000,
    });
  });

  it('a wrong code: stays, tries left, typing allowed at once (no wait from the server)', async () => {
    const { login, api, progress } = await onCodeStep();
    advance(10);
    api.verifyCode.mockRejectedValue(invalidCode(4, 50));
    await expect(login.verifyCode('000000')).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_code' },
    });
    expect(login.step).toBe('code');
    expect(login.attemptsLeft).toBe(4);
    expect(login.canEnterCode).toBe(true);
    expect(login.secondsUntilResend).toBe(50);
    expect(progress.value).toMatchObject({ attemptsLeft: 4, codeRetryAvailableAt: null });
  });

  it('the resend wait only grows: the 202’s hour wait beats a verify error’s cooldown', async () => {
    const { login, api } = await onCodeStep({
      resend_after_seconds: 3599,
      expires_in_seconds: 300,
    });
    api.verifyCode.mockRejectedValue(invalidCode(4, 60));
    await login.verifyCode('000000');
    expect(login.secondsUntilResend).toBe(3599);
  });

  it('a wait the server asks for after a wrong code disables typing until it ends (mocked)', async () => {
    const { login, api } = await onCodeStep();
    api.verifyCode.mockRejectedValue(invalidCode(3, 60, { retry_after_seconds: 20 }));
    await login.verifyCode('000000');
    expect(login.canEnterCode).toBe(false);
    expect(login.secondsUntilCodeRetry).toBe(20);
    await expect(login.verifyCode('111111')).resolves.toEqual({
      ok: false,
      error: { code: 'blocked' },
    });
    expect(api.verifyCode).toHaveBeenCalledTimes(1);
    advance(20);
    expect(login.canEnterCode).toBe(true);
  });

  it('too_many_attempts: stays on the code step, typing disabled, resend after the cooldown', async () => {
    const { login, api, progress } = await onCodeStep();
    advance(15);
    api.verifyCode.mockRejectedValue(tooManyAttempts(45));
    await expect(login.verifyCode('000000')).resolves.toEqual({
      ok: false,
      error: { code: 'too_many_attempts' },
    });
    expect(login.step).toBe('code');
    expect(login.codeState).toBe('too_many_attempts');
    expect(login.canEnterCode).toBe(false);
    expect(login.secondsUntilResend).toBe(45);
    expect(login.canGoBack).toBe(false);
    expect(progress.value).toMatchObject({ codeState: 'too_many_attempts' });
    advance(45);
    expect(login.canGoBack).toBe(true);
  });

  it('code_expired from the server: an empty phone step, the resend wait kept for that number', async () => {
    const { login, api, progress } = await onCodeStep();
    api.verifyCode.mockRejectedValue(codeExpired(30));
    await login.verifyCode('123456');
    expect(login.step).toBe('phone');
    expect(login.phone).toBeNull();
    expect(login.notice).toBe('code_expired');
    expect(progress.value).toBeNull();
    expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 60 }); // the 202's 60 s
  });

  it('retries once on login_conflict', async () => {
    const { login, api } = await onCodeStep();
    api.verifyCode
      .mockRejectedValueOnce(new ApiError(409, 'login_conflict'))
      .mockResolvedValueOnce(loggedIn);
    await expect(login.verifyCode('123456')).resolves.toEqual({ ok: true });
    expect(api.verifyCode).toHaveBeenCalledTimes(2);
  });

  it('a blocked account is reported', async () => {
    const { login, api } = await onCodeStep();
    api.verifyCode.mockRejectedValue(new ApiError(403, 'account_blocked'));
    await expect(login.verifyCode('123456')).resolves.toEqual({
      ok: false,
      error: { code: 'account_blocked' },
    });
  });
});

describe('LoginFlowStore: name step', () => {
  async function onNameStep() {
    const s = await onCodeStep();
    s.api.verifyCode.mockResolvedValue(registrationRequired);
    await s.login.verifyCode('123456');
    return s;
  }

  it('registers with the trimmed name and signs in', async () => {
    const { login, api, completeLogin, progress } = await onNameStep();
    api.register.mockResolvedValue(loggedIn);
    await expect(login.register('  Jacob ')).resolves.toEqual({ ok: true });
    expect(api.register).toHaveBeenCalledWith('reg-secret-token-value-123', 'Jacob', device);
    expect(completeLogin).toHaveBeenCalled();
    expect(login.registrationToken).toBeNull();
    expect(progress.value).toBeNull();
  });

  it.each(['', '   ', 'x'.repeat(51)])('rejects the name %j without a request', async (name) => {
    const { login, api } = await onNameStep();
    await expect(login.register(name)).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_name' },
    });
    expect(api.register).not.toHaveBeenCalled();
  });

  it('has no way back: back() does nothing', async () => {
    const { login, progress } = await onNameStep();
    expect(login.canGoBack).toBe(false);
    await login.back();
    expect(login.step).toBe('name');
    expect(login.registrationToken).toBe('reg-secret-token-value-123');
    expect(progress.value).toMatchObject({ step: 'name' });
  });

  it('an expired registration token (locally) goes back to the phone step without a request', async () => {
    const { login, api } = await onNameStep();
    advance(601);
    await expect(login.register('Jacob')).resolves.toEqual({
      ok: false,
      error: { code: 'registration_expired' },
    });
    expect(api.register).not.toHaveBeenCalled();
    expect(login.step).toBe('phone');
    expect(login.notice).toBe('registration_expired');
  });

  it.each([
    ['invalid_registration_token', 'registration_expired'],
    ['already_registered', 'already_registered'],
  ] as const)('%s from the server goes back to the phone step', async (serverCode, code) => {
    const { login, api } = await onNameStep();
    api.register.mockRejectedValue(new ApiError(401, serverCode));
    await expect(login.register('Jacob')).resolves.toEqual({ ok: false, error: { code } });
    expect(login.step).toBe('phone');
    expect(login.registrationToken).toBeNull();
    expect(login.notice).toBe(code);
  });

  it('never logs the registration token', async () => {
    const spies = (['debug', 'info', 'warn', 'error'] as const).map((level) =>
      jest.spyOn(log, level).mockImplementation(() => {}),
    );
    const { login, api } = await onNameStep();
    api.register.mockRejectedValue(new ApiError(500, 'internal_error'));
    await login.register('Jacob');
    const logged = JSON.stringify(spies.map((spy) => spy.mock.calls));
    expect(logged).not.toContain('reg-secret-token-value-123');
  });
});

// Owner, 2026-11-13: sign in, sign out and enter the same number within the minute. The server refuses
// (resend_cooldown), so the app must already know the wait and show it, without a request.
describe('LoginFlowStore: the wait for a new code outlives the login', () => {
  it('after signing in and out, the same number counts down without a request', async () => {
    const { login, api } = await onCodeStep();
    advance(9);
    api.verifyCode.mockResolvedValue(loggedIn);
    await login.verifyCode('123456');
    advance(6); // signed out again (the session's business; the flow is already reset)

    expect(login.step).toBe('phone');
    expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 45 });
    await expect(login.requestCode(PHONE)).resolves.toEqual({
      ok: false,
      error: { code: 'blocked' },
    });
    expect(api.requestCode).toHaveBeenCalledTimes(1);

    // Another number isn't affected.
    api.requestCode.mockResolvedValueOnce(codeSent);
    await expect(login.requestCode('053-123-4567')).resolves.toEqual({ ok: true });
  });

  it('after the wait, the same number gets a new code at once', async () => {
    const { login, api } = await onCodeStep();
    api.verifyCode.mockResolvedValue(loggedIn);
    await login.verifyCode('123456');
    advance(60);
    expect(login.blockFor(PHONE)).toBeNull();
    api.requestCode.mockResolvedValueOnce(codeSent);
    await expect(login.requestCode(PHONE)).resolves.toEqual({ ok: true });
    expect(api.requestCode).toHaveBeenCalledTimes(2);
  });

  it('a new number: the wait survives the name step and the sign-up', async () => {
    const { login, api } = await onCodeStep();
    api.verifyCode.mockResolvedValue(registrationRequired);
    await login.verifyCode('123456');
    api.register.mockResolvedValue(loggedIn);
    advance(20);
    await login.register('Dana');
    expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 40 });
  });

  it("an hour's wait from the 202 (the window's last code) is kept the same way", async () => {
    const { login, api } = await onCodeStep({
      resend_after_seconds: 3540,
      expires_in_seconds: 300,
    });
    api.verifyCode.mockResolvedValue(loggedIn);
    await login.verifyCode('123456');
    expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 3540 });
  });

  it('a verify error that moves the wait later moves the kept wait too', async () => {
    const { login, api } = await onCodeStep();
    api.verifyCode.mockRejectedValueOnce(invalidCode(4, 90));
    await login.verifyCode('000000');
    api.verifyCode.mockResolvedValue(loggedIn);
    await login.verifyCode('123456');
    expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 90 });
  });

  it('reopened after signing out, inside the wait: the countdown continues', async () => {
    const first = await onCodeStep();
    first.api.verifyCode.mockResolvedValue(loggedIn);
    await first.login.verifyCode('123456');
    advance(25);
    const { login, api } = await reopen(first);
    expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 35 });
    await login.requestCode(PHONE);
    expect(api.requestCode).not.toHaveBeenCalled();
  });

  it('reopened after the wait: nothing to wait for, the block is dropped', async () => {
    const first = await onCodeStep();
    first.api.verifyCode.mockResolvedValue(loggedIn);
    await first.login.verifyCode('123456');
    advance(61);
    const { login, blocks } = await reopen(first);
    expect(login.blockFor(PHONE)).toBeNull();
    expect(blocks.value).toEqual({ all: null, numbers: [] });
  });

  it('a block never gets shorter: a later, shorter wait keeps the longer one', async () => {
    const { login, api } = await onCodeStep();
    advance(60);
    api.requestCode.mockRejectedValueOnce(rateLimited('phone_hour', 3599));
    await login.resendCode(); // the hour's limit: a long block
    api.verifyCode.mockRejectedValueOnce(invalidCode(4, 30)); // then a verify error says 30 s
    await login.verifyCode('000000');
    expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 3599 });
    expect(login.secondsUntilResend).toBe(3599);
  });
});

// The owner's scenarios (2026-11-12): every wait continues after closing and reopening the app, and is
// gone when the app stayed closed longer than the wait.
describe('LoginFlowStore: waits survive closing the app', () => {
  describe('a. a refused code request', () => {
    async function refused(limit: string, seconds: number) {
      const s = setup();
      s.api.requestCode.mockRejectedValue(rateLimited(limit, seconds));
      await s.login.requestCode(PHONE);
      return s;
    }

    it('phone_hour on the phone step: reopened during the wait, the countdown continues', async () => {
      const first = await refused('phone_hour', 90);
      advance(30);
      const { login } = await reopen(first);
      expect(login.step).toBe('phone');
      expect(login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 60 });
    });

    it('ip_hour: reopened after the wait, nothing to wait for and the block is dropped', async () => {
      const first = await refused('ip_hour', 90);
      advance(91);
      const { login, api, blocks } = await reopen(first);
      expect(login.blockFor(PHONE)).toBeNull();
      expect(login.blockFor(OTHER)).toBeNull();
      api.requestCode.mockResolvedValue(codeSent);
      await expect(login.requestCode(PHONE)).resolves.toEqual({ ok: true });
      expect(blocks.value?.all).toBeNull();
    });

    it('refused on the code step (resend): the countdown continues, then ends', async () => {
      const first = await onCodeStep();
      advance(60);
      first.api.requestCode.mockRejectedValue(rateLimited('phone_hour', 120));
      await first.login.resendCode();
      advance(40);
      const during = await reopen(first);
      expect(during.login.step).toBe('code');
      expect(during.login.secondsUntilResend).toBe(80);
      expect(during.login.canGoBack).toBe(false);
      // Closed again past the wait (the code expired too by then: 60 + 40 + 200 s > 300 s).
      advance(200);
      const after = await reopen(during);
      expect(after.login.step).toBe('phone');
      expect(after.login.notice).toBe('code_expired');
      expect(after.login.blockFor(PHONE)).toBeNull();
    });
  });

  describe('b. a wait after a wrong code (mocked server field)', () => {
    async function wrongWithWait() {
      const s = await onCodeStep();
      s.api.verifyCode.mockRejectedValue(invalidCode(3, 60, { retry_after_seconds: 30 }));
      await s.login.verifyCode('000000');
      return s;
    }

    it('reopened during the wait: typing still disabled, the countdown continues', async () => {
      const first = await wrongWithWait();
      advance(10);
      const { login } = await reopen(first);
      expect(login.step).toBe('code');
      expect(login.canEnterCode).toBe(false);
      expect(login.secondsUntilCodeRetry).toBe(20);
      expect(login.attemptsLeft).toBe(3);
    });

    it('reopened after the wait: typing allowed at once', async () => {
      const first = await wrongWithWait();
      advance(31);
      const { login } = await reopen(first);
      expect(login.step).toBe('code');
      expect(login.canEnterCode).toBe(true);
      expect(login.secondsUntilCodeRetry).toBe(0);
    });
  });

  describe('c. no tries left', () => {
    async function locked() {
      const s = await onCodeStep();
      s.api.verifyCode.mockRejectedValue(tooManyAttempts(60));
      await s.login.verifyCode('000000');
      return s;
    }

    it('reopened during the cooldown: locked, resend and Change number count down', async () => {
      const first = await locked();
      advance(25);
      const { login } = await reopen(first);
      expect(login.step).toBe('code');
      expect(login.codeState).toBe('too_many_attempts');
      expect(login.canEnterCode).toBe(false);
      expect(login.secondsUntilResend).toBe(35);
      expect(login.canGoBack).toBe(false);
    });

    it('reopened after the cooldown: resend and Change number usable at once', async () => {
      const first = await locked();
      advance(61);
      const { login, api } = await reopen(first);
      expect(login.codeState).toBe('too_many_attempts');
      expect(login.secondsUntilResend).toBe(0);
      expect(login.canGoBack).toBe(true);
      api.requestCode.mockResolvedValue(codeSent);
      await expect(login.resendCode()).resolves.toEqual({ ok: true });
      expect(login.canEnterCode).toBe(true);
    });
  });
});

// Owner (2026-11-12): when the code or the registration token expires, back to the first step, whether
// the app is open, closed, or reopened in time (the closed time is subtracted).
describe('LoginFlowStore: expiry', () => {
  it('the code expires while the app is open: the phone step with a notice, by itself', async () => {
    const clock = createClock();
    const s = setup(null, null, clock);
    s.api.requestCode.mockResolvedValue({ resend_after_seconds: 400, expires_in_seconds: 300 });
    await s.login.requestCode(PHONE);
    await jest.advanceTimersByTimeAsync(299_000);
    expect(s.login.step).toBe('code');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(s.login.step).toBe('phone');
    expect(s.login.notice).toBe('code_expired');
    expect(s.progress.value).toBeNull();
    // The resend wait outlives the code: kept for that number (here 100 s left).
    expect(s.login.blockFor(PHONE)).toEqual({ reason: 'number', seconds: 100 });
  });

  it('a locked code expires too (too many tries, then the 5 minutes run out)', async () => {
    const clock = createClock();
    const s = setup(null, null, clock);
    s.api.requestCode.mockResolvedValue(codeSent);
    s.api.verifyCode.mockRejectedValue(tooManyAttempts(60));
    await s.login.requestCode(PHONE);
    await s.login.verifyCode('000000');
    await jest.advanceTimersByTimeAsync(300_000);
    expect(s.login.step).toBe('phone');
    expect(s.login.notice).toBe('code_expired');
  });

  it('the registration token expires while the app is open', async () => {
    const clock = createClock();
    const s = setup(null, null, clock);
    s.api.requestCode.mockResolvedValue(codeSent);
    s.api.verifyCode.mockResolvedValue(registrationRequired);
    await s.login.requestCode(PHONE);
    await s.login.verifyCode('123456');
    await jest.advanceTimersByTimeAsync(599_000);
    expect(s.login.step).toBe('name');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(s.login.step).toBe('phone');
    expect(s.login.notice).toBe('registration_expired');
    expect(s.login.registrationToken).toBeNull();
    expect(s.progress.value).toBeNull();
  });

  it('closed until after the code expired: reopens on the phone step with the notice', async () => {
    const first = await onCodeStep();
    advance(301);
    const { login, progress } = await reopen(first);
    expect(login.step).toBe('phone');
    expect(login.phone).toBeNull();
    expect(login.notice).toBe('code_expired');
    expect(progress.value).toBeNull();
  });

  it('closed until after the registration token expired: the phone step with the notice', async () => {
    const first = await onCodeStep();
    first.api.verifyCode.mockResolvedValue(registrationRequired);
    await first.login.verifyCode('123456');
    advance(601);
    const { login, progress } = await reopen(first);
    expect(login.step).toBe('phone');
    expect(login.notice).toBe('registration_expired');
    expect(login.registrationToken).toBeNull();
    expect(progress.value).toBeNull();
  });

  it('reopened inside the window: the code step with only the time left (closed time subtracted)', async () => {
    const first = await onCodeStep();
    advance(120);
    const clock = createClock();
    const { login } = await reopen(first, clock);
    expect(login.step).toBe('code');
    expect(login.secondsUntilResend).toBe(0); // 60 s cooldown, 120 s closed
    expect(login.codeExpiresAt! - Date.now()).toBe(180_000);
    await jest.advanceTimersByTimeAsync(179_000);
    expect(login.step).toBe('code');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(login.step).toBe('phone');
    expect(login.notice).toBe('code_expired');
  });

  it('reopened inside the registration window: the name step, expiring after the time left', async () => {
    const first = await onCodeStep();
    first.api.verifyCode.mockResolvedValue(registrationRequired);
    await first.login.verifyCode('123456');
    advance(400);
    const clock = createClock();
    const { login } = await reopen(first, clock);
    expect(login.step).toBe('name');
    await jest.advanceTimersByTimeAsync(199_000);
    expect(login.step).toBe('name');
    await jest.advanceTimersByTimeAsync(1_000);
    expect(login.step).toBe('phone');
    expect(login.notice).toBe('registration_expired');
  });

  it('after dispose() the expiry no longer acts', async () => {
    const clock = createClock();
    const s = setup(null, null, clock);
    s.api.requestCode.mockResolvedValue(codeSent);
    await s.login.requestCode(PHONE);
    s.login.dispose();
    await jest.advanceTimersByTimeAsync(301_000);
    expect(s.login.step).toBe('code');
    expect(jest.getTimerCount()).toBe(0); // the clock stopped ticking: nothing observes it
  });

  it('starts fresh when nothing is saved', async () => {
    const { login } = setup();
    await login.restore();
    expect(login.step).toBe('phone');
    expect(login.notice).toBeNull();
  });
});
