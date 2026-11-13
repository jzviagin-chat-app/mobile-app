import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';

import { toApiError } from '@/lib/api/errors';
import { createClock } from '@/lib/clock';
import { RootStoreProvider, useRootStore } from '@/root';
import { testDeps } from '@/root/test-deps';
import { getTheme } from '@/ui';

import { LoginScreen } from './LoginScreen';

// Nothing has a real layout in tests: the country button "is" 48 px high, 200 px from the top.
jest.mock('@/ui/measure', () => ({
  measureInWindow: () => Promise.resolve({ x: 24, y: 200, width: 80, height: 48 }),
}));

const codeSent = { resend_after_seconds: 60, expires_in_seconds: 300 };
const loggedIn = {
  status: 'logged_in',
  access_token: 'access-1',
  token_type: 'Bearer',
  expires_in: 900,
  refresh_token: 'refresh-1',
} as const;
const registrationRequired = {
  status: 'registration_required',
  registration_token: 'reg',
  expires_in: 600,
} as const;

/** An error exactly as auth-service sends it, through the real parser. */
function server(status: number, body: object, retryAfter?: number) {
  const headers = retryAfter === undefined ? undefined : { 'Retry-After': String(retryAfter) };
  return toApiError(new Response(null, { status, headers }), body);
}
const rateLimited = (limit: string, seconds: number) =>
  server(
    429,
    { error: 'rate_limited', message: '…', limit, retry_after_seconds: seconds },
    seconds,
  );
const invalidCode = (attemptsLeft: number, extra: object = {}) =>
  server(400, {
    error: 'invalid_code',
    message: '…',
    attempts_left: attemptsLeft,
    resend_after_seconds: 60,
    ...extra,
  });
const tooManyAttempts = (resendAfter: number) =>
  server(400, { error: 'too_many_attempts', message: '…', resend_after_seconds: resendAfter });

type BackHandlerFn = Parameters<typeof ReactNative.BackHandler.addEventListener>[1];

/** Captures the screen's Android back handler; `press()` runs it like the hardware button would. */
function captureBackButton() {
  const handlers: BackHandlerFn[] = [];
  jest.spyOn(ReactNative.BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.push(handler);
    return { remove: jest.fn() };
  });
  return async () => {
    let handled: boolean | null | undefined;
    await act(async () => {
      handled = handlers.at(-1)?.({} as never);
    });
    return handled;
  };
}

function Login() {
  const { login } = useRootStore();
  return <LoginScreen login={login} />;
}

async function renderLogin(
  { language = 'en', scheme = 'light' }: { language?: string; scheme?: 'light' | 'dark' } = {},
  deps = testDeps({ locales: [{ languageCode: language }] }),
) {
  jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue(scheme);
  await render(
    <RootStoreProvider deps={deps}>
      <Login />
    </RootStoreProvider>,
  );
  return deps;
}

async function toCodeStep(deps: ReturnType<typeof testDeps>) {
  deps.fakeApi.requestCode.mockResolvedValue(codeSent);
  await fireEvent.changeText(await screen.findByTestId('phone-input'), '0502345678');
  await fireEvent.press(screen.getByTestId('phone-continue'));
  await screen.findByTestId('otp-input');
}

describe('LoginScreen: languages and themes', () => {
  it.each([
    ['en', 'Your phone number', 'Continue'],
    ['he', 'מספר הטלפון שלך', 'המשך'],
    ['ru', 'Your phone number', 'Continue'], // other languages fall back to English
  ])('phone step in %s', async (language, title, button) => {
    await renderLogin({ language });
    expect(await screen.findByRole('header', { name: title })).toBeOnTheScreen();
    expect(screen.getByText(button)).toBeOnTheScreen();
  });

  it.each(['light', 'dark'] as const)('uses the %s palette', async (scheme) => {
    await renderLogin({ scheme });
    expect(await screen.findByText('Your phone number')).toHaveStyle({
      color: getTheme(scheme).colors.text,
    });
  });

  it.each([
    ['en', 'Enter the code', '050-234-5678'],
    ['he', 'הזנת הקוד', '050-234-5678'],
  ])('code step in %s shows the full number left-to-right', async (language, title, number) => {
    const deps = await renderLogin({ language });
    await toCodeStep(deps);
    expect(screen.getByRole('header', { name: title })).toBeOnTheScreen();
    expect(screen.getByText(new RegExp(`⁦${number}⁩`))).toBeOnTheScreen();
  });

  it.each([
    ['en', "What's your name?"],
    ['he', 'איך קוראים לך?'],
  ])('name step in %s', async (language, title) => {
    const deps = await renderLogin({ language });
    await toCodeStep(deps);
    deps.fakeApi.verifyCode.mockResolvedValue(registrationRequired);
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    expect(await screen.findByRole('header', { name: title })).toBeOnTheScreen();
  });
});

