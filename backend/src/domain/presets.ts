import { quote } from './quote.ts';
import type { Town } from './rules.ts';
import { addDays, joinDateTime, toMinutes, weekdayOf } from './time.ts';
import type { Booking } from './types.ts';

export interface SeedBooking {
	/** Days after the anchor Sunday: 1 = Monday, 8 = the next Monday. */
	dayOffset: number;
	/** `HH:mm` */
	start: string;
	acres: number | 'unknown';
	name: string;
	address: string;
	town: Town;
}

export interface Preset {
	id: string;
	label: string;
	bookings: SeedBooking[];
}

// Seed schedules for Dave (build-plan §6). Every preset leaves open slots for
// both weekday groups within two weeks, has one tight day the agent must work
// around, and has a seed in each of its two weeks (so a returning visitor's
// top-up always adds future seeds, §12). Offsets count from an anchor Sunday:
// 1 Mon, 2 Tue, 4 Thu, 5 Fri, 8 Mon, 9 Tue, 11 Thu, 12 Fri. With the anchor
// 2026-11-15: Mon 16, Tue 17, Thu 19, Fri 20, Mon 23, Tue 24, Thu 26, Fri 27.
// Names and addresses are fictional.
export const PRESETS: Preset[] = [
	{
		id: 'A',
		label: 'Full Monday',
		bookings: [
			{ dayOffset: 1, start: '08:00', acres: 1, name: 'Maria Lopez', address: '12 Elm St', town: 'Ashford' },
			{ dayOffset: 1, start: '09:30', acres: 0.75, name: 'Tom Becker', address: '8 Lake Dr', town: 'Clearwater' },
			{ dayOffset: 1, start: '11:00', acres: 0.5, name: 'Priya Shah', address: '301 Main St', town: 'Ashford' },
			{ dayOffset: 1, start: '12:00', acres: 0.25, name: 'Ken Ito', address: '5 Mill Ln', town: 'Clearwater' },
			{ dayOffset: 2, start: '09:00', acres: 0.5, name: 'Grace Kim', address: '77 Birch Ave', town: 'Birchwood' },
			{ dayOffset: 4, start: '10:00', acres: 1, name: 'Owen Price', address: '19 Pine Rd', town: 'Ashford' },
			{ dayOffset: 9, start: '11:00', acres: 0.5, name: 'Rosa Diaz', address: '12 Quarry Way', town: 'Dunmore' },
		],
	},
	{
		id: 'B',
		label: 'Noon gap on Tuesday',
		bookings: [
			{ dayOffset: 2, start: '08:00', acres: 1, name: 'Hannah Moss', address: '40 Ridge Rd', town: 'Birchwood' },
			{ dayOffset: 2, start: '09:30', acres: 0.5, name: 'Luis Ortega', address: '2 Quarry Way', town: 'Dunmore' },
			{ dayOffset: 2, start: '10:30', acres: 0.9, name: 'Ella Novak', address: '63 Birch Ave', town: 'Birchwood' },
			{ dayOffset: 1, start: '10:00', acres: 0.5, name: 'Sam Carter', address: '14 Oak Rd', town: 'Ashford' },
			{ dayOffset: 5, start: '08:00', acres: 1, name: 'Nadia Rahman', address: '9 Fen Ct', town: 'Dunmore' },
			{ dayOffset: 11, start: '09:00', acres: 0.5, name: 'Mia Ford', address: '18 Shore Rd', town: 'Clearwater' },
		],
	},
	{
		id: 'C',
		label: 'Busy Thursday morning',
		bookings: [
			{ dayOffset: 4, start: '08:00', acres: 0.5, name: 'Ben Walsh', address: '27 Shore Rd', town: 'Clearwater' },
			{ dayOffset: 4, start: '09:00', acres: 1, name: 'Ivy Chen', address: '3 Elm St', town: 'Ashford' },
			{ dayOffset: 4, start: '10:30', acres: 0.75, name: 'Ray Dunn', address: '88 Lake Dr', town: 'Clearwater' },
			{ dayOffset: 8, start: '08:00', acres: 'unknown', name: 'Zoe Hart', address: '150 Main St', town: 'Ashford' },
			{ dayOffset: 12, start: '11:00', acres: 0.5, name: 'Felix Grant', address: '6 Moor Ln', town: 'Dunmore' },
		],
	},
	{
		id: 'D',
		label: 'Full Friday',
		bookings: [
			{ dayOffset: 5, start: '08:00', acres: 1, name: 'Olga Petrov', address: '21 Fen Ct', town: 'Dunmore' },
			{ dayOffset: 5, start: '09:30', acres: 0.8, name: 'Jack Reid', address: '54 Birch Ave', town: 'Birchwood' },
			{ dayOffset: 5, start: '11:00', acres: 0.5, name: 'Amy Lowe', address: '10 Quarry Way', town: 'Dunmore' },
			{ dayOffset: 5, start: '12:00', acres: 0.4, name: 'Noah Bell', address: '33 Ridge Rd', town: 'Birchwood' },
			{ dayOffset: 1, start: '12:00', acres: 0.5, name: 'Lena Park', address: '71 Pine Rd', town: 'Ashford' },
			{ dayOffset: 9, start: '08:00', acres: 0.5, name: 'Chris Young', address: '4 Moor Ln', town: 'Dunmore' },
		],
	},
];

/**
 * The preset's bookings as dated, priced calendar entries for the two weeks after
 * `anchor` (a Sunday). Ids carry the anchor, so a top-up never repeats one.
 */
export function presetBookings(preset: Preset, anchor: string): Booking[] {
	if (weekdayOf(anchor) !== 0) throw new RangeError(`A preset anchor must be a Sunday, got ${anchor}`);
	return preset.bookings.map((seed, i) => {
		const q = quote(seed.acres);
		if (q.kind !== 'quote') throw new Error(`Preset ${preset.id} booking ${i} cannot be quoted`);
		const date = addDays(anchor, seed.dayOffset);
		const start = toMinutes(seed.start);
		return {
			id: `seed-${preset.id}-${anchor}-${i + 1}`,
			start: joinDateTime(date, start),
			end: joinDateTime(date, start + q.durationMinutes),
			name: seed.name,
			address: seed.address,
			town: seed.town,
			durationMinutes: q.durationMinutes,
			priceCents: q.priceCents,
			basis: bookingBasis(seed.name, seed.address, seed.town, q.basis),
		};
	});
}

/** `Sarah Lee · 45 Oak Rd, Ashford · 0.5 acre → 1 h × $45 = $45` (build-plan §5). */
export function bookingBasis(name: string, address: string, town: Town, quoteBasis: string): string {
	return `${name} · ${address}, ${town} · ${quoteBasis}`;
}

/**
 * A random preset other than `currentId` (any preset when there is none).
 * `random` returns a number in [0, 1), like Math.random; tests inject their own.
 */
export function pickPreset(currentId: string | undefined, random: () => number): Preset {
	const choices = PRESETS.filter((p) => p.id !== currentId);
	const i = Math.floor(random() * choices.length);
	// Clamp out-of-range values from an injected source; NaN falls back to the first.
	return choices[Math.min(Math.max(i, 0), choices.length - 1)] ?? choices[0];
}
