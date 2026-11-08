import { describe, expect, it } from 'vitest';
import { GROUP_COLORS, OUTSIDE_COLOR, priceRows, townColor, townDays } from './config.ts';
import { config } from './test-messages.ts';

describe("Dave's rules from /config (build-plan §4)", () => {
  it('shows the price table, the handoff over 1 acre, and the not-sure rate', () => {
    expect(priceRows(config)).toEqual([
      { yard: 'up to ½ acre', duration: '1 h', price: '$45' },
      { yard: '½ acre to 1 acre', duration: '1.5 h', price: '$67.50' },
      { yard: 'over 1 acre', duration: '—', price: 'Dave decides' },
      { yard: 'not sure', duration: '1 h', price: '$45, adjusted on site' },
    ]);
  });

  it('shows the town days, each group in the colour the calendar and map use', () => {
    expect(townDays(config)).toEqual([
      { days: 'Mon, Thu', towns: 'Ashford, Clearwater', color: GROUP_COLORS[0] },
      { days: 'Tue, Fri', towns: 'Birchwood, Dunmore', color: GROUP_COLORS[1] },
    ]);
    expect(townColor(config, 'Dunmore')).toBe(GROUP_COLORS[1]);
    expect(townColor(config, 'Fernhill')).toBe(OUTSIDE_COLOR);
  });
});
