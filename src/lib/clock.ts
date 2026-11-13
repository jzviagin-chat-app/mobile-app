import { createAtom } from 'mobx';

export type Clock = {
  /** Unix ms. Read inside an observer/computed, it re-renders every `intervalMs` while observed. */
  readonly now: number;
};

/**
 * A MobX-observable "now" for countdowns. The interval runs only while something observes it (MobX's
 * onBecomeObserved/onBecomeUnobserved), so a hidden countdown costs nothing.
 */
export function createClock(read: () => number = Date.now, intervalMs = 1000): Clock {
  let timer: ReturnType<typeof setInterval> | undefined;
  const atom = createAtom(
    'clock',
    () => {
      timer = setInterval(() => atom.reportChanged(), intervalMs);
    },
    () => {
      clearInterval(timer);
      timer = undefined;
    },
  );
  return {
    get now() {
      atom.reportObserved();
      return read();
    },
  };
}
