import { useTranslation } from 'react-i18next';

import type { LoginResult } from '../errors';

/**
 * The text for a failed action's result, or null (for useActionState states). `blocked` has none: the
 * screen shows that one live from the store, with its countdown.
 */
export function useLoginError(result: LoginResult | null): string | null {
  const { t } = useTranslation();
  if (!result || result.ok) return null;
  const { code } = result.error;
  if (code === 'blocked') return null;
  return t(`auth.errors.${code}`);
}
