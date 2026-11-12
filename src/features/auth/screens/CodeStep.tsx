import type { TFunction } from 'i18next';
import { observer } from 'mobx-react-lite';
import { startTransition, useActionState, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, OtpInput, Screen, Text } from '@/ui';

import type { LoginResult } from '../errors';
import type { LoginFlowStore } from '../login-flow-store';
import { formatNational } from '../phone';
import { blockText } from './blockText';
import { formatDuration, ltr } from './format';
import { useLoginError } from './useLoginError';

/** Verify answers the screen shows live from the store (they change with the clock or the next try). */
const LIVE_VERIFY_ERRORS = new Set(['invalid_code', 'too_many_attempts', 'blocked']);

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
  const verifyCode = verifyResult && !verifyResult.ok ? verifyResult.error.code : null;
  const staticVerifyError = verifyCode && !LIVE_VERIFY_ERRORS.has(verifyCode) ? verifyError : null;
  const message =
    staticVerifyError ?? codeMessage(t, login, verifyCode === 'invalid_code') ?? resendError;
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
          {/* Waits for the same countdown as resend, however long (owner decisions 2026-11-10/12). */}
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
        disabled={!login.canEnterCode}
        error={!!message}
      />
      {message ? (
        <Text accessibilityLiveRegion="polite" testID="code-error">
          {message}
        </Text>
      ) : null}
    </Screen>
  );
});

/** The live message for this code: a send block, too many tries, or a wrong code (and any wait). */
function codeMessage(t: TFunction, login: LoginFlowStore, wrongCode: boolean): string | null {
  const block = login.blockFor(login.phone);
  if (block) return blockText(t, block);
  if (login.codeState === 'too_many_attempts') return t('auth.code.locked');
  const retry = login.secondsUntilCodeRetry;
  if (retry > 0) return t('auth.code.wrongWait', { time: formatDuration(retry) });
  if (login.attemptsLeft !== null) {
    return t('auth.code.wrongTriesLeft', { count: login.attemptsLeft });
  }
  return wrongCode ? t('auth.code.wrong') : null;
}
