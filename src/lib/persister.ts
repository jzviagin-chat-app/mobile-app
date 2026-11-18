import type { SecureItem } from './secure-item';

/**
 * Keeps one secure item in step with a value that changes: `write(value)` saves it, `write(null)` deletes
 * the item. A store calls it from a reaction, so every change is saved without each action remembering to.
 *
 * - One write at a time, always the newest: values that arrive during a write replace each other, and only
 *   the last one is written next (two quick changes can't finish in the wrong order).
 * - A value equal to what the item already holds is skipped. `known(value)` says what it holds after a load,
 *   so restoring a store doesn't write back what was just read.
 * - A failed write calls `onError` (the app keeps working, the value just won't survive a restart); the next
 *   change tries again.
 */
export type Persister<T> = {
  write(value: T | null): void;
  known(value: T | null): void;
  /** Resolves when every write so far has finished. */
  idle(): Promise<void>;
};

export function createPersister<T>(item: SecureItem<T>, onError: () => void): Persister<T> {
  let stored: string | undefined; // JSON of what the item holds; undefined: unknown
  let next: { json: string; value: T | null } | null = null;
  let running: Promise<void> = Promise.resolve();
  let busy = false;

  async function drain(): Promise<void> {
    try {
      while (next) {
        const { json, value } = next;
        next = null;
        if (json === stored) continue;
        try {
          if (value === null) await item.clear();
          else await item.save(value);
          stored = json;
        } catch {
          stored = undefined;
          onError();
        }
      }
    } finally {
      busy = false; // in the same tick as the last check: a later write starts a new drain
    }
  }

  return {
    write(value) {
      next = { json: JSON.stringify(value), value };
      if (busy) return;
      busy = true;
      running = drain();
    },
    known(value) {
      stored = JSON.stringify(value);
    },
    idle: () => running,
  };
}
