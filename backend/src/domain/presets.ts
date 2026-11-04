import { quote } from './quote.ts';
import { RULES, type Town } from './rules.ts';
import { addDays, joinDateTime, toMinutes } from './time.ts';
import type { Booking } from './types.ts';

export interface SeedBooking {
	/** Days after the demo date (the demo date is a Sunday, so 1 = Monday). */
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
// both weekday groups within two weeks and has one tight day the agent must
// work around. Demo date 2026-11-15 is a Sunday: offsets 1 Mon 16, 2 Tue 17,
// 4 Thu 19, 5 Fri 20, 8 Mon 23, 9 Tue 24, 11 Thu 26, 12 Fri 27. Names and
// addresses are fictional.
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

/** The preset's bookings as dated, priced calendar entries. */
export function presetBookings(preset: Preset, demoDate: string = RULES.demoDate): Booking[] {
	return preset.bookings.map((seed, i) => {
		const q = quote(seed.acres);
		if (q.kind !== 'quote') throw new Error(`Preset ${preset.id} booking ${i} cannot be quoted`);
		const date = addDays(demoDate, seed.dayOffset);
		const start = toMinutes(seed.start);
		return {
			id: `seed-${preset.id}-${i + 1}`,
			start: joinDateTime(date, start),
			end: joinDateTime(date, start + q.durationMinutes),
			name: seed.name,
			address: seed.address,
			town: seed.town,
			durationMinutes: q.durationMinutes,
			priceCents: q.priceCents,
			basis: `${seed.name} · ${seed.address}, ${seed.town} · ${q.basis}`,
		};
	});
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
