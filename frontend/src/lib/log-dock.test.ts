import { describe, expect, it } from 'vitest';
import { clampLogHeight, DEFAULT_LOG_HEIGHT, loadLogDock, MIN_LOG_HEIGHT } from './log-dock.ts';

describe('judgment log dock (build-plan §7)', () => {
  it('starts collapsed, and reopens the way the tester left it', () => {
    expect(loadLogDock(null)).toEqual({ open: false, height: DEFAULT_LOG_HEIGHT });
    expect(loadLogDock('{not json')).toEqual({ open: false, height: DEFAULT_LOG_HEIGHT });
    expect(loadLogDock(JSON.stringify({ open: true, height: 'tall' }))).toEqual({ open: true, height: DEFAULT_LOG_HEIGHT });
    expect(loadLogDock(JSON.stringify({ open: true, height: 480 }))).toEqual({ open: true, height: 480 });
  });

  it('keeps the panels above usable when the log is dragged taller', () => {
    // A 900 px window leaves the panels at least 520 px (header and stage).
    expect(clampLogHeight(800, 900)).toBe(380);
    expect(clampLogHeight(40, 900)).toBe(MIN_LOG_HEIGHT);
    expect(clampLogHeight(300, 500)).toBe(MIN_LOG_HEIGHT);
  });
});
