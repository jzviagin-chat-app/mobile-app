import { formatDuration } from './format';

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [59.2, '1:00'], // rounds up: a countdown never shows 0 while time is left
    [75, '1:15'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [3723, '1:02:03'],
    [18_723, '5:12:03'],
    [-3, '0:00'],
  ])('%s s → %s', (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
