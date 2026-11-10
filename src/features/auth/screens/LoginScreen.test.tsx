import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';

import { ApiError } from '@/lib/api';
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
const registrationRequired = {
  status: 'registration_required',
  registration_token: 'reg',
  expires_in: 600,
} as const;

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
    deps.fakeApi.requestCode.mockRejectedValue(new ApiError(429, 'rate_limited', 1800));
    await fireEvent.changeText(await screen.findByTestId('phone-input'), '0502345678');
    await fireEvent.press(screen.getByTestId('phone-continue'));
    expect(await screen.findByText('Too many attempts. Try again in 30:00.')).toBeOnTheScreen();
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
    deps.fakeApi.verifyCode.mockRejectedValue(new ApiError(400, 'invalid_code'));
    await fireEvent.changeText(screen.getByTestId('otp-input'), '12 34-56');
    expect(deps.fakeApi.verifyCode).toHaveBeenCalledWith('+972502345678', '123456', deps.device);
    expect(await screen.findByText(/That code is wrong/)).toBeOnTheScreen();
    expect(screen.getByTestId('otp-input')).toHaveDisplayValue(''); // emptied for the next try
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

    it('"Change number" waits for the same countdown as resend, then opens an empty phone step', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      expect(screen.getByTestId('code-change-number')).toBeDisabled();
      expect(screen.getByTestId('code-resend')).toBeDisabled();
      expect(screen.getByText('New code in 1:00')).toBeOnTheScreen();

      await tick(30);
      expect(screen.getByText('New code in 0:30')).toBeOnTheScreen();
      expect(screen.getByTestId('code-change-number')).toBeDisabled();

      await tick(30);
      expect(screen.getByTestId('code-change-number')).toBeEnabled();
      expect(screen.getByTestId('code-resend')).toBeEnabled();

      await fireEvent.press(screen.getByTestId('code-change-number'));
      expect(await screen.findByTestId('phone-input')).toHaveDisplayValue('');
      expect(deps.loginProgress.value).toBeNull();
    });

    it("Android's back button does nothing during the countdown, then goes back", async () => {
      type BackHandlerFn = Parameters<typeof ReactNative.BackHandler.addEventListener>[1];
      const handlers: BackHandlerFn[] = [];
      jest
        .spyOn(ReactNative.BackHandler, 'addEventListener')
        .mockImplementation((_event, handler) => {
          handlers.push(handler);
          return { remove: jest.fn() };
        });
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      const press = async () => {
        let handled: boolean | null | undefined;
        await act(async () => {
          handled = handlers.at(-1)?.({} as never);
        });
        return handled;
      };

      expect(await press()).toBe(true); // handled (the app stays), but ignored
      expect(screen.getByTestId('otp-input')).toBeOnTheScreen();

      await tick(60);
      expect(await press()).toBe(true);
      expect(await screen.findByTestId('phone-input')).toBeOnTheScreen();

      // On the first step back is not handled: Android leaves the app as usual.
      expect(await press()).toBe(false);
    });

    it('back, then the same number again: a new code and a fresh countdown', async () => {
      const deps = await renderLogin({}, withClock());
      await toCodeStep(deps);
      await tick(90);
      await fireEvent.press(screen.getByTestId('code-change-number'));
      await toCodeStep(deps);
      expect(deps.fakeApi.requestCode).toHaveBeenCalledTimes(2);
      expect(screen.getByText('New code in 1:00')).toBeOnTheScreen();
      expect(screen.getByTestId('code-change-number')).toBeDisabled();
    });
  });
});
