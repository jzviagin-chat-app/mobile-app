/** 75 → "1:15" (countdowns and waits). */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Wraps text that must read left-to-right (a phone number) inside a sentence of either direction,
 * using Unicode isolate marks (LRI … PDI), so "+972" doesn't jump to the wrong side in Hebrew.
 */
export function ltr(text: string): string {
  return `⁦${text}⁩`;
}
