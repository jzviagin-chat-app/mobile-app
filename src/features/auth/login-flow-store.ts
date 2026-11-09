import { flow, makeAutoObservable, observable, type ObservableMap } from 'mobx';

import { ApiError, type AuthApi, type DeviceIn, type LoggedIn } from '@/lib/api';
import type { Clock } from '@/lib/clock';
import { log } from '@/lib/log';
import { tokensFromReply, type StoredTokens } from '@/lib/token-storage';

import { canSignIn, DEFAULT_COUNTRY } from './countries';
import { fail, ok, toLoginError, type LoginResult } from './errors';
import type { CodeTimers, LoginProgress, LoginProgressStorage } from './login-progress';
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
 *     └────── back() ───────┴────────────────────────────────────────┘ back() drops the token
 *
 * Every action returns a LoginResult and never throws. The progress is saved after each change, so
 * closing the app resumes where it was (no new SMS, no surprise 429).
 */
export class LoginFlowStore {
  country: CountryCode = DEFAULT_COUNTRY;
  step: LoginStep = 'phone';
  /** E.164, once a code was requested for it. */
  phone: string | null = null;
  /** Per number, so going back and re-entering the same number keeps its countdown. */
  readonly codes: ObservableMap<string, CodeTimers> = observable.map();
  registrationToken: string | null = null;
  registrationExpiresAt: number | null = null;
  notice: LoginNotice | null = null;

  private readonly deps: LoginFlowDeps;

  constructor(deps: LoginFlowDeps) {
    this.deps = deps;
    makeAutoObservable<this, 'deps'>(this, { deps: false }, { autoBind: true });
  }

  private get now(): number {
    return this.deps.clock.now;
  }

  /** Seconds until a new code may be requested for the current number (ticks while shown). */
  get secondsUntilResend(): number {
    const timers = this.phone ? this.codes.get(this.phone) : undefined;
    if (!timers) return 0;
    return Math.max(0, Math.ceil((timers.resendAvailableAt - this.now) / 1000));
  }

  setCountry(country: CountryCode): void {
    this.country = country;
  }

  /** Phone step → code step. Reuses a still-valid code for the same number instead of sending an SMS. */
  requestCode = flow(function* (this: LoginFlowStore, rawPhone: string) {
    const phone = toE164(this.country, rawPhone);
    if (!phone) return fail('invalid_phone');
    if (!canSignIn(this.country)) return fail('country_not_available'); // no request: server is IL-only

    this.notice = null;
    const existing = this.codes.get(phone);
    if (existing && existing.expiresAt > Date.now()) {
      this.goToCode(phone);
      yield this.save();
      return ok;
    }
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
        this.codes.delete(phone); // the code is used up either way
        if (reply.status === 'logged_in') {
          yield this.finish(reply);
          return ok;
        }
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
          this.codes.delete(phone);
          this.backToPhone('code_expired');
          yield this.save();
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
      yield this.dropRegistration('registration_expired');
      return fail('registration_expired');
    }
    try {
      const reply: LoggedIn = yield this.deps.api.register(token, name, this.deps.device);
      yield this.finish(reply);
      return ok;
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.code === 'invalid_registration_token' || error.code === 'already_registered')
      ) {
        const notice =
          error.code === 'already_registered' ? 'already_registered' : 'registration_expired';
        yield this.dropRegistration(notice);
      }
      return toLoginError(error);
    }
  });

  /** Back (Android back button, "Change number"): code → phone keeps the number's timers; name → phone
   * deletes the registration token. */
  back = flow(function* (this: LoginFlowStore) {
    if (this.step === 'phone') return;
    if (this.step === 'name') {
      this.registrationToken = null;
      this.registrationExpiresAt = null;
    }
    this.backToPhone(null);
    yield this.save();
  });

  /** Back to an empty flow and nothing saved (after sign-in). */
  reset = flow(function* (this: LoginFlowStore) {
    this.country = DEFAULT_COUNTRY;
    this.step = 'phone';
    this.phone = null;
    this.codes.clear();
    this.registrationToken = null;
    this.registrationExpiresAt = null;
    this.notice = null;
    yield this.deps.progress.clear();
  });

  /** At startup: resume a saved login if its code / registration token is still valid. */
  restore = flow(function* (this: LoginFlowStore) {
    let saved: LoginProgress | null = null;
    try {
      saved = yield this.deps.progress.load();
    } catch {
      log.error('Could not read the saved login progress');
    }
    if (!saved) return;
    const now = Date.now();
    this.country = saved.country as CountryCode;
    this.phone = saved.phone;
    for (const [phone, timers] of Object.entries(saved.codes)) {
      if (timers.expiresAt > now || timers.resendAvailableAt > now) this.codes.set(phone, timers);
    }
    const codeValid = !!saved.phone && (saved.codes[saved.phone]?.expiresAt ?? 0) > now;
    const tokenValid = !!saved.registrationToken && (saved.registrationExpiresAt ?? 0) > now;
    if (saved.step === 'name' && tokenValid) {
      this.registrationToken = saved.registrationToken;
      this.registrationExpiresAt = saved.registrationExpiresAt;
      this.step = 'name';
    } else if (saved.step === 'code' && codeValid) {
      this.step = 'code';
    } else {
      this.step = 'phone';
    }
    yield this.save(); // writes back without the expired parts
  });

  // ---- internals ----

  private sendCode = flow(function* (this: LoginFlowStore, phone: string) {
    const now = Date.now();
    try {
      const sent: Awaited<ReturnType<LoginFlowDeps['api']['requestCode']>> =
        yield this.deps.api.requestCode(phone);
      this.codes.set(phone, {
        resendAvailableAt: now + sent.resend_after_seconds * 1000,
        expiresAt: now + sent.expires_in_seconds * 1000,
      });
      this.goToCode(phone);
      yield this.save();
      return ok;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'rate_limited') {
        const wait = error.retryAfterSeconds ?? COOLDOWN_SECONDS;
        if (wait <= COOLDOWN_SECONDS) {
          // The resend cooldown: a code went out under a minute ago and is still valid.
          const known = this.codes.get(phone);
          this.codes.set(phone, {
            resendAvailableAt: now + wait * 1000,
            expiresAt: known?.expiresAt ?? now + CODE_LEFT_AFTER_COOLDOWN_MS,
          });
          const wasOnCode = this.step === 'code';
          this.goToCode(phone);
          if (!wasOnCode) this.notice = 'code_already_sent';
          yield this.save();
          return wasOnCode ? fail('resend_not_yet', wait) : ok;
        }
      }
      return toLoginError(error);
    }
  });

  private finish = flow(function* (this: LoginFlowStore, reply: LoggedIn) {
    yield this.deps.completeLogin(tokensFromReply(reply, Date.now()));
    yield this.reset();
  });

  private dropRegistration = flow(function* (this: LoginFlowStore, notice: LoginNotice) {
    this.registrationToken = null;
    this.registrationExpiresAt = null;
    this.backToPhone(notice);
    yield this.save();
  });

  private goToCode(phone: string): void {
    this.phone = phone;
    this.step = 'code';
  }

  private backToPhone(notice: LoginNotice | null): void {
    this.step = 'phone';
    this.notice = notice;
  }

  private async save(): Promise<void> {
    const progress: LoginProgress = {
      country: this.country,
      step: this.step,
      phone: this.phone,
      codes: Object.fromEntries(this.codes),
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
