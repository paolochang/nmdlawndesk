import { describe, expect, it } from 'vitest';
import { PRESETS, pickPreset, presetBookings } from '../../src/domain/presets.ts';
import { quote } from '../../src/domain/quote.ts';
import { RULES, TOWNS, townWeekdays } from '../../src/domain/rules.ts';
import { checkSlot, findSlots } from '../../src/domain/slots.ts';
import { addDays, weekdayOf } from '../../src/domain/time.ts';

const from = RULES.demoDate;
const twoWeeks = Array.from({ length: 14 }, (_, d) => addDays(from, d));

describe('seed presets', () => {
	it('has 3-5 presets with unique ids', () => {
		expect(PRESETS.length).toBeGreaterThanOrEqual(3);
		expect(PRESETS.length).toBeLessThanOrEqual(5);
		expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
	});

	describe.each(PRESETS.map((p) => [p.id, p] as const))('preset %s', (_id, preset) => {
		const bookings = presetBookings(preset);

		it('has unique booking ids', () => {
			expect(new Set(bookings.map((b) => b.id)).size).toBe(bookings.length);
		});

		it('only holds bookings the rules allow, within two weeks', () => {
			for (const b of bookings) {
				const others = bookings.filter((o) => o !== b);
				const check = checkSlot({ town: b.town, start: b.start, durationMinutes: b.durationMinutes, bookings: others });
				expect(check, `${b.id} ${b.start}`).toEqual({ ok: true, slot: { start: b.start, end: b.end } });
				expect(twoWeeks).toContain(b.start.slice(0, 10));
			}
		});

		it.each(TOWNS)('leaves 1 h and 1.5 h slots open for %s within two weeks', (town) => {
			for (const durationMinutes of [60, 90]) {
				expect(findSlots({ town, durationMinutes, from, bookings }), `${durationMinutes} min`).not.toHaveLength(0);
			}
		});

		it('has a tight day: full, or a 1 h job fits but a 1.5 h job does not', () => {
			const tight = TOWNS.some((town) =>
				twoWeeks
					.filter((date) => townWeekdays(town).includes(weekdayOf(date)))
					.some((date) => findSlots({ town, durationMinutes: 90, from: date, days: 1, bookings }).length === 0),
			);
			expect(tight).toBe(true);
		});

		it('prices each booking with quote and records the basis', () => {
			for (const [i, seed] of preset.bookings.entries()) {
				const q = quote(seed.acres);
				if (q.kind !== 'quote') throw new Error(`${preset.id} seed ${i} is not quotable`);
				expect(bookings[i]).toMatchObject({
					name: seed.name,
					town: seed.town,
					durationMinutes: q.durationMinutes,
					priceCents: q.priceCents,
					basis: `${seed.name} · ${seed.address}, ${seed.town} · ${q.basis}`,
				});
			}
		});
	});
});

describe('pickPreset', () => {
	const randoms = [0, 0.2, 0.4, 0.6, 0.8, 0.999];

	it('never picks the current preset and can reach every other one', () => {
		for (const current of PRESETS) {
			const picked = new Set(randoms.map((r) => pickPreset(current.id, () => r).id));
			expect(picked).not.toContain(current.id);
			expect(picked.size).toBe(PRESETS.length - 1);
		}
	});

	it('stays in range for out-of-range random values', () => {
		for (const r of [-0.1, 1, Number.NaN]) {
			expect(PRESETS).toContain(pickPreset('A', () => r));
			expect(pickPreset('A', () => r).id).not.toBe('A');
		}
	});

	it('picks from every preset on a first visit', () => {
		const picked = new Set(randoms.map((r) => pickPreset(undefined, () => r).id));
		expect(picked.size).toBe(PRESETS.length);
	});
});
