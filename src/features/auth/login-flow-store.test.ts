import { ApiError, NetworkError } from '@/lib/api';
import { log } from '@/lib/log';
import { fakeApi, memoryItem, testClock } from '@/root/test-deps';

import type { LoginProgress } from './login-progress';
import { LoginFlowStore } from './login-flow-store';

const PHONE = '+972502345678';
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

function setup(saved: LoginProgress | null = null) {
  const api = fakeApi();
  const progress = memoryItem<LoginProgress>(saved);
  const completeLogin = jest.fn((_tokens: unknown) => Promise.resolve());
  const login = new LoginFlowStore({ api, completeLogin, device, progress, clock: testClock });
  return { login, api, progress, completeLogin };
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-11-09T10:00:00Z') });
});
afterEach(() => jest.useRealTimers());

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
    expect(progress.value).toMatchObject({ step: 'code', phone: PHONE });
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

  it('a short 429 (resend cooldown) goes to the code step: a code was just sent', async () => {
    const { login, api } = setup();
    api.requestCode.mockRejectedValue(new ApiError(429, 'rate_limited', 42));

    await expect(login.requestCode(PHONE)).resolves.toEqual({ ok: true });

    expect(login.step).toBe('code');
    expect(login.notice).toBe('code_already_sent');
    expect(login.secondsUntilResend).toBe(42);
  });

  it('a long 429 (hourly/daily limit) stays on the phone step with the wait', async () => {
    const { login, api } = setup();
    api.requestCode.mockRejectedValue(new ApiError(429, 'rate_limited', 1800));

    await expect(login.requestCode(PHONE)).resolves.toEqual({
      ok: false,
      error: { code: 'rate_limited', retryAfterSeconds: 1800 },
    });
    expect(login.step).toBe('phone');
  });

  it.each([
    [new ApiError(503, 'sms_unavailable'), 'sms_unavailable'],
    [new ApiError(400, 'invalid_phone'), 'invalid_phone'],
    [new NetworkError('offline'), 'no_connection'],
    [new ApiError(500, 'internal_error'), 'server_error'],
  ])('maps %s', async (error, code) => {
    jest.spyOn(log, 'warn').mockImplementation(() => {});
    const { login, api } = setup();
    api.requestCode.mockRejectedValue(error);
    await expect(login.requestCode(PHONE)).resolves.toEqual({ ok: false, error: { code } });
    expect(login.step).toBe('phone');
  });
});

