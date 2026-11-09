import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import { Animated, BackHandler, StyleSheet } from 'react-native';

import { Screen, spacing } from '@/ui';

import type { LoginFlowStore } from '../login-flow-store';
import { CodeStep } from './CodeStep';
import { NameStep } from './NameStep';
import { PhoneStep } from './PhoneStep';

type Props = { login: LoginFlowStore };

/**
 * The whole login on one route (/auth). The store's `step` is the only truth about where the user is:
 * this screen just shows it, so the screen and the state can never disagree. Android's back button and
 * "Change number" both call login.back().
 */
export const LoginScreen = observer(function LoginScreen({ login }: Props) {
  const step = login.step;

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (login.step === 'phone') return false; // default: leave the app
      void login.back();
      return true;
    });
    return () => subscription.remove();
  }, [login]);

  // A short slide-in whenever the step changes (the router would animate separate screens; one route
  // animates its steps itself).
  const appear = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    appear.setValue(0);
    Animated.timing(appear, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [step, appear]);

  return (
    <Screen>
      <Animated.View
        key={step}
        style={[
          styles.fill,
          {
            opacity: appear,
            transform: [
              { translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            ],
          },
        ]}
      >
        {step === 'phone' ? <PhoneStep login={login} /> : null}
        {step === 'code' ? <CodeStep login={login} /> : null}
        {step === 'name' ? <NameStep login={login} /> : null}
      </Animated.View>
    </Screen>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1, gap: spacing.md },
});
