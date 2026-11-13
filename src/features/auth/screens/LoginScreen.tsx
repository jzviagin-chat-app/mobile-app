import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

import type { LoginFlowStore } from '../login-flow-store';
import { CodeStep } from './CodeStep';
import { NameStep } from './NameStep';
import { PhoneStep } from './PhoneStep';

type Props = { login: LoginFlowStore };

/**
 * The whole login on one route (/auth). The store's `step` is the only truth about where the user is:
 * this screen just shows it, so the screen and the state can never disagree. Only "Change number" goes back
 * (login.back()); Android's back button does nothing on the code and name steps (owner, 2026-11-13). When
 * the code or the registration token expires, the store switches to the phone step by itself.
 */
export const LoginScreen = observer(function LoginScreen({ login }: Props) {
  const step = login.step;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (login.step === 'phone') return false; // default: leave the app
      return true; // code and name steps: handled by doing nothing
    });
    return () => subscription.remove();
  }, [login]);

  // No transition animation between steps: a fade that starts invisible could leave a step blank for
  // seconds on a busy phone (seen on the emulator).
  if (step === 'code') return <CodeStep login={login} />;
  if (step === 'name') return <NameStep login={login} />;
  return <PhoneStep login={login} />;
});
