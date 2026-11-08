// Dave's rules as `GET /api/config` serves them (backend `RULES`, build-plan §4),
// and how Dave's side shows them: the price table, the town days, and the colour
// of each weekday group (shared by the calendar and the town map).

export interface DaveConfig {
  /** The simulator's fixed "today", `YYYY-MM-DD` (a Sunday). */
  demoDate: string;
  hours: { open: string; close: string };
  slotStepMinutes: number;
  searchDays: number;
  /** `weekdays`: 0 = Sunday … 6 = Saturday. */
  townGroups: { weekdays: number[]; towns: string[] }[];
  hourlyRateCents: number;
  /** Upper bound in acres (inclusive) → job length; anything larger is handed off. */
  priceTable: { maxAcres: number; durationMinutes: number }[];
  unknownSizeDurationMinutes: number;
}

export interface PriceRow {
  yard: string;
  duration: string;
  price: string;
}

export interface TownDays {
  days: string;
  towns: string;
  color: string;
}

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** One colour per weekday group, in `townGroups` order; outside towns are grey. */
export const GROUP_COLORS = ['#2f6db3', '#b8590f'];
export const OUTSIDE_COLOR = '#8f9992';

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

function hours(minutes: number): string {
  return `${minutes / 60} h`;
}

function acres(value: number): string {
  if (value === 0.5) return '½ acre';
  return `${value} acre`;
}

/** `08:00` → `8 AM`, `13:00` → `1 PM`. */
export function clock(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hour}:${String(m).padStart(2, '0')} ${suffix}` : `${hour} ${suffix}`;
}

/** The price table as Dave's side shows it, ending with the handoff and not-sure rows. */
export function priceRows(config: DaveConfig): PriceRow[] {
  const rows: PriceRow[] = [];
  let previous: number | undefined;
  for (const { maxAcres, durationMinutes } of config.priceTable) {
    rows.push({
      yard: previous === undefined ? `up to ${acres(maxAcres)}` : `${acres(previous)} to ${acres(maxAcres)}`,
      duration: hours(durationMinutes),
      price: money((config.hourlyRateCents * durationMinutes) / 60),
    });
    previous = maxAcres;
  }
  if (previous !== undefined) rows.push({ yard: `over ${acres(previous)}`, duration: '—', price: 'Dave decides' });
  rows.push({
    yard: 'not sure',
    duration: hours(config.unknownSizeDurationMinutes),
    price: `${money((config.hourlyRateCents * config.unknownSizeDurationMinutes) / 60)}, adjusted on site`,
  });
  return rows;
}

/** Which towns Dave mows on which weekdays, with the group's colour. */
export function townDays(config: DaveConfig): TownDays[] {
  return config.townGroups.map((group, index) => ({
    days: group.weekdays.map((day) => WEEKDAY_NAMES[day]).join(', '),
    towns: group.towns.join(', '),
    color: GROUP_COLORS[index % GROUP_COLORS.length],
  }));
}

/** The colour of the weekday group serving `town`, or grey outside Dave's area. */
export function townColor(config: DaveConfig, town: string): string {
  const index = config.townGroups.findIndex((group) => group.towns.includes(town));
  return index < 0 ? OUTSIDE_COLOR : GROUP_COLORS[index % GROUP_COLORS.length];
}
