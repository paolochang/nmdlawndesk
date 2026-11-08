import { describe, expect, it } from 'vitest';
import { acceptSnapshot, calendarWindow, dayLabel, toEvents, todayLabel, type CalendarBooking, type CalendarSnapshot } from './calendar.ts';
import { GROUP_TINTS, INK, NEW_BOOKING_COLOR } from './config.ts';
import { config } from './test-messages.ts';

const booking = (id: string, town: string, start: string, end: string): CalendarBooking => ({
  id,
  name: 'Maya Torres',
  address: '45 Oak Rd',
  town,
  start,
  end,
  durationMinutes: 60,
  priceCents: 4500,
  basis: `Maya Torres · 45 Oak Rd, ${town} · 0.5 acre → 1 h × $45 = $45`,
});

describe("Dave's calendar (build-plan §7)", () => {
  // build-plan §12: the snapshot's `today` (Dave's date) places the window.
  it("shows the bookable weeks from the Monday of the snapshot's today, within opening hours", () => {
    expect(calendarWindow(config, '2026-12-03', [])).toEqual({
      start: '2026-11-30',
      end: '2026-12-18',
      slotMinTime: '08:00',
      slotMaxTime: '13:00',
    });
  });

  it('starts on the next Monday when today is a Saturday or Sunday', () => {
    expect(calendarWindow(config, '2026-12-05', []).start).toBe('2026-12-07');
    expect(calendarWindow(config, '2026-11-15', []).start).toBe('2026-11-16');
  });

  it('stretches the window to a booking made past the default search window', () => {
    const late = booking('g1-3', 'Birchwood', '2026-12-01T08:00', '2026-12-01T09:00');
    expect(calendarWindow(config, '2026-11-15', [late]).end).toBe('2026-12-02');
  });

  it("says today with Dave's time zone in the header", () => {
    expect(todayLabel('2026-12-03', 'America/New_York')).toBe('Thu, Dec 3, 2026 · New York time');
  });

  it('labels each weekday with its towns, and Wednesday as off', () => {
    expect(dayLabel(config, 1)).toEqual({ towns: 'Ashford · Clearwater', group: 0 });
    expect(dayLabel(config, 2)).toEqual({ towns: 'Birchwood · Dunmore', group: 1 });
    expect(dayLabel(config, 3)).toEqual({ towns: 'No work', group: undefined });
  });

  it('tints seed bookings by town group, shows desk bookings in green, and marks only the landing one', () => {
    const events = toEvents(
      [
        booking('seed-A-1', 'Ashford', '2026-11-16T08:00', '2026-11-16T09:00'),
        booking('g2-1', 'Birchwood', '2026-11-17T10:30', '2026-11-17T12:00'),
      ],
      config,
      'g2-1',
    );
    expect(events).toEqual([
      {
        id: 'seed-A-1',
        title: 'Maya Torres · Ashford',
        start: '2026-11-16T08:00',
        end: '2026-11-16T09:00',
        color: GROUP_TINTS[0],
        contrastColor: INK,
        extendedProps: { name: 'Maya Torres', town: 'Ashford', basis: 'Maya Torres · 45 Oak Rd, Ashford · 0.5 acre → 1 h × $45 = $45' },
      },
      {
        id: 'g2-1',
        title: 'Maya Torres · Birchwood',
        start: '2026-11-17T10:30',
        end: '2026-11-17T12:00',
        color: NEW_BOOKING_COLOR,
        contrastColor: '#ffffff',
        className: 'landing',
        extendedProps: {
          name: 'Maya Torres',
          town: 'Birchwood',
          basis: 'Maya Torres · 45 Oak Rd, Birchwood · 0.5 acre → 1 h × $45 = $45',
          // Only the desk's bookings carry the store's booking id; seed ones are the made-up schedule.
          bookingId: 'g2-1',
        },
      },
    ]);
  });
});

describe('acceptSnapshot (Reset all vs an in-flight calendar load)', () => {
  const snapshot = (generation: number): CalendarSnapshot => ({
    generation,
    presetId: 'A',
    customers: [],
    bookings: [],
    today: '2026-12-03',
    timeZone: 'America/New_York',
    daveTexts: [],
  });

  it('never lets a calendar loaded before a reset replace the reset one', () => {
    expect(acceptSnapshot(snapshot(5), snapshot(4))).toBe(false);
    expect(acceptSnapshot(snapshot(5), snapshot(5))).toBe(true);
    expect(acceptSnapshot(snapshot(5), snapshot(6))).toBe(true);
    expect(acceptSnapshot(undefined, snapshot(1))).toBe(true);
  });
});
