import { describe, expect, it } from 'vitest';
import { resolveTown } from '../../src/domain/rules.ts';
import { checkSlot, findSlots } from '../../src/domain/slots.ts';
import type { TimeRange } from '../../src/domain/types.ts';

// RULES.demoDate 2026-11-15 is a Sunday: Mon 16, Tue 17, Thu 19, Fri 20, Mon 23 …
const from = '2026-11-15';
const weekdayOf = (dateTime: string) => new Date(`${dateTime.slice(0, 10)}T00:00Z`).getUTCDay();

describe('resolveTown', () => {
	it('ignores case and surrounding spaces', () => {
		expect(resolveTown('  ashFORD ')).toBe('Ashford');
	});

	it('returns undefined outside the four towns', () => {
		expect(resolveTown('Riverside')).toBeUndefined();
	});
});

describe('findSlots', () => {
	it('offers the earliest open slot on each of the next town days', () => {
		expect(findSlots({ town: 'Ashford', durationMinutes: 60, from, bookings: [] })).toEqual([
			{ start: '2026-11-16T08:00', end: '2026-11-16T09:00' },
			{ start: '2026-11-19T08:00', end: '2026-11-19T09:00' },
		]);
	});

	it.each([
		['Ashford', [1, 4]],
		['Clearwater', [1, 4]],
		['Birchwood', [2, 5]],
		['Dunmore', [2, 5]],
	] as const)('%s only gets its weekdays', (town, weekdays) => {
		const slots = findSlots({ town, durationMinutes: 60, from, bookings: [], limit: 99 });
		expect(slots).toHaveLength(4);
		for (const slot of slots) expect(weekdays).toContain(weekdayOf(slot.start));
	});

	it('never offers a 1.5 h job at 12 PM, so it ends by 1 PM', () => {
		const bookings: TimeRange[] = [{ start: '2026-11-16T08:00', end: '2026-11-16T12:00' }];
		expect(findSlots({ town: 'Ashford', durationMinutes: 60, from, bookings, limit: 1 })).toEqual([
			{ start: '2026-11-16T12:00', end: '2026-11-16T13:00' },
		]);
		expect(findSlots({ town: 'Ashford', durationMinutes: 90, from, bookings, limit: 1 })).toEqual([
			{ start: '2026-11-19T08:00', end: '2026-11-19T09:30' },
		]);
	});

	it('avoids existing bookings and allows back-to-back jobs', () => {
		const first = (bookings: TimeRange[]) =>
			findSlots({ town: 'Birchwood', durationMinutes: 60, from, bookings, limit: 1 })[0];
		expect(first([{ start: '2026-11-17T08:00', end: '2026-11-17T09:00' }]).start).toBe('2026-11-17T09:00');
		expect(first([{ start: '2026-11-17T08:30', end: '2026-11-17T09:30' }]).start).toBe('2026-11-17T09:30');
	});

	it('starts searching on the from date', () => {
		const slots = findSlots({ town: 'Ashford', durationMinutes: 60, from: '2026-11-17', bookings: [] });
		expect(slots[0].start).toBe('2026-11-19T08:00');
	});

	it('returns no slots when the town days in range are full', () => {
		const bookings: TimeRange[] = [{ start: '2026-11-16T08:00', end: '2026-11-16T13:00' }];
		expect(findSlots({ town: 'Ashford', durationMinutes: 60, from: '2026-11-16', days: 1, bookings })).toEqual([]);
	});
});

describe('checkSlot', () => {
	const ok = { town: 'Ashford', from, bookings: [] } as const;

	it('accepts an open slot on a town day and returns its end', () => {
		expect(checkSlot({ ...ok, start: '2026-11-16T11:30', durationMinutes: 90 })).toEqual({
			ok: true,
			slot: { start: '2026-11-16T11:30', end: '2026-11-16T13:00' },
		});
	});

	it.each([
		['wrong-weekday', '2026-11-17T08:00', 60],
		['outside-hours', '2026-11-16T12:00', 90],
		['outside-hours', '2026-11-16T07:30', 60],
		['past', '2026-11-09T08:00', 60],
	] as const)('rejects %s: %s for %s min', (reason, start, durationMinutes) => {
		expect(checkSlot({ ...ok, start, durationMinutes })).toEqual({ ok: false, reason });
	});

	it('rejects an overlap but not a back-to-back booking', () => {
		const bookings: TimeRange[] = [{ start: '2026-11-16T09:00', end: '2026-11-16T10:00' }];
		expect(checkSlot({ ...ok, bookings, start: '2026-11-16T08:30', durationMinutes: 60 })).toEqual({
			ok: false,
			reason: 'overlap',
		});
		expect(checkSlot({ ...ok, bookings, start: '2026-11-16T10:00', durationMinutes: 60 }).ok).toBe(true);
	});

	it('throws on a malformed date-time or duration', () => {
		expect(() => checkSlot({ ...ok, start: 'Monday 9am', durationMinutes: 60 })).toThrow(RangeError);
		expect(() => checkSlot({ ...ok, start: '2026-11-31T08:00', durationMinutes: 60 })).toThrow(RangeError);
		expect(() => checkSlot({ ...ok, start: '2026-11-16T08:00', durationMinutes: 0 })).toThrow(RangeError);
	});
});
