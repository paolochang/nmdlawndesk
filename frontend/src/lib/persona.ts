// The fictional person the tester texts as (build-plan §7). New customer draws
// one; the tester may edit the street, town, and yard until the first text.
import { newCustomerPhone } from './conversation.ts';

/** Dave's four towns (backend `TOWNS`). */
export const DAVE_TOWNS = ['Ashford', 'Clearwater', 'Birchwood', 'Dunmore'] as const;
/** Fictional towns outside Dave's area: the desk hands these to Dave. */
export const OUTSIDE_TOWNS = ['Kestrel Bay', 'Fernhill', 'Oakmere'] as const;
/** Every town a customer can live in, in alphabetical order so the list gives nothing away. */
export const ALL_TOWNS: readonly string[] = [...DAVE_TOWNS, ...OUTSIDE_TOWNS].sort();
/** Share of new customers drawn outside Dave's towns. */
export const OUTSIDE_SHARE = 0.25;
/** Yard sizes the tester can pick, in acres; `null` is "not sure". Over 1 acre is a handoff. */
export const YARDS: readonly (number | null)[] = [0.25, 0.5, 0.75, 1, 1.5, 2, null];

const DRAWN_YARDS = [0.25, 0.5, 0.75, 1];
const NAMES = [
  'Maya Torres',
  'Ben Okafor',
  'Lena Fischer',
  'Diego Marín',
  'Priya Nair',
  'Sam Whitfield',
  'Ava Lindqvist',
  'Hana Sato',
  'Marcus Doyle',
  'Rosa Quinn',
  'Theo Grant',
  'Iris Moreau',
];
const STREETS: Record<string, readonly string[]> = {
  Ashford: ['45 Oak Rd', '7 Hollow Ln'],
  Clearwater: ['18 Shore Rd', '52 Reed St'],
  Birchwood: ['9 Aspen Ct', '120 Birch Ave'],
  Dunmore: ['31 Quarry Way', '6 Heath Rd'],
  'Kestrel Bay': ['3 Harbor Rd', '88 Gull Ln'],
  Fernhill: ['14 Bracken Way', '2 Hill Ct'],
  Oakmere: ['60 Mere Rd', '5 Acorn St'],
};

export interface Customer {
  phone: string;
  name: string;
  town: string;
  street: string;
  /** Yard size in acres, or `null` when the customer is not sure. */
  acres: number | null;
}

/** The tab keeps the open customer, so a reload or a re-sign-in reopens the same conversation. */
export const CUSTOMER_KEY = 'lawn-desk.customer';

/** `+15556212802` → `+1 555-621-2802`; the stored form stays the conversation key. */
export function formatPhone(phone: string): string {
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return match ? `+1 ${match[1]}-${match[2]}-${match[3]}` : phone;
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}

/**
 * A new fictional customer. Outside Dave's towns only `OUTSIDE_SHARE` of the
 * time; never a name or phone already used in this tab while others are left.
 */
export function newCustomer(
  random: () => number = Math.random,
  taken: { names: readonly string[]; phones: readonly string[] } = { names: [], phones: [] },
): Customer {
  const outside = random() < OUTSIDE_SHARE;
  const town = pick(outside ? OUTSIDE_TOWNS : DAVE_TOWNS, random);
  const free = NAMES.filter((name) => !taken.names.includes(name));
  const name = pick(free.length ? free : NAMES, random);
  const street = pick(STREETS[town], random);
  const acres = pick(DRAWN_YARDS, random);
  return { phone: newCustomerPhone(random, taken.phones), name, town, street, acres };
}

function isCustomer(value: unknown): value is Customer {
  if (typeof value !== 'object' || value === null) return false;
  const { phone, name, town, street, acres } = value as Record<string, unknown>;
  return (
    typeof phone === 'string' &&
    /^\+1555\d{7}$/.test(phone) &&
    typeof name === 'string' &&
    name.trim().length > 0 &&
    name.length <= 60 &&
    typeof town === 'string' &&
    ALL_TOWNS.includes(town) &&
    typeof street === 'string' &&
    street.length <= 80 &&
    (acres === null || (typeof acres === 'number' && YARDS.includes(acres)))
  );
}

/** Only the fields we know, so stray stored keys never reach the UI. */
function pickFields({ phone, name, town, street, acres }: Customer): Customer {
  return { phone, name, town, street, acres };
}

export function parseCustomer(value: unknown): Customer | undefined {
  return isCustomer(value) ? pickFields(value) : undefined;
}

/** The stored customer when it is well formed; otherwise a new one. */
export function restoreCustomer(stored: string | null, random: () => number = Math.random): Customer {
  try {
    const customer = parseCustomer(stored ? JSON.parse(stored) : undefined);
    if (customer) return customer;
  } catch {
    // Not JSON: draw a new customer.
  }
  return newCustomer(random);
}