describe('LoginScreen: phone step', () => {
  it('formats the number while typing', async () => {
    await renderLogin();
    const input = await screen.findByTestId('phone-input');
    await fireEvent.changeText(input, '0502345678');
    expect(input).toHaveDisplayValue('050-234-5678');
  });

  it('shows an invalid number on the device, without a request', async () => {
    const deps = await renderLogin();
    await fireEvent.changeText(await screen.findByTestId('phone-input'), '03-123-4567');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    expect(await screen.findByText("That doesn't look like a mobile number.")).toBeOnTheScreen();
    expect(deps.fakeApi.requestCode).not.toHaveBeenCalled();
  });

  it('shows a server error', async () => {
    const deps = await renderLogin();
    deps.fakeApi.requestCode.mockRejectedValue(server(503, { error: 'sms_unavailable' }));
    await fireEvent.changeText(await screen.findByTestId('phone-input'), '0502345678');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    expect(
      await screen.findByText("We can't send codes right now. Try again later."),
    ).toBeOnTheScreen();
  });

  it('the country picker searches, greys out unsupported countries and blocks non-IL sign-in', async () => {
    const deps = await renderLogin();
    await fireEvent.press(await screen.findByTestId('country-button'));
    await fireEvent.changeText(screen.getByTestId('country-search'), 'united');

    expect(screen.getByTestId('country-AE')).toBeDisabled(); // United Arab Emirates: not selectable
    await fireEvent.press(screen.getByTestId('country-GB'));
    expect(screen.queryByTestId('country-search')).toBeNull(); // closed after choosing
    expect(screen.getByText('+44')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('phone-input'), '07400 123456');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    expect(
      await screen.findByText("Sign-in isn't available for this country yet."),
    ).toBeOnTheScreen();
    expect(deps.fakeApi.requestCode).not.toHaveBeenCalled();
  });

  it('the dropdown closes on a tap outside, keeping the country', async () => {
    await renderLogin();
    await fireEvent.press(await screen.findByTestId('country-button'));
    expect(screen.getByTestId('country-search')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('country-backdrop'));
    expect(screen.queryByTestId('country-search')).toBeNull();
    expect(screen.getByText('+972')).toBeOnTheScreen();
  });

  it('the dropdown shows as many rows as fit above the keyboard (5 at most)', async () => {
    const keyboard = { isVisible: false, height: 0 };
    jest
      .mocked(useKeyboardState)
      .mockImplementation((select) => select?.(keyboard as never) ?? keyboard);
    await renderLogin();
    await fireEvent.press(await screen.findByTestId('country-button'));
    expect(screen.getByTestId('country-list')).toHaveStyle({ height: 5 * 48 });

    // The search field opens the keyboard. Size it so that below the button (y 200 + 48) there is
    // room for the search field (84 + 3 × 8 padding/gaps, plus 8 + 4 margins) and 3.5 rows: 3 are shown.
    keyboard.isVisible = true;
    keyboard.height = ReactNative.Dimensions.get('window').height - 248 - 12 - 108 - 3.5 * 48;
    await fireEvent.changeText(screen.getByTestId('country-search'), 'i');
    expect(screen.getByTestId('country-list')).toHaveStyle({ height: 3 * 48 });
  });

  it('finds a country by its Hebrew name or calling code', async () => {
    await renderLogin({ language: 'he' });
    await fireEvent.press(await screen.findByTestId('country-button'));
    await fireEvent.changeText(screen.getByTestId('country-search'), 'ספרד');
    expect(screen.getByTestId('country-ES')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('country-search'), '+49');
    expect(screen.getByTestId('country-DE')).toBeOnTheScreen();
  });
});

