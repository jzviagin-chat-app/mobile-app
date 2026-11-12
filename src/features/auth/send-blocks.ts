import { z } from 'zod';

import { createSecureItem, type SecureItem } from '@/lib/secure-item';

const sendBlocksSchema = z.object({
  /** Every number is blocked: this network's limit (`ip_*`) or the server's daily SMS cap. */
  all: z.object({ reason: z.enum(['network', 'sms']), until: z.number() }).nullable(),
  /** One number is blocked: its hourly / daily limit, or a resend wait left from an expired code. */
  numbers: z.array(z.object({ phone: z.string(), until: z.number() })),
});

/**
 * When the server will send a code again (Unix ms, phone clock), from its 429 / 503 answers. Saved in its own
 * secure item, apart from the login progress: these are the server's facts, so going back to the phone step
 * doesn't clear them (owner decision 2026-11-12: every wait survives a restart). Cleared on sign-in; expired
 * entries are dropped whenever the blocks are read or changed.
 */
export type SendBlocks = z.infer<typeof sendBlocksSchema>;
export type SendBlocksStorage = SecureItem<SendBlocks>;

export const noBlocks: SendBlocks = { all: null, numbers: [] };

/** The blocks still running at `now`. */
export function activeBlocks(blocks: SendBlocks, now: number): SendBlocks {
  return {
    all: blocks.all && blocks.all.until > now ? blocks.all : null,
    numbers: blocks.numbers.filter((block) => block.until > now),
  };
}

export function createSendBlocksStorage(): SendBlocksStorage {
  return createSecureItem('send-blocks', sendBlocksSchema);
}
