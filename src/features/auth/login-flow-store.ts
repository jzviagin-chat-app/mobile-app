import { flow, makeAutoObservable, reaction } from 'mobx';

import { ApiError, type AuthApi, type DeviceIn, type LoggedIn } from '@/lib/api';
import type { Clock } from '@/lib/clock';
import { log } from '@/lib/log';
import { tokensFromReply, type StoredTokens } from '@/lib/token-storage';

import { canSignIn, DEFAULT_COUNTRY } from './countries';
import { fail, ok, toLoginError, type LoginResult } from './errors';
import type { LoginProgress, LoginProgressStorage } from './login-progress';
import { toE164, type CountryCode } from './phone';
import { activeBlocks, noBlocks, type SendBlocks, type SendBlocksStorage } from './send-blocks';

export type LoginStep = 'phone' | 'code' | 'name';

/** A message shown on the step the user lands on after the flow moved them (e.g. back to the phone). */
export type LoginNotice = 'code_expired' | 'registration_expired' | 'already_registered';

/** `too_many_attempts`: this code can't be used any more; a new one must be requested. */
export type CodeState = 'active' | 'too_many_attempts';

/** Why sending a code is blocked right now (shown with a live countdown). */
export type SendBlock = { reason: 'number' | 'network' | 'sms'; seconds: number };

export type LoginFlowDeps = {
  api: Pick<AuthApi, 'requestCode' | 'verifyCode' | 'register'>;
  /** Only what the flow needs from the session (AuthStore.completeLogin). */
  completeLogin: (tokens: StoredTokens) => Promise<void>;
  device: DeviceIn;
  progress: LoginProgressStorage;
  blocks: SendBlocksStorage;
  clock: Clock;
};

const NAME_MAX = 50;

/**
 * The login in progress, as a state machine (one /auth route renders the current step):
 *
 *   phone ──requestCode──► code ──verify: logged_in──────────────► signed in (reset)
 *     ▲                     │   └─verify: registration_required──► name ──register──► signed in
 *     ├────── back() ───────┘                                       │
 *     └──────────── the code / registration token expired ──────────┘   (all cleared, with a notice)
 *
 * Rules (owner, 2026-11-09…12):
 * - Back to the phone step clears everything, in memory and in storage; the phone step is never saved.
 * - On the code step, "Change number" goes back at any time, unless the device is locked (a network limit
 *   or the daily SMS cap): then it counts down with "Send a new code". Android's back button does nothing
 *   on the code and name steps; the name step has no way back (owner, 2026-11-13).
 * - Too many wrong tries keep the code step (input disabled) until a new code is sent.
 * - When the code or the registration token expires, the login starts over: while the app is open (a
 *   reaction on the clock), at startup, or when the server says so. Deadlines are absolute times on the
 *   phone's clock, so time the app spent closed counts too.
 * - The code and name steps are saved after every change; the server's send blocks in their own item. Every
 *   wait survives a restart.
 * - Send blocks are the only record of waits (owner, 2026-11-13): one device lock (`blocks.all`: every
 *   number, from `ip_*` or the daily SMS cap) and one wait per number (`blocks.numbers`: its cooldown or
 *   hour / day limit). They outlive the code step: after sign-in, sign-out, back or expiry, a waiting
 *   number shows its countdown instead of asking the server; other numbers are free unless the device is
 *   locked. Each entry is removed when its time is up. A refused request (`429 resend_cooldown` included)
 *   never moves the flow on: the app can't know whether a code is waiting, so it shows the wait.
 *
 * Every action returns a LoginResult and never throws.
 */
export class LoginFlowStore {
  country: CountryCode = DEFAULT_COUNTRY;
  step: LoginStep = 'phone';
  /** E.164, once a code was requested for it. */
  phone: string | null = null;
  codeExpiresAt: number | null = null;
  codeState: CodeState = 'active';
  /** Tries left for this code, after a wrong one (null: none wrong yet). */
  attemptsLeft: number | null = null;
  /** Unix ms: when the next try is allowed, if the server asked to wait after a wrong code. */
  codeRetryAvailableAt: number | null = null;
  registrationToken: string | null = null;
  registrationExpiresAt: number | null = null;
  notice: LoginNotice | null = null;
  blocks: SendBlocks = noBlocks;

  private readonly deps: LoginFlowDeps;
  private readonly stopExpiry: () => void;
  private readonly stopPrune: () => void;

