import type { TFunction } from 'i18next';

import type { SendBlock } from '../login-flow-store';
import { formatDuration } from './format';

/** "Try again in 47:12" for a running send block (re-rendered every second by the store's clock). */
export function blockText(t: TFunction, block: SendBlock): string {
  return t(`auth.block.${block.reason}`, { time: formatDuration(block.seconds) });
}