describe('LoginScreen: code step', () => {
  it('a pasted / autofilled code submits at once', async () => {
    const deps = await renderLogin();
    await toCodeStep(deps);
    deps.fakeApi.verifyCode.mockRejectedValue(invalidCode(4));
    await fireEvent.changeText(screen.getByTestId('otp-input'), '12 34-56');
    expect(deps.fakeApi.verifyCode).toHaveBeenCalledWith('+972502345678', '123456', deps.device);
    expect(await screen.findByText('Wrong code. Tries left: 4.')).toBeOnTheScreen();
    expect(screen.getByTestId('otp-input')).toHaveDisplayValue(''); // emptied for the next try
    expect(screen.getByTestId('otp-input')).toBeEnabled(); // no wait: the next try at once
  });

  it('shows the resend countdown', async () => {
    const deps = await renderLogin();
    await toCodeStep(deps);
    expect(screen.getByText(/New code in 1:00|New code in 0:59/)).toBeOnTheScreen();
    expect(screen.getByTestId('code-resend')).toBeDisabled();
  });

  describe('with a running clock', () => {
    beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-10T10:00:00Z') }));
    afterEach(() => jest.useRealTimers());

    const withClock = () => testDeps({ clock: createClock() });
    const tick = (seconds: number) => act(async () => jest.advanceTimersByTime(seconds * 1000));

    it('"Change number" works at once; that number keeps its timer, another number is free', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      expect(screen.getByTestId('code-resend')).toBeDisabled();
      expect(screen.getByText('New code in 1:00')).toBeOnTheScreen();
      expect(screen.getByTestId('code-change-number')).toBeEnabled();
      expect(screen.getByText('Change number')).toBeOnTheScreen();

      await tick(15);
      await fireEvent.press(screen.getByTestId('code-change-number'));
      const input = await screen.findByTestId('phone-input');
      expect(input).toHaveDisplayValue('');
      expect(deps.loginProgress.value).toBeNull();

      await fireEvent.changeText(input, '0502345678'); // the same number: its timer
      expect(
        screen.getByText('You can ask for a new code for this number in 0:45.'),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('phone-continue')).toBeDisabled();
      await fireEvent.changeText(input, '0531234567'); // another number: free
      expect(screen.getByTestId('phone-continue')).toBeEnabled();
    });

    it("Android's back button does nothing on the code step; on the phone step it leaves", async () => {
      const press = captureBackButton();
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);

      expect(await press()).toBe(true); // handled (the app stays), and ignored
      expect(screen.getByTestId('otp-input')).toBeOnTheScreen();
      await tick(60);
      expect(await press()).toBe(true); // also after the countdown: only the button goes back
      expect(screen.getByTestId('otp-input')).toBeOnTheScreen();

      await fireEvent.press(screen.getByTestId('code-change-number'));
      await screen.findByTestId('phone-input');
      expect(await press()).toBe(false); // the first step: Android leaves the app as usual
    });

    it('a wait after a wrong code (mocked server field) disables the code until it ends', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      deps.fakeApi.verifyCode.mockRejectedValueOnce(invalidCode(3, { retry_after_seconds: 20 }));
      await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
      expect(await screen.findByText('Wrong code. You can try again in 0:20.')).toBeOnTheScreen();
      expect(screen.getByTestId('otp-input')).toBeDisabled();

      await tick(15);
      expect(screen.getByText('Wrong code. You can try again in 0:05.')).toBeOnTheScreen();
      await tick(5);
      expect(screen.getByText('Wrong code. Tries left: 3.')).toBeOnTheScreen();
      expect(screen.getByTestId('otp-input')).toBeEnabled();
    });

    it('no tries left: the code disabled, resend counts down, a new code opens it', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      await tick(20);
      deps.fakeApi.verifyCode.mockRejectedValueOnce(tooManyAttempts(40));
      await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
      expect(
        await screen.findByText('Too many wrong tries. Request a new code.'),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('otp-input')).toBeDisabled();
      expect(screen.getByText('New code in 0:40')).toBeOnTheScreen();
      expect(screen.getByTestId('code-resend')).toBeDisabled();
      expect(screen.getByTestId('code-change-number')).toBeEnabled(); // only this number waits

      await tick(40);
      expect(screen.getByTestId('code-resend')).toBeEnabled();
      expect(screen.getByTestId('code-change-number')).toBeEnabled();
      expect(screen.getByTestId('otp-input')).toBeDisabled(); // still: this code is used up

      await fireEvent.press(screen.getByTestId('code-resend'));
      expect(await screen.findByText('New code in 1:00')).toBeOnTheScreen();
      expect(screen.getByTestId('otp-input')).toBeEnabled();
      expect(screen.queryByTestId('code-error')).toBeNull();
    });

    it('a refused resend (number limit) counts down on the resend button', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      await tick(60);
      deps.fakeApi.requestCode.mockRejectedValueOnce(rateLimited('phone_hour', 3599));
      await fireEvent.press(screen.getByTestId('code-resend'));
      expect(await screen.findByText('New code in 59:59')).toBeOnTheScreen();
      expect(screen.getByTestId('code-resend')).toBeDisabled();
      expect(screen.queryByTestId('code-error')).toBeNull(); // the button already says it
      await tick(1);
      expect(screen.getByText('New code in 59:58')).toBeOnTheScreen();
    });

    it('the code expires on screen: the code step stays, says so, and resend opens a new code', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      await tick(299);
      expect(screen.queryByText('That code has expired. Request a new one.')).toBeNull();
      await tick(1);
      expect(
        await screen.findByText('That code has expired. Request a new one.'),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('otp-input')).toBeEnabled();
      expect(screen.getByTestId('code-resend')).toBeEnabled(); // the 60 s wait ended long ago
      await fireEvent.press(screen.getByTestId('code-resend'));
      expect(await screen.findByText('New code in 1:00')).toBeOnTheScreen();
      expect(screen.queryByText('That code has expired. Request a new one.')).toBeNull();
    });

    it('phone step: a number limit disables Continue for that number only, with a live wait', async () => {
      const deps = await renderLogin({}, withClock());
      deps.fakeApi.requestCode.mockRejectedValueOnce(rateLimited('phone_hour', 90));
      const input = await screen.findByTestId('phone-input');
      await fireEvent.changeText(input, '0502345678');
      await fireEvent.press(screen.getByTestId('phone-continue'));
      expect(
        await screen.findByText('You can ask for a new code for this number in 1:30.'),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('phone-continue')).toBeDisabled();
      await tick(30);
      expect(
        screen.getByText('You can ask for a new code for this number in 1:00.'),
      ).toBeOnTheScreen();

      await fireEvent.changeText(input, '0531234567'); // another number: allowed
      expect(screen.getByTestId('phone-continue')).toBeEnabled();
      await fireEvent.changeText(input, '0502345678');
      expect(screen.getByTestId('phone-continue')).toBeDisabled();
      await tick(60);
      expect(screen.getByTestId('phone-continue')).toBeEnabled();
    });

    it.each([
      ['en', 'You can ask for a new code for this number in 0:42.', 'Continue'],
      ['he', 'אפשר לבקש קוד חדש למספר הזה בעוד 0:42.', 'המשך'],
    ])(
      'phone step in %s: a cooldown refusal stays there, Continue disabled with a live timer',
      async (language, text, button) => {
        const deps = await renderLogin(
          { language },
          testDeps({ clock: createClock(), locales: [{ languageCode: language }] }),
        );
        deps.fakeApi.requestCode.mockRejectedValueOnce(rateLimited('resend_cooldown', 42));
        await fireEvent.changeText(await screen.findByTestId('phone-input'), '0502345678');
        await fireEvent.press(screen.getByTestId('phone-continue'));
        expect(await screen.findByText(text)).toBeOnTheScreen();
        expect(screen.queryByTestId('otp-input')).toBeNull(); // no code step
        expect(screen.getByRole('button', { name: button })).toBeDisabled();
        await tick(42);
        expect(screen.getByTestId('phone-continue')).toBeEnabled();
        expect(screen.queryByText(text)).toBeNull();
      },
    );

    it('signed in, then the same number again: Continue waits for the countdown, no request', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      await tick(10);
      deps.fakeApi.verifyCode.mockResolvedValue(loggedIn);
      await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
      const input = await screen.findByTestId('phone-input'); // the flow is reset after sign-in
      await fireEvent.changeText(input, '0502345678');
      expect(
        screen.getByText('You can ask for a new code for this number in 0:50.'),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('phone-continue')).toBeDisabled();
      await fireEvent.press(screen.getByTestId('phone-continue'));
      expect(deps.fakeApi.requestCode).toHaveBeenCalledTimes(1);
      await tick(50);
      expect(screen.getByTestId('phone-continue')).toBeEnabled();
    });

    it('phone step: a network limit disables Continue for every number', async () => {
      const deps = await renderLogin({}, withClock());
      deps.fakeApi.requestCode.mockRejectedValueOnce(rateLimited('ip_hour', 3599));
      const input = await screen.findByTestId('phone-input');
      await fireEvent.changeText(input, '0502345678');
      await fireEvent.press(screen.getByTestId('phone-continue'));
      expect(
        await screen.findByText('Too many code requests from this network. Try again in 59:59.'),
      ).toBeOnTheScreen();
      await fireEvent.changeText(input, '0531234567');
      expect(screen.getByTestId('phone-continue')).toBeDisabled();
    });

    it('name step: no Change number, the back button does nothing, expiry starts over', async () => {
      const press = captureBackButton();
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      deps.fakeApi.verifyCode.mockResolvedValue(registrationRequired);
      await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
      await screen.findByTestId('name-input');
      expect(screen.queryByText('Change number')).toBeNull();

      expect(await press()).toBe(true); // handled, so the app doesn't close, but nothing happens
      expect(screen.getByTestId('name-input')).toBeOnTheScreen();

      await tick(600);
      expect(await screen.findByTestId('phone-input')).toBeOnTheScreen();
      expect(screen.getByText('That took too long. Verify your number again.')).toBeOnTheScreen();
    });

    it.each([
      ['he', 'dark', 'יותר מדי ניסיונות שגויים. יש לבקש קוד חדש.', 'קוד חדש בעוד 0:30'],
      ['en', 'dark', 'Too many wrong tries. Request a new code.', 'New code in 0:30'],
      ['he', 'light', 'יותר מדי ניסיונות שגויים. יש לבקש קוד חדש.', 'קוד חדש בעוד 0:30'],
    ] as const)('the locked code step in %s, %s', async (language, scheme, text, resend) => {
      const deps = await renderLogin(
        { language, scheme },
        testDeps({ locales: [{ languageCode: language }], clock: createClock() }),
      );
      await toCodeStep(deps);
      await tick(30);
      deps.fakeApi.verifyCode.mockRejectedValueOnce(tooManyAttempts(30));
      await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
      expect(await screen.findByText(text)).toBeOnTheScreen();
      expect(screen.getByText(resend)).toBeOnTheScreen();
      expect(screen.getByTestId('otp-input')).toBeDisabled();
    });

    it('back after the wait, then the same number again: a new code and a fresh countdown', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      await tick(60);
      await fireEvent.press(screen.getByTestId('code-change-number'));
      await toCodeStep(deps);
      expect(deps.fakeApi.requestCode).toHaveBeenCalledTimes(2);
      expect(screen.getByText('New code in 1:00')).toBeOnTheScreen();
      expect(screen.getByTestId('code-change-number')).toBeEnabled();
    });

    it.each([
      ['en', 'That code has expired. Request a new one.'],
      ['he', 'תוקף הקוד פג. יש לבקש קוד חדש.'],
    ])(
      'code_expired in %s: stays on the code step with the message, typing allowed',
      async (language, text) => {
        const deps = await renderLogin(
          { language },
          testDeps({ clock: createClock(), locales: [{ languageCode: language }] }),
        );
        await toCodeStep(deps);
        deps.fakeApi.verifyCode.mockRejectedValueOnce(
          server(400, { error: 'code_expired', message: '…', resend_after_seconds: 50 }),
        );
        await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
        expect(await screen.findByText(text)).toBeOnTheScreen();
        expect(screen.getByTestId('otp-input')).toBeEnabled();
        expect(screen.getByTestId('code-change-number')).toBeEnabled();
        await tick(60);
        await fireEvent.press(screen.getByTestId('code-resend'));
        await screen.findByText(language === 'en' ? 'New code in 1:00' : 'קוד חדש בעוד 1:00');
        expect(screen.queryByText(text)).toBeNull(); // a new code: the message is gone
      },
    );

    it('a device lock still takes a code that arrives late: it signs in', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      await tick(60);
      deps.fakeApi.requestCode.mockRejectedValueOnce(rateLimited('ip_hour', 100));
      await fireEvent.press(screen.getByTestId('code-resend'));
      await screen.findByTestId('code-send-error');
      deps.fakeApi.verifyCode.mockResolvedValue(loggedIn);
      await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
      expect(deps.fakeApi.verifyCode).toHaveBeenCalledWith('+972502345678', '123456', deps.device);
      expect(await screen.findByTestId('phone-input')).toBeOnTheScreen(); // signed in: the flow reset
    });

    it('a wrong code marks the field red; a lock message shows next to it', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      deps.fakeApi.verifyCode.mockRejectedValueOnce(invalidCode(3));
      await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
      expect(await screen.findByText('Wrong code. Tries left: 3.')).toBeOnTheScreen();
      expect(screen.getByTestId('otp-box-0')).toHaveStyle({
        borderColor: getTheme('light').colors.danger,
      });
      await tick(60);
      deps.fakeApi.requestCode.mockRejectedValueOnce(rateLimited('ip_hour', 100));
      await fireEvent.press(screen.getByTestId('code-resend'));
      expect(
        await screen.findByText('Too many code requests from this network. Try again in 1:40.'),
      ).toBeOnTheScreen();
      expect(screen.getByText('Wrong code. Tries left: 3.')).toBeOnTheScreen(); // both, not one hiding the other
    });

    it.each([
      ['en', 'New code in 1:40', 'Change number in 1:40', 'Change number'],
      ['he', 'קוד חדש בעוד 1:40', 'שינוי מספר בעוד 1:40', 'שינוי מספר'],
    ])(
      'a device lock in %s: both buttons disabled with the same countdown',
      async (language, resend, change, changeFree) => {
        const deps = await renderLogin(
          { language },
          testDeps({ clock: createClock(), locales: [{ languageCode: language }] }),
        );
        await toCodeStep(deps);
        await tick(60);
        deps.fakeApi.requestCode.mockRejectedValueOnce(rateLimited('ip_hour', 100)); // shorter than the code's life
        await fireEvent.press(screen.getByTestId('code-resend'));
        expect(await screen.findByText(resend)).toBeOnTheScreen();
        expect(screen.getByText(change)).toBeOnTheScreen();
        expect(screen.getByTestId('code-resend')).toBeDisabled();
        expect(screen.getByTestId('code-change-number')).toBeDisabled();
        // The lock is about sending: the code field stays usable and isn't marked as wrong.
        expect(screen.getByTestId('otp-input')).toBeEnabled();
        expect(screen.getByTestId('otp-box-0')).not.toHaveStyle({
          borderColor: getTheme('light').colors.danger,
        });
        expect(screen.queryByTestId('code-error')).toBeNull();
        expect(screen.getByTestId('code-send-error')).toBeOnTheScreen();
        await tick(1);
        expect(screen.getByText(change.replace('1:40', '1:39'))).toBeOnTheScreen();
        await tick(99);
        expect(screen.getByTestId('code-change-number')).toBeEnabled();
        expect(screen.getByText(changeFree)).toBeOnTheScreen();
      },
    );
  });
});
