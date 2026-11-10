import { observer } from 'mobx-react-lite';
import { startTransition, useActionState, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import type { Language } from '@/lib/i18n';
import { Button, measureInWindow, Screen, Text, TextField, useTheme } from '@/ui';

import { getCountry } from '../countries';
import type { LoginResult } from '../errors';
import type { LoginFlowStore } from '../login-flow-store';
import { formatAsYouType } from '../phone';
import { CountryDropdown, type Anchor } from './CountryDropdown';
import { useLoginError } from './useLoginError';

export const PhoneStep = observer(function PhoneStep({ login }: { login: LoginFlowStore }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const country = getCountry(login.country, i18n.language as Language);
  // Always starts empty: back to this step clears the whole login (owner decision 2026-11-10).
  const [text, setText] = useState('');
  const [dropdown, setDropdown] = useState<Anchor | null>(null);
  const countryButton = useRef<ComponentRef<typeof Pressable>>(null);

  // The form action: calls the store and returns its result as state (never throws).
  const [result, submit, pending] = useActionState<LoginResult | null, string>(
    (_previous, phone) => login.requestCode(phone),
    null,
  );
  const error = useLoginError(result);

  function onChangeText(next: string) {
    // Format only while the number grows: re-formatting on delete would put back the dash just removed.
    setText(next.length > text.length ? formatAsYouType(login.country, next) : next);
  }

  async function openDropdown() {
    const button = countryButton.current;
    if (!button) return;
    const { y, height } = await measureInWindow(button);
    setDropdown({ y, height });
  }

  return (
    <Screen
      footer={
        <Button
          testID="phone-continue"
          title={t('auth.phone.continue')}
          loading={pending}
          disabled={text.trim().length === 0}
          onPress={() => startTransition(() => submit(text))}
        />
      }
    >
      <Text variant="title" accessibilityRole="header">
        {t('auth.phone.title')}
      </Text>
      <Text muted>{t('auth.phone.subtitle')}</Text>
      {login.notice && login.notice !== 'code_already_sent' ? (
        <Text style={{ color: theme.colors.danger }}>{t(`auth.notice.${login.notice}`)}</Text>
      ) : null}
      <TextField
        label={t('auth.phone.label')}
        value={text}
        onChangeText={onChangeText}
        direction="ltr"
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoFocus
        error={error}
        testID="phone-input"
        returnKeyType="done"
        onSubmitEditing={() => startTransition(() => submit(text))}
        prefix={
          <Pressable
            ref={countryButton}
            testID="country-button"
            accessibilityRole="button"
            accessibilityLabel={t('auth.phone.country', { name: country.name })}
            onPress={() => void openDropdown()}
            style={[styles.country, { gap: theme.spacing.xs }]}
          >
            <Text>{country.flag}</Text>
            <Text>{`+${country.callingCode}`}</Text>
            <Text muted>▾</Text>
          </Pressable>
        }
      />
      {dropdown ? (
        <CountryDropdown
          anchor={dropdown}
          selected={login.country}
          onSelect={(code) => {
            login.setCountry(code);
            setText('');
          }}
          onClose={() => setDropdown(null)}
        />
      ) : null}
    </Screen>
  );
});

const styles = StyleSheet.create({
  country: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
});
