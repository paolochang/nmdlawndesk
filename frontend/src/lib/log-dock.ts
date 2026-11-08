// The judgment log docks at the bottom of the window like browser dev tools
// (build-plan §7): collapsed to its head by default, opened to a height the
// tester can drag. The browser remembers both, as a per-viewer convenience.

export interface LogDock {
  open: boolean;
  /** Height of the opened log, in px. */
  height: number;
}

export const LOG_DOCK_KEY = 'lawn-desk.log';
export const DEFAULT_LOG_HEIGHT = 320;
export const MIN_LOG_HEIGHT = 160;
/** What the header and the customer and Dave panels keep of the window, at least. */
const PANELS_MIN_HEIGHT = 520;

/** The opened log's height, kept between its minimum and what leaves the panels usable. */
export function clampLogHeight(height: number, windowHeight: number): number {
  const max = Math.max(MIN_LOG_HEIGHT, windowHeight - PANELS_MIN_HEIGHT);
  return Math.round(Math.min(max, Math.max(MIN_LOG_HEIGHT, height)));
}

export function loadLogDock(stored: string | null): LogDock {
  try {
    const value: unknown = stored ? JSON.parse(stored) : undefined;
    if (typeof value !== 'object' || value === null) return { open: false, height: DEFAULT_LOG_HEIGHT };
    const { open, height } = value as Record<string, unknown>;
    return {
      open: open === true,
      height: typeof height === 'number' && Number.isFinite(height) ? height : DEFAULT_LOG_HEIGHT,
    };
  } catch {
    return { open: false, height: DEFAULT_LOG_HEIGHT };
  }
}
