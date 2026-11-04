import { describe, expect, it } from 'vitest';
import { PRESETS, presetBookings } from '../../src/domain/presets.ts';
import { type BookingRequest, type KvStorage, VisitorLedger } from '../../src/store/ledger.ts';

function memoryKv(): KvStorage {
	const map = new Map<string, unknown>();
	return {
		get: <T>(key: string) => structuredClone(map.get(key)) as T | undefined,
		put: (key, value) => void map.set(key, structuredClone(value)),
	};
}

/** Returns the given values in turn, then repeats the last one. */
const sequence = (...values: number[]) => () => values.length > 1 ? values.shift()! : values[0];

// Preset A (random 0 on a first visit) fills Mon 2026-11-16 and books Tue 17 09:00-10:00.
const request: BookingRequest = {
	name: 'Sarah Lee',
	address: '45 Oak Rd',
	town: 'Birchwood',
	start: '2026-11-17T10:00',
	acres: 0.5,
};

describe('VisitorLedger', () => {
	it('starts a first visit at generation 1 with a random preset and no customers', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		expect(ledger.list()).toEqual({
			generation: 1,
			presetId: PRESETS[0].id,
			customers: [],
			bookings: presetBookings(PRESETS[0]),
		});
	});

	it('keeps the same state for a returning visitor', () => {
		const kv = memoryKv();
		const first = new VisitorLedger(kv, sequence(0.99));
		first.add(request);
		expect(new VisitorLedger(kv, sequence(0)).list()).toEqual(first.list());
	});

	it('adds a valid booking priced from the yard size', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		const result = ledger.add({ ...request, acres: 1 });
		expect(result).toEqual({
			ok: true,
			booking: {
				id: 'g1-1',
				name: 'Sarah Lee',
				address: '45 Oak Rd',
				town: 'Birchwood',
				start: '2026-11-17T10:00',
				end: '2026-11-17T11:30',
				durationMinutes: 90,
				priceCents: 6750,
				basis: 'Sarah Lee · 45 Oak Rd, Birchwood · 1 acre → 1.5 h × $45 = $67.50',
			},
		});
		expect(ledger.list().bookings).toContainEqual(result.ok && result.booking);
	});

	it('ignores a caller-supplied id, price, or other extra fields', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		const forged = { ...request, id: 'seed-A-1', priceCents: 1, durationMinutes: 5, note: 'x' } as BookingRequest;
		const result = ledger.add(forged);
		expect(result.ok && result.booking).toEqual({
			id: 'g1-1',
			name: 'Sarah Lee',
			address: '45 Oak Rd',
			town: 'Birchwood',
			start: '2026-11-17T10:00',
			end: '2026-11-17T11:00',
			durationMinutes: 60,
			priceCents: 4500,
			basis: 'Sarah Lee · 45 Oak Rd, Birchwood · 0.5 acre → 1 h × $45 = $45',
		});
	});

	it('hands off a yard over 1 acre instead of booking it', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		expect(ledger.add({ ...request, acres: 2 })).toEqual({ ok: false, reason: 'handoff' });
	});

	it('rejects a double booking against the preset and against an earlier booking', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		expect(ledger.add({ ...request, start: '2026-11-17T09:30' })).toEqual({ ok: false, reason: 'overlap' });
		expect(ledger.add(request).ok).toBe(true);
		expect(ledger.add({ ...request, name: 'Other', start: '2026-11-17T10:30' })).toEqual({
			ok: false,
			reason: 'overlap',
		});
		expect(ledger.list().bookings.filter((b) => b.start.startsWith('2026-11-17'))).toHaveLength(2);
	});

	it('rejects a booking the rules do not allow', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		expect(ledger.add({ ...request, start: '2026-11-17T12:00', acres: 1 })).toEqual({
			ok: false,
			reason: 'outside-hours',
		});
	});

	it('rejects a booking without a customer name', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		expect(ledger.add({ ...request, name: '  ' })).toEqual({ ok: false, reason: 'missing-name' });
	});

	it.each([
		['no name', { name: undefined }],
		['an unknown town', { town: 'Riverside' }],
		['a malformed start', { start: 'Tuesday 10am' }],
		['a non-positive size', { acres: -1 }],
	])('rejects a request with %s as invalid', (_case, patch) => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		expect(ledger.add({ ...request, ...patch } as BookingRequest)).toEqual({ ok: false, reason: 'invalid-request' });
		expect(ledger.list().bookings).toEqual(presetBookings(PRESETS[0]));
	});

	it('gives every booking a distinct id', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		ledger.add(request);
		ledger.add({ ...request, start: '2026-11-17T11:00' });
		const ids = ledger.list().bookings.map((b) => b.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('adds a customer once per phone number', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		ledger.addCustomer('+15550101');
		expect(ledger.addCustomer('+15550101')).toEqual([{ phone: '+15550101' }]);
		expect(ledger.addCustomer('+15550102')).toHaveLength(2);
	});

	it('resets to a new generation with no customers and exactly the new preset', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0, 0));
		ledger.addCustomer('+15550101');
		ledger.add(request);
		const after = ledger.reset();
		expect(after).toEqual({
			generation: 2,
			presetId: PRESETS[1].id,
			customers: [],
			bookings: presetBookings(PRESETS[1]),
		});
		expect(ledger.list()).toEqual(after);
	});

	it('never resets to the current preset', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0.5));
		for (let i = 0; i < 6; i++) {
			const before = ledger.list().presetId;
			expect(ledger.reset().presetId).not.toBe(before);
		}
	});

	it('starts ids for a new generation without reusing old ones', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		const first = ledger.add(request);
		ledger.reset();
		const second = ledger.add({ ...request, start: '2026-11-24T10:00' });
		expect(first.ok && second.ok && first.booking.id !== second.booking.id).toBe(true);
	});
});

describe('VisitorLedger.hit (per-visitor rate limit)', () => {
	const t0 = Date.UTC(2026, 10, 7);

	it('allows `limit` hits per fixed window, then refuses until the next window', () => {
		const ledger = new VisitorLedger(memoryKv());
		expect([1, 2, 3].map((i) => ledger.hit(t0 + i, 2, 60_000))).toEqual([true, true, false]);
		expect(ledger.hit(t0 + 60_000, 2, 60_000)).toBe(true);
	});

	it('is not cleared by reset', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0));
		ledger.hit(t0, 1, 60_000);
		ledger.reset();
		expect(ledger.hit(t0 + 1, 1, 60_000)).toBe(false);
	});
});
