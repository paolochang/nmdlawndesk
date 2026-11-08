import { describe, expect, it } from 'vitest';
import { DAVE_TOWNS, formatPhone, newCustomer, OUTSIDE_TOWNS, restoreCustomer, YARDS } from './persona.ts';

/** A random source that returns the given draws in order, then 0.5. */
function draws(...values: number[]) {
  return () => values.shift() ?? 0.5;
}

describe('newCustomer (build-plan §7)', () => {
  it('draws a fictional person in one of Dave towns three times out of four', () => {
    const customer = newCustomer(draws(0.25, 0));
    expect(DAVE_TOWNS).toContain(customer.town);
    expect(customer.name).toBeTruthy();
    expect(customer.street).toBeTruthy();
    expect([0.25, 0.5, 0.75, 1]).toContain(customer.acres);
    expect(customer.phone).toMatch(/^\+1555\d{7}$/);
  });

  it('places the customer outside Dave towns only on the lowest quarter of the first draw', () => {
    expect(OUTSIDE_TOWNS).toContain(newCustomer(draws(0.24)).town);
    expect(DAVE_TOWNS).toContain(newCustomer(draws(0.25)).town);
  });

  it('never reuses a name or a phone already taken in this tab', () => {
    const first = newCustomer(draws(0.5, 0.5, 0));
    const second = newCustomer(draws(0.5, 0.5, 0), { names: [first.name], phones: [] });
    expect(second.name).not.toBe(first.name);

    const third = newCustomer(draws(0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0.2), { names: [], phones: ['+15555000000'] });
    expect(third.phone).not.toBe('+15555000000');
  });
});

describe('restoreCustomer', () => {
  const stored = { phone: '+15550123456', name: 'Maya Torres', town: 'Ashford', street: '45 Oak Rd', acres: 0.5 };

  it('reopens the stored customer, edits included', () => {
    expect(restoreCustomer(JSON.stringify(stored))).toEqual(stored);
    expect(restoreCustomer(JSON.stringify({ ...stored, town: 'Fernhill', acres: null }))).toEqual({
      ...stored,
      town: 'Fernhill',
      acres: null,
    });
  });

  it('draws a new customer when nothing usable is stored', () => {
    for (const bad of [null, 'not json', '[]', JSON.stringify({ ...stored, phone: 'dave' }), JSON.stringify({ ...stored, town: 'Atlantis' }), JSON.stringify({ ...stored, acres: 3 })]) {
      const customer = restoreCustomer(bad, draws(0.5));
      expect(customer.phone).toMatch(/^\+1555\d{7}$/);
      expect(customer.phone).not.toBe(stored.phone);
    }
  });

  it('offers yard sizes on both sides of the 1-acre handoff, and unknown', () => {
    expect(YARDS).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2, null]);
  });
});

describe('formatPhone', () => {
  it('shows a stored +1 number as +1 555-621-2802', () => {
    expect(formatPhone('+15556212802')).toBe('+1 555-621-2802');
  });

  it('leaves anything else as stored', () => {
    expect(formatPhone('dave')).toBe('dave');
  });
});
