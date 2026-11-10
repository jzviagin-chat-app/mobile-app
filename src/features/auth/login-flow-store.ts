import { flow, makeAutoObservable } from 'mobx';

import { ApiError, type AuthApi, type DeviceIn, type LoggedIn } from '@/lib/api';
import type { Clock } from '@/lib/clock';
import { log } from '@/lib/log';
import { tokensFromReply, type StoredTokens } from '@/lib/token-storage';

import { canSignIn, DEFAULT_COUNTRY } from './countries';
import { fail, ok, toLoginError, type LoginResult } from './errors';
import type { LoginProgress, LoginProgressStorage } from './login-progress';
import { toE164, type CountryCode } from './phone';

export type LoginStep = 'phone' | 'code' | 'name';

/** A message shown on the step the user lands on after the flow moved them (e.g. back to the phone). */
export type LoginNotice =
  'code_expired' | 'registration_expired' | 'already_registered' | 'code_already_sent';

export type LoginFlowDeps = {
  api: Pick<AuthApi, 'requestCode' | 'verifyCode' | 'register'>;
  /** Only what the flow needs from the session (AuthStore.completeLogin). */
  completeLogin: (tokens: StoredTokens) => Promise<void>;
  device: DeviceIn;
  progress: LoginProgressStorage;
  clock: Clock;
};

/** A 429 this short means "a code was sent under a minute ago" (the resend cooldown), not an hourly limit. */
const COOLDOWN_SECONDS = 60;
/** When a 429 hides the real timers: the code (5 min) was sent within the last minute, so ≥ 4 min left. */
const CODE_LEFT_AFTER_COOLDOWN_MS = 4 * 60_000;
const NAME_MAX = 50;

/**
 * The login in progress, as a state machine (one /auth route renders the current step):
 *
 *   phone ──requestCode──► code ──verify: logged_in──────────────► signed in (reset)
 *     ▲                     │   └─verify: registration_required──► name ──register──► signed in
 *     └────── back() ───────┴──────────────────────────────── back() ┘   (back = reset: all cleared)
 *
 * Rules (owner, 2026-11-09/10):
 * - Back to the phone step clears everything, in memory and in storage; the phone step is never saved.
 * - On the code step, back ("Change number", Android back) waits for the same countdown as "Send a new
 *   code".
 * - The code and name steps are saved after every change, so closing the app resumes there (no new SMS,
 *   no surprise 429) while the code / registration token is still valid.
 *
 * Every action returns a LoginResult and never throws.
 */
export class LoginFlowStore {
  country: CountryCode = DEFAULT_COUNTRY;
  step: LoginStep = 'phone';
  /** E.164, once a code was requested for it. */
  phone: string | null = null;
  /** Unix ms (phone clock): when "Send a new code" / "Change number" become available. */
  resendAvailableAt: number | null = null;
  codeExpiresAt: number | null = null;
  registrationToken: string | null = null;
  registrationExpiresAt: number | null = null;
  notice: LoginNotice | null = null;

  private readonly deps: LoginFlowDeps;

  constructor(deps: LoginFlowDeps) {
    this.deps = deps;
    makeAutoObservable<this, 'deps'>(this, { deps: false }, { autoBind: true });
  }

  /** Seconds until a new code may be requested (ticks every second while a screen shows it). */
  get secondsUntilResend(): number {
    if (this.resendAvailableAt === null) return 0;
    return Math.max(0, Math.ceil((this.resendAvailableAt - this.deps.clock.now) / 1000));
  }

  /** Back is allowed from the name step, and from the code step once the countdown is over. */
  get canGoBack(): boolean {
    if (this.step === 'name') return true;
    return this.step === 'code' && this.secondsUntilResend === 0;
  }

  setCountry(country: CountryCode): void {
    this.country = country;
  }

  /** Phone step → code step. */
  requestCode = flow(function* (this: LoginFlowStore, rawPhone: string) {
    const phone = toE164(this.country, rawPhone);
    if (!phone) return fail('invalid_phone');
    if (!canSignIn(this.country)) return fail('country_not_available'); // no request: server is IL-only
    this.notice = null;
    const result: LoginResult = yield this.sendCode(phone);
    return result;
  });

  /** Code step: a new SMS for the same number, once the countdown allows it. */
  resendCode = flow(function* (this: LoginFlowStore) {
    if (!this.phone) return fail('invalid_phone');
    if (this.secondsUntilResend > 0) return fail('resend_not_yet', this.secondsUntilResend);
    this.notice = null;
    const result: LoginResult = yield this.sendCode(this.phone);
    return result;
  });

  /** Code step → signed in (known number) or name step (new number). */
  verifyCode = flow(function* (this: LoginFlowStore, code: string) {
    const phone = this.phone;
    if (!phone) return fail('code_expired');
    for (let attempt = 1; ; attempt++) {
      try {
        const reply: Awaited<ReturnType<LoginFlowDeps['api']['verifyCode']>> =
          yield this.deps.api.verifyCode(phone, code, this.deps.device);
        if (reply.status === 'logged_in') {
          yield this.finish(reply);
          return ok;
        }
        // The code is used up; the name step has no countdown.
        this.resendAvailableAt = null;
        this.codeExpiresAt = null;
        this.registrationToken = reply.registration_token;
        this.registrationExpiresAt = Date.now() + reply.expires_in * 1000;
        this.step = 'name';
        this.notice = null;
        yield this.save();
        return ok;
      } catch (error) {
        // Another login of this user won a race: the server asks to retry with the same code (once).
        if (error instanceof ApiError && error.code === 'login_conflict' && attempt === 1) continue;
        if (error instanceof ApiError && error.code === 'code_expired') {
          yield this.startOver('code_expired');
        }
        return toLoginError(error);
      }
    }
  });

