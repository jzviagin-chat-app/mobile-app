import { createPersister } from './persister';
import type { SecureItem } from './secure-item';

type Value = { n: number };

/** A secure item whose writes finish only when the test says so. */
function slowItem() {
  const finishers: (() => void)[] = [];
  const writes: (Value | null)[] = [];
  const later = (value: Value | null) =>
    new Promise<void>((resolve) => {
      writes.push(value);
      finishers.push(resolve);
    });
  const item: SecureItem<Value> = {
    load: jest.fn(async () => null),
    save: jest.fn((value: Value) => later(value)),
    clear: jest.fn(() => later(null)),
  };
  const finishNext = async () => {
    finishers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { item, writes, finishNext };
}

describe('createPersister', () => {
  it('writes one value at a time, and only the newest of those that arrived meanwhile', async () => {
    const { item, writes, finishNext } = slowItem();
    const persister = createPersister(item, jest.fn());
    persister.write({ n: 1 });
    persister.write({ n: 2 }); // replaced by 3 before its turn
    persister.write({ n: 3 });
    expect(writes).toEqual([{ n: 1 }]); // the first is still running
    await finishNext();
    expect(writes).toEqual([{ n: 1 }, { n: 3 }]);
    await finishNext();
    await persister.idle();
    expect(item.save).toHaveBeenCalledTimes(2);
  });

  it('null deletes the item; a write after it saves again', async () => {
    const { item, writes, finishNext } = slowItem();
    const persister = createPersister(item, jest.fn());
    persister.write({ n: 1 });
    await finishNext();
    persister.write(null);
    await finishNext();
    persister.write({ n: 2 });
    await finishNext();
    expect(writes).toEqual([{ n: 1 }, null, { n: 2 }]);
    expect(item.clear).toHaveBeenCalledTimes(1);
  });

  it('skips a value equal to what the item holds (after a load: known)', async () => {
    const { item, finishNext } = slowItem();
    const persister = createPersister(item, jest.fn());
    persister.known({ n: 1 });
    persister.write({ n: 1 });
    persister.known(null);
    persister.write(null);
    await persister.idle();
    expect(item.save).not.toHaveBeenCalled();
    expect(item.clear).not.toHaveBeenCalled();
    persister.write({ n: 1 }); // now different from what it holds
    await finishNext();
    expect(item.save).toHaveBeenCalledTimes(1);
  });

  it('a failed write reports the error, and the next change tries again (also the same value)', async () => {
    const onError = jest.fn();
    const item: SecureItem<Value> = {
      load: jest.fn(async () => null),
      save: jest.fn().mockRejectedValueOnce(new Error('keystore')).mockResolvedValue(undefined),
      clear: jest.fn(async () => undefined),
    };
    const persister = createPersister(item, onError);
    persister.write({ n: 1 });
    await persister.idle();
    expect(onError).toHaveBeenCalledTimes(1);
    persister.write({ n: 1 });
    await persister.idle();
    expect(item.save).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('idle() waits for the writes that are still running', async () => {
    const { item, finishNext } = slowItem();
    const persister = createPersister(item, jest.fn());
    persister.write({ n: 1 });
    let done = false;
    void persister.idle().then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    await finishNext();
    await Promise.resolve();
    expect(done).toBe(true);
  });
});
