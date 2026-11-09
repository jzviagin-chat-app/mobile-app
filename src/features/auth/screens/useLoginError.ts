import { useTranslation } from 'react-i18next';

import type { LoginResult } from '../errors';
import { formatDuration } from './format';

/** The text for a failed action's result, or null (for useActionState states). */
export function useLoginError(result: LoginResult | null): string | null {
  const { t } = useTranslation();
  if (!result || result.ok) return null;
  const { code, retryAfterSeconds } = result.error;
  return t(`auth.errors.${code}`, { time: formatDuration(retryAfterSeconds ?? 0) });
}
