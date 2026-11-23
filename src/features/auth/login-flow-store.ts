import { flow, makeAutoObservable, observable, reaction } from 'mobx';

import { ApiError, type AuthApi, type DeviceIn, type LoggedIn } from '@/lib/api';
import type { Clock } from '@/lib/clock';
import { log } from '@/lib/log';
import { createPersister, type Persister } from '@/lib/persister';
import { tokensFromReply, type StoredTokens } from '@/lib/token-storage';

import { canSignIn, DEFAULT_COUNTRY } from './countries';
import { fail, ok, toLoginError, type LoginResult } from './errors';
import type { LoginProgress, LoginProgressStorage } from './login-progress';
import { toE164, type CountryCode } from './phone';
import { activeBlocks, noBlocks, type SendBlocks, type SendBlocksStorage } from './send-blocks';

export type LoginStep = 'phone' | 'code' | 'name';

/** A message shown on the step the user lands on after the flow moved them (e.g. back to the phone). */
export type LoginNotice =
  | 'registration_expired'
  | 'already_registered'
  /** The server ended the session (refresh refused): sign in again. */
  | 'session_ended'
  | 'account_blocked';

/**
 * `too_many_attempts`: this code can't be used any more; a new one must be requested (typing disabled).
 * `expired`: its time ran out (phone clock or the server's `code_expired`); the user is told so and stays
 * on the code step (owner, 2026-11-13), typing still allowed (a newer code may arrive).
 */
export type CodeState = 'active' | 'too_many_attempts' | 'expired';

/** Why sending a code is blocked right now (shown with a live countdown). */
export type SendBlock = { reason: 'number' | 'network' | 'sms'; seconds: number };

