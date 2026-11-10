import { describe, expect, it } from 'vitest';
import { GROUP_COLORS, HERE_COLOR, OUTSIDE_COLOR } from './config.ts';
import { config } from './test-messages.ts';
import { mapCaption, mapStacked, townMap } from './town-map.ts';

const customer = { street: '45 Oak Rd', town: 'Ashford' };

describe('townMap (build-plan §7)', () => {
  it("shows every town on the customer side, neutral, with the customer's own town marked", () => {
    const view = townMap('customer', 'Birchwood', config);
    expect(view.daveView).toBe(false);
    expect(view.markers.map((m) => m.town).sort()).toEqual(
      ['Ashford', 'Birchwood', 'Clearwater', 'Dunmore', 'Fernhill', 'Kestrel Bay', 'Oakmere'],
    );
    const color = Object.fromEntries(view.markers.map((m) => [m.town, m.color]));
    expect(color.Birchwood).toBe(HERE_COLOR);
    expect(color.Ashford).toBe(OUTSIDE_COLOR);
    expect(view.markers.filter((m) => m.customer).map((m) => m.town)).toEqual(['Birchwood']);
    expect(mapCaption(customer, config, false)).toBe('45 Oak Rd, Ashford');
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
    expect(mapCaption(customer, config, true)).toBe('45 Oak Rd, Ashford · Dave mows here on Mon, Thu');
    expect(mapCaption({ street: '2 Hill Ct', town: 'Fernhill' }, config, true)).toBe("2 Hill Ct, Fernhill · not one of Dave's towns");
  });
});

describe('mapStacked (owner E2E)', () => {
  it('folds the map only when the card cannot hold the details and the map side by side', () => {
    expect(mapStacked(495)).toBe(true);
    expect(mapStacked(496)).toBe(false);
  });
});
