import { observer } from 'mobx-react-lite';
import { startTransition, useActionState, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, OtpInput, Screen, Text } from '@/ui';

import type { LoginResult } from '../errors';
import type { LoginFlowStore } from '../login-flow-store';
import { formatNational } from '../phone';
import { formatDuration, ltr } from './format';
import { useLoginError } from './useLoginError';

export const CodeStep = observer(function CodeStep({ login }: { login: LoginFlowStore }) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');

  const [verifyResult, verify, verifying] = useActionState<LoginResult | null, string>(
    async (_previous, entered) => {
      const result = await login.verifyCode(entered);
      if (!result.ok) setCode(''); // a wrong code: empty the boxes for the next try
      return result;
    },
    null,
  );
  const [resendResult, resend, resending] = useActionState<LoginResult | null, void>(
    () => login.resendCode(),
    null,
  );
  // Both hooks run on every render (hooks must never be called conditionally).
  const verifyError = useLoginError(verifyResult);
  const resendError = useLoginError(resendResult);
  const error = verifyError ?? resendError;
  const wait = login.secondsUntilResend; // ticks every second while shown

  return (
    <Screen
      footer={
        <>
          <Button
            testID="code-resend"
            variant="secondary"
            title={
              wait > 0
                ? t('auth.code.resendIn', { time: formatDuration(wait) })
                : t('auth.code.resend')
            }
            disabled={wait > 0 || verifying}
            loading={resending}
            onPress={() => startTransition(() => resend())}
          />
          {/* Waits for the same countdown as resend (owner decision 2026-11-10). */}
          <Button
            testID="code-change-number"
            variant="secondary"
            title={t('auth.code.changeNumber')}
            disabled={!login.canGoBack || verifying}
            onPress={() => void login.back()}
          />
        </>
      }
    >
      <Text variant="title" accessibilityRole="header">
        {t('auth.code.title')}
      </Text>
      <Text muted>
        {t('auth.code.subtitle', { phone: ltr(formatNational(login.phone ?? '')) })}
      </Text>
      {login.notice === 'code_already_sent' ? (
        <Text>{t('auth.notice.code_already_sent')}</Text>
      ) : null}
      <OtpInput
        label={t('auth.code.label')}
        value={code}
        onChange={setCode}
        onComplete={(entered) => startTransition(() => verify(entered))}
        busy={verifying}
        error={!!error}
      />
      {error ? (
        <Text accessibilityLiveRegion="polite" testID="code-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
});
