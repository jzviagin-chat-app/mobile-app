import { observer } from 'mobx-react-lite';
import { startTransition, useActionState, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Screen, Text, TextField } from '@/ui';

import type { LoginResult } from '../errors';
import type { LoginFlowStore } from '../login-flow-store';
import { useLoginError } from './useLoginError';

export const NameStep = observer(function NameStep({ login }: { login: LoginFlowStore }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [result, submit, pending] = useActionState<LoginResult | null, string>(
    (_previous, entered) => login.register(entered),
    null,
  );
  const error = useLoginError(result);

  return (
    <Screen
      // The code is verified: the only way is on (no "Change number"; owner decision 2026-11-11).
      footer={
        <Button
          testID="name-continue"
          title={t('auth.name.continue')}
          loading={pending}
          disabled={name.trim().length === 0}
          onPress={() => startTransition(() => submit(name))}
        />
      }
    >
      <Text variant="title" accessibilityRole="header">
        {t('auth.name.title')}
      </Text>
      <Text muted>{t('auth.name.subtitle')}</Text>
      <TextField
        label={t('auth.name.label')}
        value={name}
        onChangeText={setName}
        maxLength={50}
        autoComplete="name"
        textContentType="name"
        autoFocus
        error={error}
        testID="name-input"
        returnKeyType="done"
        onSubmitEditing={() => startTransition(() => submit(name))}
      />
    </Screen>
  );
});