describe('LoginFlowStore: back, resend and the countdown', () => {
  async function onCodeStep() {
    const s = setup();
    s.api.requestCode.mockResolvedValue(codeSent);
    await s.login.requestCode(PHONE);
    return s;
  }

  it('back is refused while the countdown runs (Change number waits like resend)', async () => {
    const { login, progress } = await onCodeStep();
    expect(login.canGoBack).toBe(false);
    await login.back();
    expect(login.step).toBe('code');
    expect(progress.value).not.toBeNull();
  });

  it('back after the countdown clears everything, in memory and in storage', async () => {
    const { login, progress } = await onCodeStep();
    login.setCountry('IL');
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

  // The owner's bug report: back, then the same number while its code was still valid used to skip the
  // request (and the countdown). Now back clears everything, so it's a real request with a fresh countdown.
  it('back, then the same number again: a new request and a fresh countdown', async () => {
    const { login, api } = await onCodeStep();
    advance(90);
    await login.back();
    await expect(login.requestCode(PHONE)).resolves.toEqual({ ok: true });
    expect(api.requestCode).toHaveBeenCalledTimes(2);
    expect(login.step).toBe('code');
    expect(login.secondsUntilResend).toBe(60);
    expect(login.canGoBack).toBe(false);
  });

  it('back, then a different number: a new request and a fresh countdown', async () => {
    const { login, api } = await onCodeStep();
    advance(60);
    await login.back();
    await login.requestCode('053-123-4567');
    expect(api.requestCode).toHaveBeenLastCalledWith('+972531234567');
    expect(login.phone).toBe('+972531234567');
    expect(login.secondsUntilResend).toBe(60);
  });

  it('the phone step is never saved', async () => {
    const { login, progress } = setup();
    login.setCountry('GB');
    await login.requestCode('07400 123456'); // blocked on the device
    await login.requestCode('03-123-4567'); // invalid
    expect(progress.save).not.toHaveBeenCalled();
  });

  it('resend waits for the countdown, then restarts it', async () => {
    const { login, api } = await onCodeStep();
    await expect(login.resendCode()).resolves.toEqual({
      ok: false,
      error: { code: 'resend_not_yet', retryAfterSeconds: 60 },
    });
    advance(60);
    await expect(login.resendCode()).resolves.toEqual({ ok: true });
    expect(api.requestCode).toHaveBeenCalledTimes(2);
    expect(login.secondsUntilResend).toBe(60);
    expect(login.canGoBack).toBe(false);
  });

  it("a short 429 on resend keeps the code step with the server's wait", async () => {
    const { login, api } = await onCodeStep();
    advance(60);
    api.requestCode.mockRejectedValue(new ApiError(429, 'rate_limited', 20));
    await expect(login.resendCode()).resolves.toEqual({
      ok: false,
      error: { code: 'resend_not_yet', retryAfterSeconds: 20 },
    });
    expect(login.step).toBe('code');
    expect(login.secondsUntilResend).toBe(20);
  });
});

describe('LoginFlowStore: code step', () => {
  async function onCodeStep() {
    const s = setup();
    s.api.requestCode.mockResolvedValue(codeSent);
    await s.login.requestCode(PHONE);
    return s;
  }

  it('a known number signs in: tokens handed over, the flow reset and nothing left saved', async () => {
    const { login, api, completeLogin, progress } = await onCodeStep();
    api.verifyCode.mockResolvedValue(loggedIn);

    await expect(login.verifyCode('123456')).resolves.toEqual({ ok: true });

    expect(api.verifyCode).toHaveBeenCalledWith(PHONE, '123456', device);
    expect(completeLogin).toHaveBeenCalledWith({
      access: 'access-1',
      refresh: 'refresh-1',
      accessExpiresAt: Date.now() + 900_000,
    });
    expect(login.step).toBe('phone');
    expect(login.phone).toBeNull();
    expect(progress.value).toBeNull();
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

  it('a wrong code stays on the code step', async () => {
    const { login, api } = await onCodeStep();
    api.verifyCode.mockRejectedValue(new ApiError(400, 'invalid_code'));
    await expect(login.verifyCode('000000')).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_code' },
    });
    expect(login.step).toBe('code');
  });

  it('an expired code goes back to an empty phone step with a notice', async () => {
    const { login, api, progress } = await onCodeStep();
    api.verifyCode.mockRejectedValue(new ApiError(400, 'code_expired'));
    await login.verifyCode('123456');
    expect(login.step).toBe('phone');
    expect(login.phone).toBeNull();
    expect(login.notice).toBe('code_expired');
    expect(progress.value).toBeNull();
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
    const s = setup();
    s.api.requestCode.mockResolvedValue(codeSent);
    s.api.verifyCode.mockResolvedValue(registrationRequired);
    await s.login.requestCode(PHONE);
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

  it('back (no countdown on the name step) deletes the registration token, also from storage', async () => {
    const { login, progress } = await onNameStep();
    expect(login.canGoBack).toBe(true);
    await login.back();
    expect(login.step).toBe('phone');
    expect(login.registrationToken).toBeNull();
    expect(progress.value).toBeNull();
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

describe('LoginFlowStore: restore after the app was closed', () => {
  const onCode = (now: number): LoginProgress => ({
    country: 'IL',
    step: 'code',
    phone: PHONE,
    resendAvailableAt: now + 30_000,
    codeExpiresAt: now + 200_000,
    registrationToken: null,
    registrationExpiresAt: null,
  });

  it('resumes the code step with its countdown while the code is valid', async () => {
    const { login } = setup(onCode(Date.now()));
    await login.restore();
    expect(login.step).toBe('code');
    expect(login.phone).toBe(PHONE);
    expect(login.secondsUntilResend).toBe(30);
  });

  it('once the code expired: an empty phone step and the storage cleared', async () => {
    const { login, progress } = setup(onCode(Date.now() - 250_000));
    await login.restore();
    expect(login.step).toBe('phone');
    expect(login.phone).toBeNull();
    expect(progress.value).toBeNull();
  });

  it('resumes the name step while the registration token is valid', async () => {
    const now = Date.now();
    const { login } = setup({
      ...onCode(now),
      step: 'name',
      resendAvailableAt: null,
      codeExpiresAt: null,
      registrationToken: 'reg',
      registrationExpiresAt: now + 300_000,
    });
    await login.restore();
    expect(login.step).toBe('name');
    expect(login.registrationToken).toBe('reg');
  });

  it('drops an expired registration token', async () => {
    const now = Date.now();
    const { login, progress } = setup({
      ...onCode(now),
      step: 'name',
      registrationToken: 'reg',
      registrationExpiresAt: now - 1,
    });
    await login.restore();
    expect(login.step).toBe('phone');
    expect(login.registrationToken).toBeNull();
    expect(progress.value).toBeNull();
  });

  it('starts fresh when nothing is saved', async () => {
    const { login } = setup();
    await login.restore();
    expect(login.step).toBe('phone');
    expect(login.phone).toBeNull();
  });
});
