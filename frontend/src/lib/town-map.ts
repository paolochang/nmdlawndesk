// The town map (build-plan §7): a fictional map of Dave's four towns and the
// outside towns customers can be drawn in, with the customer's own town marked.
// While the customer side is focused every town is neutral, since a customer does
// not know Dave's schedule; once Dave's side is open, every town takes its weekday
// group's colour.
import { OUTSIDE_COLOR, townColor, type DaveConfig } from './config.ts';
import type { Focus } from './layout.ts';

/** Map coordinates in a 320 × 200 view box. */
export const TOWN_POSITIONS: Record<string, { x: number; y: number }> = {
  Ashford: { x: 118, y: 62 },
  Clearwater: { x: 196, y: 54 },
  Birchwood: { x: 110, y: 134 },
  Dunmore: { x: 204, y: 140 },
  'Kestrel Bay': { x: 282, y: 104 },
  Fernhill: { x: 34, y: 40 },
  Oakmere: { x: 44, y: 176 },
};

export interface TownMarker {
  town: string;
  x: number;
  y: number;
  color: string;
  /** The customer lives here. */
  customer: boolean;
}

export interface TownMapView {
  markers: TownMarker[];
  /** Dave's weekday colours are shown (and his service area). */
  daveView: boolean;
}

export function townMap(focus: Focus, customerTown: string, config: DaveConfig | undefined): TownMapView {
  const daveView = focus !== 'customer' && config !== undefined;
  const markers: TownMarker[] = [];
  for (const [town, position] of Object.entries(TOWN_POSITIONS)) {
    const customer = town === customerTown;
    const color = daveView ? townColor(config, town) : OUTSIDE_COLOR;
    markers.push({ town, ...position, color, customer });
  }
  return { markers, daveView };
}
