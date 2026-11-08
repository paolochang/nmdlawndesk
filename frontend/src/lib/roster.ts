// Customers this browser has texted as (build-plan §7), so the tester can go back
// to one from the customer panel head. Each entry belongs to one generation:
// after a reset, the old conversations are never opened again (§6).
import { CUSTOMER_KEY, parseCustomer, restoreCustomer, type Customer } from './persona.ts';
import type { KeyValueStorage } from './session.ts';

export type CustomerStatus = 'open' | 'booked' | 'with-dave';

export interface RosterEntry {
  customer: Customer;
  generation: number;
  status: CustomerStatus;
  /** The booking time, when booked. */
  detail?: string;
}

export const ROSTER_KEY = 'lawn-desk.customers';
const MAX_ENTRIES = 50;
const STATUSES: readonly string[] = ['open', 'booked', 'with-dave'];

/** Adds or refreshes the customer's entry and moves it to the front. */
export function rememberCustomer(roster: readonly RosterEntry[], entry: RosterEntry): RosterEntry[] {
  const others = roster.filter(
    (old) => old.customer.phone !== entry.customer.phone || old.generation !== entry.generation,
  );
  return [entry, ...others].slice(0, MAX_ENTRIES);
}

/**
 * Lists a customer whose refused (409) text was re-sent in `generation`, even when the
 * tester has opened another customer since. That conversation starts with no booking.
 */
export function rememberRecovered(roster: readonly RosterEntry[], customer: Customer, generation: number): RosterEntry[] {
  return rememberCustomer(roster, { customer, generation, status: 'open' });
}

/** The other customers of this generation, newest first. */
export function earlierCustomers(roster: readonly RosterEntry[], generation: number, currentPhone: string): RosterEntry[] {
  return roster.filter((entry) => entry.generation === generation && entry.customer.phone !== currentPhone);
}

function parseEntry(value: unknown): RosterEntry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { customer, generation, status, detail } = value as Record<string, unknown>;
  const parsed = parseCustomer(customer);
  if (!parsed || !Number.isInteger(generation) || typeof status !== 'string' || !STATUSES.includes(status)) return undefined;
  const entry: RosterEntry = { customer: parsed, generation: generation as number, status: status as CustomerStatus };
  if (typeof detail === 'string') entry.detail = detail;
  return entry;
}

export function loadRoster(stored: string | null): RosterEntry[] {
  try {
    const value: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(value)) return [];
    return value.map(parseEntry).filter((entry): entry is RosterEntry => entry !== undefined);
  } catch {
    return [];
  }
}

/**
 * The visitor's open customer and earlier customers, as this browser kept them
 * (`localStorage`, one pair of keys per visitor). A new tab or a restarted browser
 * reopens the same conversations; another nickname starts with a new customer.
 */
export function loadCustomers(
  storage: KeyValueStorage,
  visitorId: string,
  random: () => number = Math.random,
): { customer: Customer; roster: RosterEntry[] } {
  return {
    customer: restoreCustomer(storage.getItem(`${CUSTOMER_KEY}:${visitorId}`), random),
    roster: loadRoster(storage.getItem(`${ROSTER_KEY}:${visitorId}`)),
  };
}

export function saveCustomers(storage: KeyValueStorage, visitorId: string, customer: Customer, roster: readonly RosterEntry[]): void {
  storage.setItem(`${CUSTOMER_KEY}:${visitorId}`, JSON.stringify(customer));
  storage.setItem(`${ROSTER_KEY}:${visitorId}`, JSON.stringify(roster));
}

/**
 * Names and phones New customer must not draw: the current customer, everyone this
 * browser has texted as, and everyone Dave's calendar already knows (other tabs and
 * devices share it), so a new customer never looks like a booked one.
 */
export function takenDetails(
  current: Customer,
  roster: readonly RosterEntry[],
  calendar: { customers: readonly { phone: string; name?: string }[]; bookings: readonly { name: string }[] } | undefined,
): { names: string[]; phones: string[] } {
  const names = [current.name, ...roster.map((entry) => entry.customer.name)];
  const phones = [current.phone, ...roster.map((entry) => entry.customer.phone)];
  for (const known of calendar?.customers ?? []) {
    phones.push(known.phone);
    if (known.name) names.push(known.name);
  }
  for (const booking of calendar?.bookings ?? []) names.push(booking.name);
  return { names, phones };
}
