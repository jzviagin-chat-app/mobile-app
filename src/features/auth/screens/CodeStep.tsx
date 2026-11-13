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
  // Two kinds of message: about this code (it marks the field red) and about sending a new one (a device
  // lock, a failed resend: the code already sent may still arrive late and work, so the field stays
  // neutral and usable).
  const codeError = staticVerifyError ?? codeMessage(t, login, verifyCode === 'invalid_code');
  const block = login.blockFor(login.phone);
  const sendMessage = block && block.reason !== 'number' ? blockText(t, block) : resendError;
  const wait = login.secondsUntilResend; // ticks every second while shown
  const locked = login.secondsUntilUnlock; // the device lock: both buttons count it down

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
          {/* Any time, unless the device is locked: then the same countdown as resend (owner, 2026-11-13). */}
          <Button
            testID="code-change-number"
            variant="secondary"
            title={
              locked > 0
                ? t('auth.code.changeNumberIn', { time: formatDuration(locked) })
                : t('auth.code.changeNumber')
            }
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
      <OtpInput
        label={t('auth.code.label')}
        value={code}
        onChange={setCode}
        onComplete={(entered) => startTransition(() => verify(entered))}
        busy={verifying}
        disabled={!login.canEnterCode}
        error={!!codeError}
      />
      {codeError ? (
        <Text accessibilityLiveRegion="polite" testID="code-error">
          {codeError}
        </Text>
      ) : null}
      {sendMessage ? (
        <Text accessibilityLiveRegion="polite" testID="code-send-error">
          {sendMessage}
        </Text>
      ) : null}
    </Screen>
  );
});

/** The live message about this code: too many tries, or a wrong code (and any wait before the next try). */
function codeMessage(t: TFunction, login: LoginFlowStore, wrongCode: boolean): string | null {
  if (login.codeState === 'too_many_attempts') return t('auth.code.locked');
  const retry = login.secondsUntilCodeRetry;
  if (retry > 0) return t('auth.code.wrongWait', { time: formatDuration(retry) });
  if (login.attemptsLeft !== null) {
    return t('auth.code.wrongTriesLeft', { count: login.attemptsLeft });
  }
  return wrongCode ? t('auth.code.wrong') : null;
}
