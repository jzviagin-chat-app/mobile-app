import { observer } from 'mobx-react-lite';
import { startTransition, useActionState, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import type { Language } from '@/lib/i18n';
import { Button, Text, TextField, useTheme } from '@/ui';

import { getCountry } from '../countries';
import type { LoginResult } from '../errors';
import type { LoginFlowStore } from '../login-flow-store';
import { formatAsYouType, formatNational } from '../phone';
import { CountryPicker } from './CountryPicker';
import { useLoginError } from './useLoginError';

export const PhoneStep = observer(function PhoneStep({ login }: { login: LoginFlowStore }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const country = getCountry(login.country, i18n.language as Language);
  // Prefilled when coming back from the code step ("Change number").
  const [text, setText] = useState(() => (login.phone ? formatNational(login.phone) : ''));
  const [pickerOpen, setPickerOpen] = useState(false);

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

  return (
    <>
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
            testID="country-button"
            accessibilityRole="button"
            accessibilityLabel={t('auth.phone.country', { name: country.name })}
            onPress={() => setPickerOpen(true)}
            style={[styles.country, { gap: theme.spacing.xs }]}
          >
            <Text>{country.flag}</Text>
            <Text>{`+${country.callingCode}`}</Text>
          </Pressable>
        }
      />
      <Button
        testID="phone-continue"
        title={t('auth.phone.continue')}
        loading={pending}
        disabled={text.trim().length === 0}
        onPress={() => startTransition(() => submit(text))}
      />
      <CountryPicker
        visible={pickerOpen}
        selected={login.country}
        onSelect={(code) => {
          login.setCountry(code);
          setText('');
        }}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
});

const styles = StyleSheet.create({
  country: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
});