/** Every number is blocked until `until` (Unix ms): this network's limit or the daily SMS cap. */
export type DeviceLock = NonNullable<SendBlocks['all']>;

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
 *     └──────────── the registration token expired ─────────────────┘   (all cleared, with a notice)
 *   (the code expired: the code step stays and says so; "Send a new code" is the way on)
 *
 * Rules (owner, 2026-11-09…12):
 * - Back to the phone step clears everything, in memory and in storage; the phone step is never saved.
 * - On the code step, "Change number" goes back at any time, unless the device is locked (a network limit
 *   or the daily SMS cap): then it counts down with "Send a new code". Android's back button does nothing
 *   on the code and name steps; the name step has no way back (owner, 2026-11-13).
 * - Too many wrong tries keep the code step (input disabled) until a new code is sent.
 * - When the code expires (the phone's clock while open or at startup, or the server's `code_expired`), the
 *   code step stays and says so; "Send a new code" is the way on (owner, 2026-11-13). When the registration
 *   token expires, the login starts over at the phone step. Deadlines are absolute times on the phone's
 *   clock, so time the app spent closed counts too.
 * - The code and name steps are saved automatically after every change (a reaction on `progress`), the
 *   server's send blocks in their own item (a reaction on `savedBlocks`): actions only change fields. Every wait
 *   survives a restart.
 * - Send blocks are the only record of waits (owner, 2026-11-13): one device lock (`deviceLock`: every
 *   number, from `ip_*` or the daily SMS cap) and one wait per number (`numberWaits`: its cooldown or
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
  /** Development builds only: what ended the session (`refresh → 401 invalid_refresh_token · 14:03:12`). */
  noticeDetail: string | null = null;
  /** The device lock: every number waits (null: none). */
  deviceLock: DeviceLock | null = null;
  /** One wait per number: E.164 → until (Unix ms). Changed in place; the reaction on `savedBlocks` saves it. */
  readonly numberWaits = observable.map<string, number>();

  private readonly deps: LoginFlowDeps;
  private readonly progressWriter: Persister<LoginProgress>;
  private readonly blocksWriter: Persister<SendBlocks>;
  private readonly disposers: (() => void)[];

  constructor(deps: LoginFlowDeps) {
    this.deps = deps;
    this.progressWriter = createPersister(deps.progress, () =>
      log.warn('Could not save the login progress'),
    ); // the flow still works, it just won't survive a restart
    this.blocksWriter = createPersister(deps.blocks, () =>
      log.warn('Could not save the send blocks'),
    ); // still enforced until the app closes
    // Read-only helpers stay plain functions: as actions they would be untracked, and the countdowns
    // that call them would never update.
    makeAutoObservable<
      this,
      | 'deps'
      | 'progressWriter'
      | 'blocksWriter'
      | 'disposers'
      | 'blockUntil'
      | 'secondsUntil'
      | 'expiredAt'
    >(
      this,
      {
        deps: false,
        progressWriter: false,
        blocksWriter: false,
        disposers: false,
        blockFor: false,
        blockUntil: false,
        secondsUntil: false,
        expiredAt: false,
      },
      { autoBind: true },
    );
    this.disposers = [
      // Saving: whatever an action changed, once it ends (null deletes the item).
      reaction(
        () => this.progress,
        (progress) => this.progressWriter.write(progress),
      ),
      reaction(
        () => this.savedBlocks,
        (blocks) => this.blocksWriter.write(blocks),
      ),
      // While the app is open: the code / registration token expired. `expired` reads the clock only on
      // the code and name steps, so the clock ticks only then.
      reaction(
        () => this.expired,
        (expired) => {
          if (expired) this.expire(expired);
        },
      ),
      // Each send block is removed when its time is up. Reads the clock only while a block exists, so the
      // clock ticks only then.
      reaction(
        () => this.blockEnded,
        (ended) => {
          if (ended) this.pruneBlocks();
        },
      ),
    ];
  }

  dispose(): void {
    for (const stop of this.disposers) stop();
  }

  /** Resolves when every change so far is in storage (tests; nothing in the app needs to wait). */
  saved(): Promise<void> {
    return Promise.all([this.progressWriter.idle(), this.blocksWriter.idle()]).then(
      () => undefined,
    );
  }

  /** Seconds until a new code may be sent to this number: its own wait or the device lock (live). */
  get secondsUntilResend(): number {
    return this.secondsUntil(this.blockUntil(this.phone)?.until ?? 0);
  }

  /** Seconds until the device lock ends (every number blocked: network limit, daily SMS cap). */
  get secondsUntilUnlock(): number {
    return this.secondsUntil(this.deviceLock?.until ?? 0);
  }

  /** Seconds until the next try of this code, if the server asked to wait after a wrong one. */
  get secondsUntilCodeRetry(): number {
    return this.secondsUntil(this.codeRetryAvailableAt ?? 0);
  }

  /** The code field is usable: tries left and no wait running. */
  get canEnterCode(): boolean {
    return this.codeState !== 'too_many_attempts' && this.secondsUntilCodeRetry === 0;
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
    this.clearNotice();
    const result: LoginResult = yield this.sendCode(phone);
    return result;
  });

  /** Code step: a new SMS for the same number, once the countdown allows it. */
  resendCode = flow(function* (this: LoginFlowStore) {
    if (!this.phone) return fail('invalid_phone');
    if (this.secondsUntilResend > 0) return fail('blocked');
    this.clearNotice();
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
        this.clearNotice();
        return ok;
      } catch (error) {
        // Another login of this user won a race: the server asks to retry with the same code (once).
        if (error instanceof ApiError && error.code === 'login_conflict' && attempt === 1) continue;
        if (error instanceof ApiError) {
          const handled = this.codeRefused(error);
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
      this.startOver('registration_expired');
      return fail('registration_expired');
    }
    try {
      const reply: LoggedIn = yield this.deps.api.register(token, name, this.deps.device);
      yield this.finish(reply);
      return ok;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_registration_token') {
        this.startOver('registration_expired');
      } else if (error instanceof ApiError && error.code === 'already_registered') {
        this.startOver('already_registered');
      }
      return toLoginError(error);
    }
  });

  /**
   * Back to the phone step ("Change number", Android back) from the code step: clears everything. Ignored
   * while the countdown runs, and on the name step.
   */
  back(): void {
    if (!this.canGoBack) return;
    this.reset();
  }

  /** An empty flow (after back, expiry and sign-in): the saved progress is deleted. The send blocks stay. */
  reset(): void {
    this.country = DEFAULT_COUNTRY;
    this.step = 'phone';
    this.phone = null;
    this.clearCode();
    this.registrationToken = null;
    this.registrationExpiresAt = null;
    this.clearNotice();
  }

  /**
   * At startup: the send blocks still running, and a saved code / name step if its code / registration
   * token is still valid (with only the time left: the closed time is subtracted). Expired → an empty phone
   * step saying so.
   */
  restore = flow(function* (this: LoginFlowStore) {
    try {
      const saved: SendBlocks | null = yield this.deps.blocks.load();
      this.blocksWriter.known(saved);
      const active = activeBlocks(saved ?? noBlocks, Date.now());
      this.deviceLock = active.all;
      this.numberWaits.replace(active.numbers.map(({ phone, until }) => [phone, until]));
      // The reactions save only what changes in memory; storage may still hold the blocks that ended.
      this.blocksWriter.write(this.savedBlocks);
    } catch {
      log.error('Could not read the saved send blocks');
    }
    let saved: LoginProgress | null = null;
    try {
      saved = yield this.deps.progress.load();
      this.progressWriter.known(saved); // restoring it below writes nothing back
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
    if (expired) this.expire(expired);
    // Expired while closed: memory went null → step → null, which the reaction doesn't see as a change.
    this.progressWriter.write(this.progress);
  });

  // ---- internals ----

  /** What is saved of the login: the code / name step (null on the phone step: the item is deleted). */
  private get progress(): LoginProgress | null {
    if (this.step === 'phone' || this.phone === null) return null;
    return {
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
  }

  /**
   * What is saved of the send blocks (null when none is left: the item is deleted). It reads every part
   * (iterating the map tracks all of it), so any change, in place too, makes this run again and the reaction
   * save the result.
   */
  private get savedBlocks(): SendBlocks | null {
    const lock = this.deviceLock;
    const all = lock ? { reason: lock.reason, until: lock.until } : null; // read both: tracked in place too
    const numbers = [...this.numberWaits].map(([phone, until]) => ({ phone, until }));
    return all || numbers.length > 0 ? { all, numbers } : null;
  }

  /** A send block's time is up (reads the clock only while there is one). */
  private get blockEnded(): boolean {
    const ends = [this.deviceLock?.until, ...this.numberWaits.values()];
    const first = Math.min(...ends.filter((until): until is number => until !== undefined));
    return Number.isFinite(first) && this.deps.clock.now >= first;
  }

  private pruneBlocks(): void {
    const now = Date.now();
    if (this.deviceLock && this.deviceLock.until <= now) this.deviceLock = null;
    for (const [phone, until] of this.numberWaits) {
      if (until <= now) this.numberWaits.delete(phone);
    }
  }

  /** Which deadline has passed on the code / name step (reads the clock only there). */
  private get expired(): 'code' | 'name' | null {
    if (this.step === 'phone') return null;
    return this.expiredAt(this.deps.clock.now);
  }

  private expiredAt(now: number): 'code' | 'name' | null {
    if (this.step === 'code') {
      const ended = this.codeState !== 'expired' && (this.codeExpiresAt ?? 0) <= now;
      return ended ? 'code' : null;
    }
    if (this.step === 'name') {
      const valid = this.registrationToken !== null && (this.registrationExpiresAt ?? 0) > now;
      return valid ? null : 'name';
    }
    return null;
  }

  /**
   * The code expired: stay on the code step and say so, "Send a new code" is the way on (owner,
   * 2026-11-13). The registration token expired: start over (the number's wait stays a send block).
   */
  private expire(what: 'code' | 'name'): void {
    if (what === 'name') this.startOver('registration_expired');
    else this.markCodeExpired();
  }

  private markCodeExpired(): void {
    this.codeState = 'expired';
    this.codeRetryAvailableAt = null;
  }

  /** The verify errors this flow handles itself (null: not one of them). */
  private codeRefused(error: ApiError): LoginResult | null {
    const now = Date.now();
    const { attemptsLeft, resendAfterSeconds, retryAfterSeconds } = error.details;
    if (resendAfterSeconds !== undefined && this.phone) {
      this.blockNumber(this.phone, now + resendAfterSeconds * 1000);
    }
    switch (error.code) {
      case 'invalid_code':
        this.attemptsLeft = attemptsLeft ?? null;
        this.codeRetryAvailableAt =
          retryAfterSeconds !== undefined ? now + retryAfterSeconds * 1000 : null;
        return fail('invalid_code');
      case 'too_many_attempts':
        this.codeState = 'too_many_attempts';
        this.attemptsLeft = 0;
        this.codeRetryAvailableAt = null;
        return fail('too_many_attempts');
      case 'code_expired':
        // Stay on the code step and say so: the number is right, a new code is one tap away.
        this.markCodeExpired();
        return fail('code_expired');
      default:
        return null;
    }
  }

  private sendCode = flow(function* (this: LoginFlowStore, phone: string) {
    const now = Date.now();
    try {
      const sent: Awaited<ReturnType<LoginFlowDeps['api']['requestCode']>> =
        yield this.deps.api.requestCode(phone);
      this.toCode(phone, now + sent.expires_in_seconds * 1000);
      this.clearCodeAttempts();
      const until = now + sent.resend_after_seconds * 1000;
      // A long wait names its limit (planned in auth-service): the network's locks every number. Without
      // a name it's this number's (owner, 2026-11-13).
      if (sent.limit === 'ip_hour' || sent.limit === 'ip_day') this.blockAll('network', until);
      else this.blockNumber(phone, until);
      return ok;
    } catch (error) {
      if (!(error instanceof ApiError)) return toLoginError(error);
      const wait = error.retryAfterSeconds;
      if (error.code === 'rate_limited' && wait !== undefined) {
        const until = now + wait * 1000;
        if (error.details.limit === 'ip_hour' || error.details.limit === 'ip_day') {
          this.blockAll('network', until);
        } else {
          // resend_cooldown (a code went out within the last minute: maybe before a lost reply, a reinstall
          // or a sign-in; whether it can still be used is unknown, so wait instead of guessing), phone_hour,
          // phone_day, or no limit named. The flow stays where it is.
          this.blockNumber(phone, until);
        }
        return fail('blocked');
      }
      if (error.code === 'sms_unavailable' && wait !== undefined) {
        this.blockAll('sms', now + wait * 1000);
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
    this.reset(); // the send blocks stay: after a sign-out the number still waits (owner, 2026-11-13)
  });

  /** The session ended (AuthStore.onSessionEnded): an empty phone step saying why. Not saved. */
  showNotice(notice: LoginNotice, detail: string | null = null): void {
    this.startOver(notice);
    this.noticeDetail = detail;
  }

  private clearNotice(): void {
    this.notice = null;
    this.noticeDetail = null;
  }

  /** Back to an empty phone step, with a message saying why. */
  private startOver(notice: LoginNotice): void {
    this.reset();
    this.notice = notice;
  }

  private blockUntil(phone: string | null): { reason: SendBlock['reason']; until: number } | null {
    const all = this.deviceLock;
    const number = phone ? this.numberWaits.get(phone) : undefined;
    if (all && (number === undefined || all.until >= number)) return all;
    return number !== undefined ? { reason: 'number', until: number } : null;
  }

  private secondsUntil(until: number): number {
    if (until === 0) return 0;
    return Math.max(0, Math.ceil((until - this.deps.clock.now) / 1000));
  }

  /**
   * When this number may get a new code: its send block (outlives the code step, see the class comment).
   * Only ever later: after the hour's last code the 202's wait is longer than the cooldown a verify error
   * reports.
   */
  private blockNumber(phone: string, until: number): void {
    const current = this.numberWaits.get(phone);
    if (current !== undefined && current >= until) return; // only ever later
    this.numberWaits.set(phone, until);
  }

  private blockAll(reason: 'network' | 'sms', until: number): void {
    this.deviceLock = { reason, until };
  }
}
