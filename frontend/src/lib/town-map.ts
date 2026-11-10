// The town map (build-plan §7): a fictional map of Dave's four towns and the
// outside towns customers can be drawn in, with the customer's own town marked.
// While the customer side is focused every town is neutral, since a customer does
// not know Dave's schedule; once Dave's side is open, every town takes its weekday
// group's colour.
import { HERE_COLOR, OUTSIDE_COLOR, townColor, WEEKDAYS, type DaveConfig } from './config.ts';
import type { Focus } from './layout.ts';

/** Map coordinates in a 320 × 214 view box. */
export const TOWN_POSITIONS: Record<string, { x: number; y: number }> = {
  Ashford: { x: 74, y: 64 },
  Clearwater: { x: 190, y: 46 },
  Birchwood: { x: 96, y: 146 },
  Dunmore: { x: 210, y: 130 },
  'Kestrel Bay': { x: 274, y: 190 },
  Fernhill: { x: 28, y: 190 },
  Oakmere: { x: 300, y: 92 },
};

/** Roads between towns, drawn under the markers. */
export const ROADS: [string, string][] = [
  ['Fernhill', 'Birchwood'],
  ['Birchwood', 'Ashford'],
  ['Ashford', 'Clearwater'],
  ['Clearwater', 'Oakmere'],
  ['Birchwood', 'Dunmore'],
  ['Dunmore', 'Kestrel Bay'],
  ['Ashford', 'Dunmore'],
  ['Clearwater', 'Dunmore'],
];

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
    const color = daveView ? townColor(config, town) : customer ? HERE_COLOR : OUTSIDE_COLOR;
    markers.push({ town, ...position, color, customer });
  }
  return { markers, daveView };
}

/** Under the map: the address, and once Dave's side is open, whether he mows there. */
export function mapCaption(customer: { street: string; town: string }, config: DaveConfig | undefined, daveView: boolean): string {
  const address = `${customer.street}, ${customer.town}`;
  if (!daveView || !config) return address;
  const group = config.townGroups.find((g) => g.towns.includes(customer.town));
  if (!group) return `${address} · not one of Dave's towns`;
  return `${address} · Dave mows here on ${group.weekdays.map((day) => WEEKDAYS[day]).join(', ')}`;
}

/** `.persona-body`'s columns: `repeat(auto-fit, minmax(240px, 1fr))` with a 16px gap. */
const PERSONA_COLUMN_MIN = 240;
const PERSONA_GAP = 16;

/**
 * Whether the customer card is too narrow for the details and the map side by side, so
 * the map wraps under the details (as when both sides are open). Then the map starts
 * folded, leaving the suggested replies and booking status in view (owner E2E).
 */
export function mapStacked(cardBodyWidth: number): boolean {
  return cardBodyWidth < PERSONA_COLUMN_MIN * 2 + PERSONA_GAP;
}
