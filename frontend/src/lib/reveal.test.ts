import { describe, expect, it } from 'vitest';
import { gatedBubbles, revealOnSettle } from './reveal.ts';
import type { BookingStatus } from './status.ts';

const open: BookingStatus = { kind: 'open' };
const booked = (bookingId: string, handedOff?: string): BookingStatus => ({
  kind: 'booked',
  bookingId,
  when: 'Mon Nov 16, 8:00-9:00 AM',
  price: '$45',
  duration: '1 h',
  address: '45 Oak Rd, Ashford',
  ...(handedOff ? { handedOff } : {}),
});
const withDave: BookingStatus = { kind: 'with-dave', reason: 'complaint' };

describe('revealOnSettle (build-plan §7 booking reveal)', () => {
  it('reveals a booking or a handoff the settled reply confirmed', () => {
    expect(revealOnSettle(open, booked('g1-1'))).toEqual({ bookingId: 'g1-1', handoff: false });
    expect(revealOnSettle(booked('g1-1'), booked('g1-2'))).toEqual({ bookingId: 'g1-2', handoff: false });
    expect(revealOnSettle(open, withDave)).toEqual({ bookingId: undefined, handoff: true });
    expect(revealOnSettle(booked('g1-1'), booked('g1-1', 'complaint'))).toEqual({ bookingId: undefined, handoff: true });
  });

  it('reveals nothing when the reply changed nothing', () => {
    expect(revealOnSettle(open, open)).toBeUndefined();
    expect(revealOnSettle(booked('g1-1'), booked('g1-1'))).toBeUndefined();
    expect(revealOnSettle(withDave, withDave)).toBeUndefined();
  });
});

describe("gatedBubbles (Dave's phone)", () => {
  const bubbles = [
    { id: 'a:0', from: 'desk' as const, text: 'First alert' },
    { id: 'b:0', from: 'desk' as const, text: 'Second alert' },
  ];

  it("holds alerts that arrive while the customer's desk is still replying, and shows them after", () => {
    expect(gatedBubbles(bubbles, 1)).toEqual([bubbles[0]]);
    expect(gatedBubbles(bubbles, undefined)).toEqual(bubbles);
  });
});
