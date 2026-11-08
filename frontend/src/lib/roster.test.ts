import { describe, expect, it } from 'vitest';
import type { Customer } from './persona.ts';
import { earlierCustomers, loadRoster, rememberCustomer, rememberRecovered, type RosterEntry } from './roster.ts';

const maya: Customer = { phone: '+15552841937', name: 'Maya Torres', town: 'Ashford', street: '45 Oak Rd', acres: 0.5 };
const ben: Customer = { phone: '+15550000001', name: 'Ben Okafor', town: 'Fernhill', street: '2 Hill Ct', acres: 1 };

describe('earlier customers (build-plan §7)', () => {
  it('keeps one entry per customer and generation, newest first, with the latest status', () => {
    let roster: RosterEntry[] = [];
    roster = rememberCustomer(roster, { customer: maya, generation: 1, status: 'open' });
    roster = rememberCustomer(roster, { customer: ben, generation: 1, status: 'with-dave' });
    roster = rememberCustomer(roster, { customer: maya, generation: 1, status: 'booked', detail: 'Mon Nov 16, 8:00-9:00 AM' });

    expect(roster).toEqual([
      { customer: maya, generation: 1, status: 'booked', detail: 'Mon Nov 16, 8:00-9:00 AM' },
      { customer: ben, generation: 1, status: 'with-dave' },
    ]);
  });

  it('lists the other customers of the current generation only', () => {
    const roster: RosterEntry[] = [
      { customer: maya, generation: 2, status: 'open' },
      { customer: ben, generation: 2, status: 'with-dave' },
      { customer: ben, generation: 1, status: 'booked' },
    ];
    expect(earlierCustomers(roster, 2, maya.phone)).toEqual([{ customer: ben, generation: 2, status: 'with-dave' }]);
  });

  it('lists a customer whose refused text was re-sent in the new generation, while another is open', () => {
    // Maya texted in generation 2, got a 409, and the tester opened Ben before the retry landed in generation 3.
    const roster: RosterEntry[] = [{ customer: maya, generation: 2, status: 'open' }];
    expect(earlierCustomers(rememberRecovered(roster, maya, 3), 3, ben.phone)).toEqual([
      { customer: maya, generation: 3, status: 'open' },
    ]);
  });

  it('reads back only well-formed entries', () => {
    const good = { customer: maya, generation: 1, status: 'open' };
    expect(loadRoster(JSON.stringify([good, { customer: { phone: 'x' }, generation: 1, status: 'open' }, 'junk']))).toEqual([good]);
    expect(loadRoster(null)).toEqual([]);
    expect(loadRoster('{')).toEqual([]);
  });
});
