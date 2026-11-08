import { describe, expect, it } from 'vitest';
import { panelLayout } from './layout.ts';

describe('panelLayout (build-plan §7)', () => {
  it('starts on the customer: wide customer, narrow Dave hidden from the tester', () => {
    expect(panelLayout('customer')).toEqual({ customer: 'wide', dave: 'narrow', veiled: 'dave' });
  });

  it('shows both sides at half width with nothing hidden', () => {
    expect(panelLayout('both')).toEqual({ customer: 'half', dave: 'half', veiled: undefined });
  });

  it('hides the customer while Dave is wide', () => {
    expect(panelLayout('dave')).toEqual({ customer: 'narrow', dave: 'wide', veiled: 'customer' });
  });
});
