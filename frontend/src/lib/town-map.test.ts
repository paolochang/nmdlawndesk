import { describe, expect, it } from 'vitest';
import { GROUP_COLORS, OUTSIDE_COLOR } from './config.ts';
import { config } from './test-messages.ts';
import { townMap } from './town-map.ts';

describe('townMap (build-plan §7)', () => {
  it("shows only the customer's own town while the customer side is focused", () => {
    const view = townMap('customer', 'Birchwood', config);
    expect(view.daveView).toBe(false);
    expect(view.markers).toEqual([{ town: 'Birchwood', x: 110, y: 134, color: OUTSIDE_COLOR, customer: true }]);
  });

  it("colours every town by Dave's weekday group once his side is open, outside towns grey", () => {
    const view = townMap('both', 'Fernhill', config);
    expect(view.daveView).toBe(true);
    const color = Object.fromEntries(view.markers.map((m) => [m.town, m.color]));
    expect(color).toEqual({
      Ashford: GROUP_COLORS[0],
      Clearwater: GROUP_COLORS[0],
      Birchwood: GROUP_COLORS[1],
      Dunmore: GROUP_COLORS[1],
      'Kestrel Bay': OUTSIDE_COLOR,
      Fernhill: OUTSIDE_COLOR,
      Oakmere: OUTSIDE_COLOR,
    });
    expect(view.markers.filter((m) => m.customer).map((m) => m.town)).toEqual(['Fernhill']);
  });
});
