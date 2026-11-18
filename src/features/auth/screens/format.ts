/** 75 → "1:15", 3723 → "1:02:03" (countdowns and waits). */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/**
 * Wraps text that must read left-to-right (a phone number) inside a sentence of either direction,
 * using Unicode isolate marks (LRI … PDI), so "+972" doesn't jump to the wrong side in Hebrew.
 */
export function ltr(text: string): string {
  return `⁦${text}⁩`;
}