  constructor(deps: LoginFlowDeps) {
    this.deps = deps;
    // Read-only helpers stay plain functions: as actions they would be untracked, and the countdowns
    // that call them would never update.
    makeAutoObservable<
      this,
      'deps' | 'stopExpiry' | 'stopPrune' | 'blockUntil' | 'secondsUntil' | 'expiredAt'
    >(
      this,
      {
        deps: false,
        stopExpiry: false,
        stopPrune: false,
        blockFor: false,
        blockUntil: false,
        secondsUntil: false,
        expiredAt: false,
      },
      { autoBind: true },
    );
    // While the app is open: start over when the code / registration token expires. `expired` reads the
    // clock only on the code and name steps, so the clock ticks only then.
    this.stopExpiry = reaction(
      () => this.expired,
      (expired) => {
        if (expired) void this.expire(expired);
      },
    );
    // Each send block is removed (also from storage) when its time is up. Reads the clock only while a
    // block exists, so the clock ticks only then.
    this.stopPrune = reaction(
      () => this.blockEnded,
      (ended) => {
        if (ended) void this.pruneBlocks();
      },
    );
  }

  dispose(): void {
    this.stopExpiry();
    this.stopPrune();
  }

  /** Seconds until a new code may be sent to this number: its own wait or the device lock (live). */
  get secondsUntilResend(): number {
    return this.secondsUntil(this.blockUntil(this.phone)?.until ?? 0);
  }

  /** Seconds until the device lock ends (every number blocked: network limit, daily SMS cap). */
  get secondsUntilUnlock(): number {
    return this.secondsUntil(this.blocks.all?.until ?? 0);
  }

  /** Seconds until the next try of this code, if the server asked to wait after a wrong one. */
  get secondsUntilCodeRetry(): number {
    return this.secondsUntil(this.codeRetryAvailableAt ?? 0);
  }

  /** The code field is usable: tries left and no wait running. */
  get canEnterCode(): boolean {
    return this.codeState === 'active' && this.secondsUntilCodeRetry === 0;
  }

  /** "Change number": any time on the code step, unless the device is locked; never from the name step. */
  get canGoBack(): boolean {
    return this.step === 'code' && this.secondsUntilUnlock === 0;
  }

  /** What blocks sending a code to this E.164 number now (or to every number), or null. */
  blockFor(phone: string | null): SendBlock | null {
    const block = this.blockUntil(phone);
    if (!block) return null;
    const seconds = this.secondsUntil(block.until);
    return seconds > 0 ? { reason: block.reason, seconds } : null;
  }

  setCountry(country: CountryCode): void {
    this.country = country;
  }

  /** Phone step → code step. */
  requestCode = flow(function* (this: LoginFlowStore, rawPhone: string) {
    const phone = toE164(this.country, rawPhone);
    if (!phone) return fail('invalid_phone');
    if (!canSignIn(this.country)) return fail('country_not_available'); // no request: server is IL-only
    if (this.blockFor(phone)) return fail('blocked'); // the screen shows the countdown
    this.notice = null;
    const result: LoginResult = yield this.sendCode(phone);
    return result;
  });

  /** Code step: a new SMS for the same number, once the countdown allows it. */
  resendCode = flow(function* (this: LoginFlowStore) {
    if (!this.phone) return fail('invalid_phone');
    if (this.secondsUntilResend > 0) return fail('blocked');
    this.notice = null;
    const result: LoginResult = yield this.sendCode(this.phone);
    return result;
  });

