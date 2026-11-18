/** Where a view is on screen, in window coordinates (for popups anchored to it). */
export type WindowRect = { x: number; y: number; width: number; height: number };

/** Anything with React Native's measureInWindow (a host component instance). */
type Measurable = {
  measureInWindow(callback: (x: number, y: number, width: number, height: number) => void): void;
};

/**
 * Measures a mounted view on screen. A function of its own so tests (where nothing has a real layout)
 * can replace it with jest.mock('@/ui/measure').
 */
export function measureInWindow(view: Measurable): Promise<WindowRect> {
  return new Promise((resolve) =>
    view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height })),
  );
}
