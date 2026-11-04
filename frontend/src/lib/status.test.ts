import { describe, expect, it } from 'vitest';
import { bookingStatus } from './status.ts';
import { done, message, running, text } from './test-messages.ts';

const booked = done(
  'c3',
  'bookSlot',
  { name: 'Maya Torres', address: '45 Oak Rd', town: 'Ashford', start: '2026-11-16T08:00', acres: 0.5 },
  { ok: true, bookingId: 'g1-1', when: 'Mon Nov 16, 8:00-9:00 AM', duration: '1 h', price: '$45', basis: '…', note: '…' },
);

describe('bookingStatus (build-plan §7)', () => {
  it('is open until the desk books or hands off', () => {
    expect(bookingStatus([])).toEqual({ kind: 'open' });
    expect(
      bookingStatus([
        message('m1', 'user', [text('Hi')]),
        message('m2', 'assistant', [running('c1', 'bookSlot', {})]),
      ]),
    ).toEqual({ kind: 'open' });
  });

  it('shows the booking from a successful bookSlot', () => {
    expect(bookingStatus([message('m2', 'assistant', [booked])])).toEqual({
      kind: 'booked',
      bookingId: 'g1-1',
      when: 'Mon Nov 16, 8:00-9:00 AM',
      price: '$45',
      duration: '1 h',
      address: '45 Oak Rd, Ashford',
    });
  });

  it('ignores a refused booking', () => {
    const refused = done('c3', 'bookSlot', { town: 'Ashford' }, { ok: false, reason: 'overlap', next: '…' });
    expect(bookingStatus([message('m2', 'assistant', [refused])])).toEqual({ kind: 'open' });
  });

  it('says the customer is with Dave after a handoff, and keeps a booking made before it', () => {
    const handoff = done('c4', 'handoffToDave', { reason: 'out-of-area', details: '…' }, { ok: true, reply: '…' });
    expect(bookingStatus([message('m2', 'assistant', [handoff])])).toEqual({ kind: 'with-dave', reason: 'out-of-area' });
    expect(bookingStatus([message('m2', 'assistant', [booked]), message('m4', 'assistant', [handoff])])).toMatchObject({
      kind: 'booked',
      handedOff: 'out-of-area',
    });
  });
});