  /** Code step → signed in (known number) or name step (new number). */
  verifyCode = flow(function* (this: LoginFlowStore, code: string) {
    const phone = this.phone;
    if (!phone) return fail('code_expired');
    if (!this.canEnterCode) return fail('blocked');
    for (let attempt = 1; ; attempt++) {
      try {
        const reply: Awaited<ReturnType<LoginFlowDeps['api']['verifyCode']>> =
          yield this.deps.api.verifyCode(phone, code, this.deps.device);
        if (reply.status === 'logged_in') {
          yield this.finish(reply);
          return ok;
        }
        // The code is used up; the name step has no countdown.
        this.clearCode();
        this.registrationToken = reply.registration_token;
        this.registrationExpiresAt = Date.now() + reply.expires_in * 1000;
        this.step = 'name';
        this.notice = null;
        yield this.save();
        return ok;
      } catch (error) {
        // Another login of this user won a race: the server asks to retry with the same code (once).
        if (error instanceof ApiError && error.code === 'login_conflict' && attempt === 1) continue;
        if (error instanceof ApiError) {
          const handled: LoginResult | null = yield this.codeRefused(error);
          if (handled) return handled;
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
   * Back to the phone step ("Change number", Android back) from the code step: clears everything. Ignored
   * while the countdown runs, and on the name step.
   */
  back = flow(function* (this: LoginFlowStore) {
    if (!this.canGoBack) return;
    yield this.reset();
  });

  /** An empty flow and nothing saved (after back, expiry and sign-in). The send blocks stay. */
  reset = flow(function* (this: LoginFlowStore) {
    this.country = DEFAULT_COUNTRY;
    this.step = 'phone';
    this.phone = null;
    this.clearCode();
    this.registrationToken = null;
    this.registrationExpiresAt = null;
    this.notice = null;
    try {
      yield this.deps.progress.clear();
    } catch {
      log.warn('Could not clear the login progress');
    }
  });

  /**
   * At startup: the send blocks still running, and a saved code / name step if its code / registration
   * token is still valid (with only the time left: the closed time is subtracted). Expired → an empty phone
   * step saying so.
   */
  restore = flow(function* (this: LoginFlowStore) {
    try {
      const saved: SendBlocks | null = yield this.deps.blocks.load();
      const active = activeBlocks(saved ?? noBlocks, Date.now());
      this.blocks = active;
      if (saved && JSON.stringify(saved) !== JSON.stringify(active)) yield this.saveBlocks(active);
    } catch {
      log.error('Could not read the saved send blocks');
    }
    let saved: LoginProgress | null = null;
    try {
      saved = yield this.deps.progress.load();
    } catch {
      log.error('Could not read the saved login progress');
    }
    if (!saved) return;
    this.country = saved.country as CountryCode;
    this.step = saved.step;
    this.phone = saved.phone;
    this.codeExpiresAt = saved.codeExpiresAt;
    this.codeState = saved.codeState;
    this.attemptsLeft = saved.attemptsLeft;
    this.codeRetryAvailableAt = saved.codeRetryAvailableAt;
    this.registrationToken = saved.registrationToken;
    this.registrationExpiresAt = saved.registrationExpiresAt;
    const expired = this.expiredAt(Date.now());
    if (expired) yield this.expire(expired);
  });

  // ---- internals ----

  /** A send block's time is up (reads the clock only while there is one). */
  private get blockEnded(): boolean {
    const ends = [this.blocks.all?.until, ...this.blocks.numbers.map((block) => block.until)];
    const first = Math.min(...ends.filter((until): until is number => until !== undefined));
    return Number.isFinite(first) && this.deps.clock.now >= first;
  }

  private pruneBlocks = flow(function* (this: LoginFlowStore) {
    yield this.saveBlocks(activeBlocks(this.blocks, Date.now()));
  });

  /** Which deadline has passed on the code / name step (reads the clock only there). */
  private get expired(): 'code' | 'name' | null {
    if (this.step === 'phone') return null;
    return this.expiredAt(this.deps.clock.now);
  }

  private expiredAt(now: number): 'code' | 'name' | null {
    if (this.step === 'code') return (this.codeExpiresAt ?? 0) <= now ? 'code' : null;
    if (this.step === 'name') {
      const valid = this.registrationToken !== null && (this.registrationExpiresAt ?? 0) > now;
      return valid ? null : 'name';
    }
    return null;
  }

  /** The code / registration token expired: start over (the number's resend wait stays a send block). */
  private expire = flow(function* (this: LoginFlowStore, what: 'code' | 'name') {
    yield this.startOver(what === 'code' ? 'code_expired' : 'registration_expired');
  });

  /** The verify errors this flow handles itself (null: not one of them). */
  private codeRefused = flow(function* (this: LoginFlowStore, error: ApiError) {
    const now = Date.now();
    const { attemptsLeft, resendAfterSeconds, retryAfterSeconds } = error.details;
    if (resendAfterSeconds !== undefined && this.phone) {
      yield this.waitForResend(this.phone, now + resendAfterSeconds * 1000);
    }
    switch (error.code) {
      case 'invalid_code':
        this.attemptsLeft = attemptsLeft ?? null;
        this.codeRetryAvailableAt =
          retryAfterSeconds !== undefined ? now + retryAfterSeconds * 1000 : null;
        yield this.save();
        return fail('invalid_code');
      case 'too_many_attempts':
        this.codeState = 'too_many_attempts';
        this.attemptsLeft = 0;
        this.codeRetryAvailableAt = null;
        yield this.save();
        return fail('too_many_attempts');
      case 'code_expired':
        yield this.expire('code');
        return fail('code_expired');
      default:
        return null;
    }
  });

  private sendCode = flow(function* (this: LoginFlowStore, phone: string) {
    const now = Date.now();
    try {
      const sent: Awaited<ReturnType<LoginFlowDeps['api']['requestCode']>> =
        yield this.deps.api.requestCode(phone);
      this.toCode(phone, now + sent.expires_in_seconds * 1000);
      this.clearCodeAttempts();
      yield this.save();
      const until = now + sent.resend_after_seconds * 1000;
      // A long wait names its limit (planned in auth-service): the network's locks every number. Without
      // a name it's this number's (owner, 2026-11-13).
      if (sent.limit === 'ip_hour' || sent.limit === 'ip_day')
        yield this.blockAll('network', until);
      else yield this.waitForResend(phone, until);
      return ok;
    } catch (error) {
      if (!(error instanceof ApiError)) return toLoginError(error);
      const wait = error.retryAfterSeconds;
      if (error.code === 'rate_limited' && wait !== undefined) {
        const until = now + wait * 1000;
        if (error.details.limit === 'ip_hour' || error.details.limit === 'ip_day') {
          yield this.blockAll('network', until);
        } else {
          // resend_cooldown (a code went out within the last minute: maybe before a lost reply, a reinstall
          // or a sign-in; whether it can still be used is unknown, so wait instead of guessing), phone_hour,
          // phone_day, or no limit named. The flow stays where it is.
          yield this.waitForResend(phone, until);
        }
        return fail('blocked');
      }
      if (error.code === 'sms_unavailable' && wait !== undefined) {
        yield this.blockAll('sms', now + wait * 1000);
        return fail('blocked');
      }
      return toLoginError(error);
    }
  });

  private toCode(phone: string, codeExpiresAt: number): void {
    this.phone = phone;
    this.codeExpiresAt = codeExpiresAt;
    this.step = 'code';
  }

  /**
   * When this number may get a new code: its send block (outlives the code step, see the class comment).
   * Only ever later: after the hour's last code the 202's wait is longer than the cooldown a verify error
   * reports.
   */
  private waitForResend = flow(function* (this: LoginFlowStore, phone: string, until: number) {
    yield this.blockNumber(phone, until);
  });

  /** A fresh code: typing allowed again. */
  private clearCodeAttempts(): void {
    this.codeState = 'active';
    this.attemptsLeft = null;
    this.codeRetryAvailableAt = null;
  }

  private clearCode(): void {
    this.codeExpiresAt = null;
    this.clearCodeAttempts();
  }

  private finish = flow(function* (this: LoginFlowStore, reply: LoggedIn) {
    yield this.deps.completeLogin(tokensFromReply(reply, Date.now()));
    yield this.reset(); // the send blocks stay: after a sign-out the number still waits (owner, 2026-11-13)
  });

  /** Back to an empty phone step, with a message saying why. */
  private startOver = flow(function* (this: LoginFlowStore, notice: LoginNotice) {
    yield this.reset();
    this.notice = notice;
  });

  private blockUntil(phone: string | null): { reason: SendBlock['reason']; until: number } | null {
    const all = this.blocks.all;
    const number = phone ? this.blocks.numbers.find((block) => block.phone === phone) : undefined;
    if (all && (!number || all.until >= number.until)) return all;
    return number ? { reason: 'number', until: number.until } : null;
  }

  private secondsUntil(until: number): number {
    if (until === 0) return 0;
    return Math.max(0, Math.ceil((until - this.deps.clock.now) / 1000));
  }

  private blockNumber = flow(function* (this: LoginFlowStore, phone: string, until: number) {
    const current = activeBlocks(this.blocks, Date.now());
    const existing = current.numbers.find((block) => block.phone === phone);
    if (existing && existing.until >= until) return; // only ever later
    const numbers = current.numbers.filter((block) => block.phone !== phone);
    yield this.saveBlocks({ ...current, numbers: [...numbers, { phone, until }] });
  });

  private blockAll = flow(function* (
    this: LoginFlowStore,
    reason: 'network' | 'sms',
    until: number,
  ) {
    yield this.saveBlocks({ ...activeBlocks(this.blocks, Date.now()), all: { reason, until } });
  });

  private async saveBlocks(blocks: SendBlocks): Promise<void> {
    this.blocks = blocks;
    try {
      await this.deps.blocks.save(blocks);
    } catch {
      log.warn('Could not save the send blocks'); // still enforced until the app closes
    }
  }

  /** Saves the code / name step (the phone step is never saved). */
  private async save(): Promise<void> {
    if (this.step === 'phone' || this.phone === null) return;
    const progress: LoginProgress = {
      country: this.country,
      step: this.step,
      phone: this.phone,
      codeExpiresAt: this.codeExpiresAt,
      codeState: this.codeState,
      attemptsLeft: this.attemptsLeft,
      codeRetryAvailableAt: this.codeRetryAvailableAt,
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