  /** Name step → signed in (a new account). */
  register = flow(function* (this: LoginFlowStore, rawName: string) {
    const name = rawName.trim();
    if (name.length < 1 || name.length > NAME_MAX) return fail('invalid_name');
    const token = this.registrationToken;
    if (!token || (this.registrationExpiresAt ?? 0) <= Date.now()) {
      yield this.startOver('registration_expired');
      return fail('registration_expired');
    }
    try {
      const reply: LoggedIn = yield this.deps.api.register(token, name, this.deps.device);
      yield this.finish(reply);
      return ok;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_registration_token') {
        yield this.startOver('registration_expired');
      } else if (error instanceof ApiError && error.code === 'already_registered') {
        yield this.startOver('already_registered');
      }
      return toLoginError(error);
    }
  });

  /**
   * Back to the phone step ("Change number", Android back): clears everything. Ignored on the code step
   * while the countdown runs.
   */
  back = flow(function* (this: LoginFlowStore) {
    if (!this.canGoBack) return;
    yield this.reset();
  });

  /** An empty flow and nothing saved (after back and after sign-in). */
  reset = flow(function* (this: LoginFlowStore) {
    this.country = DEFAULT_COUNTRY;
    this.step = 'phone';
    this.phone = null;
    this.resendAvailableAt = null;
    this.codeExpiresAt = null;
    this.registrationToken = null;
    this.registrationExpiresAt = null;
    this.notice = null;
    try {
      yield this.deps.progress.clear();
    } catch {
      log.warn('Could not clear the login progress');
    }
  });

  /** At startup: resume a saved code / name step while its code / registration token is still valid. */
  restore = flow(function* (this: LoginFlowStore) {
    let saved: LoginProgress | null = null;
    try {
      saved = yield this.deps.progress.load();
    } catch {
      log.error('Could not read the saved login progress');
    }
    if (!saved) return;
    const now = Date.now();
    const codeValid = saved.step === 'code' && (saved.codeExpiresAt ?? 0) > now;
    const nameValid =
      saved.step === 'name' &&
      saved.registrationToken !== null &&
      (saved.registrationExpiresAt ?? 0) > now;
    if (!codeValid && !nameValid) {
      yield this.reset();
      return;
    }
    this.country = saved.country as CountryCode;
    this.step = saved.step;
    this.phone = saved.phone;
    this.resendAvailableAt = saved.resendAvailableAt;
    this.codeExpiresAt = saved.codeExpiresAt;
    this.registrationToken = saved.registrationToken;
    this.registrationExpiresAt = saved.registrationExpiresAt;
  });

  // ---- internals ----

  private sendCode = flow(function* (this: LoginFlowStore, phone: string) {
    const now = Date.now();
    const wasOnCode = this.step === 'code';
    try {
      const sent: Awaited<ReturnType<LoginFlowDeps['api']['requestCode']>> =
        yield this.deps.api.requestCode(phone);
      this.toCode(
        phone,
        now + sent.resend_after_seconds * 1000,
        now + sent.expires_in_seconds * 1000,
      );
      yield this.save();
      return ok;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'rate_limited') {
        const wait = error.retryAfterSeconds ?? COOLDOWN_SECONDS;
        if (wait <= COOLDOWN_SECONDS) {
          // The resend cooldown: a code went out under a minute ago and is still valid.
          this.toCode(
            phone,
            now + wait * 1000,
            this.codeExpiresAt ?? now + CODE_LEFT_AFTER_COOLDOWN_MS,
          );
          if (!wasOnCode) this.notice = 'code_already_sent';
          yield this.save();
          return wasOnCode ? fail('resend_not_yet', wait) : ok;
        }
      }
      return toLoginError(error);
    }
  });

  private toCode(phone: string, resendAvailableAt: number, codeExpiresAt: number): void {
    this.phone = phone;
    this.resendAvailableAt = resendAvailableAt;
    this.codeExpiresAt = codeExpiresAt;
    this.step = 'code';
  }

  private finish = flow(function* (this: LoginFlowStore, reply: LoggedIn) {
    yield this.deps.completeLogin(tokensFromReply(reply, Date.now()));
    yield this.reset();
  });

  /** Back to an empty phone step, with a message saying why. */
  private startOver = flow(function* (this: LoginFlowStore, notice: LoginNotice) {
    yield this.reset();
    this.notice = notice;
  });

  /** Saves the code / name step (the phone step is never saved). */
  private async save(): Promise<void> {
    if (this.step === 'phone' || this.phone === null) return;
    const progress: LoginProgress = {
      country: this.country,
      step: this.step,
      phone: this.phone,
      resendAvailableAt: this.resendAvailableAt,
      codeExpiresAt: this.codeExpiresAt,
      registrationToken: this.registrationToken,
      registrationExpiresAt: this.registrationExpiresAt,
    };
    try {
      await this.deps.progress.save(progress);
    } catch {
      log.warn('Could not save the login progress'); // the flow still works, it just won't survive a restart
    }
  }
}
