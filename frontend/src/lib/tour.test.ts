import { describe, expect, it } from 'vitest';
import type { KeyValueStorage } from './session.ts';
import { markTourSeen, TOUR_SLIDES, tourOpensItself } from './tour.ts';

function memoryStorage(): KeyValueStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('onboarding slides (build-plan §15)', () => {
  it('open by themselves once per nickname, until closed', () => {
    const storage = memoryStorage();
    expect(tourOpensItself(storage, 'visitor-a', false)).toBe(true);
    markTourSeen(storage, 'visitor-a');
    expect(tourOpensItself(storage, 'visitor-a', false)).toBe(false);
    expect(tourOpensItself(storage, 'visitor-b', false)).toBe(true);
  });

  it('never open by themselves on a return from Google', () => {
    expect(tourOpensItself(memoryStorage(), 'visitor-a', true)).toBe(false);
  });

  it('walk from the header through both sides to the judgment log, each after the welcome on its own area', () => {
    expect(TOUR_SLIDES.map((slide) => slide.id)).toEqual([
      'welcome',
      'header',
      'customer-card',
      'texting',
      'booking-status',
      'dave-calendar',
      'town-days-prices',
      'dave-phone',
      'judgment-log',
    ]);
    expect(TOUR_SLIDES[0].areas).toEqual([]);
    const areas = TOUR_SLIDES.slice(1).flatMap((slide) => slide.areas);
    expect(TOUR_SLIDES.slice(1).every((slide) => slide.areas.length > 0)).toBe(true);
    expect(new Set(areas).size).toBe(areas.length);
  });
});
