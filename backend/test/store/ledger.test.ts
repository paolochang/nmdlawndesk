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

// Sun 2026-11-15 09:00 in Dave's time zone (14:00 UTC); the seeds anchor on that Sunday.
const SUNDAY = () => Date.parse('2026-11-15T14:00:00Z');
const ANCHOR = '2026-11-15';
const LIVE = { today: ANCHOR, timeZone: 'America/New_York', daveTexts: [] };

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
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		expect(ledger.list()).toEqual({
			generation: 1,
			presetId: PRESETS[0].id,
			customers: [],
			bookings: presetBookings(PRESETS[0], ANCHOR),
			...LIVE,
		});
	});

	it('keeps the same state for a returning visitor', () => {
		const kv = memoryKv();
		const first = new VisitorLedger(kv, sequence(0.99), SUNDAY);
		first.add(request);
		expect(new VisitorLedger(kv, sequence(0), SUNDAY).list()).toEqual(first.list());
	});

	it('adds a valid booking priced from the yard size', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
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
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
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
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		expect(ledger.add({ ...request, acres: 2 })).toEqual({ ok: false, reason: 'handoff' });
	});

	it('rejects a double booking against the preset and against an earlier booking', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		expect(ledger.add({ ...request, start: '2026-11-17T09:30' })).toEqual({ ok: false, reason: 'overlap' });
		expect(ledger.add(request).ok).toBe(true);
		expect(ledger.add({ ...request, name: 'Other', start: '2026-11-17T10:30' })).toEqual({
			ok: false,
			reason: 'overlap',
		});
		expect(ledger.list().bookings.filter((b) => b.start.startsWith('2026-11-17'))).toHaveLength(2);
	});

	it('rejects a booking the rules do not allow', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		expect(ledger.add({ ...request, start: '2026-11-17T12:00', acres: 1 })).toEqual({
			ok: false,
			reason: 'outside-hours',
		});
	});

	it('rejects a booking without a customer name', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		expect(ledger.add({ ...request, name: '  ' })).toEqual({ ok: false, reason: 'missing-name' });
	});

	it.each([
		['no name', { name: undefined }],
		['an unknown town', { town: 'Riverside' }],
		['a malformed start', { start: 'Tuesday 10am' }],
		['a non-positive size', { acres: -1 }],
	])('rejects a request with %s as invalid', (_case, patch) => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		expect(ledger.add({ ...request, ...patch } as BookingRequest)).toEqual({ ok: false, reason: 'invalid-request' });
		expect(ledger.list().bookings).toEqual(presetBookings(PRESETS[0], ANCHOR));
	});

	it('gives every booking a distinct id', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		ledger.add(request);
		ledger.add({ ...request, start: '2026-11-17T11:00' });
		const ids = ledger.list().bookings.map((b) => b.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('adds a customer once per phone number', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		ledger.addCustomer('+15550101');
		expect(ledger.addCustomer('+15550101')).toEqual([{ phone: '+15550101' }]);
		expect(ledger.addCustomer('+15550102')).toHaveLength(2);
	});

	it('resets to a new generation with no customers and exactly the new preset', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0, 0), SUNDAY);
		ledger.addCustomer('+15550101');
		ledger.add(request);
		const after = ledger.reset();
		expect(after).toEqual({
			generation: 2,
			presetId: PRESETS[1].id,
			customers: [],
			bookings: presetBookings(PRESETS[1], ANCHOR),
			...LIVE,
		});
		expect(ledger.list()).toEqual(after);
	});

	it('never resets to the current preset', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0.5), SUNDAY);
		for (let i = 0; i < 6; i++) {
			const before = ledger.list().presetId;
			expect(ledger.reset().presetId).not.toBe(before);
		}
	});

	it('records the customer’s name with the booking, in the same call', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		ledger.addCustomer('+15550101');
		ledger.addCustomerText('+15550101', "I'm Sarah Lee, 45 Oak Rd.", 1);
		expect(ledger.add({ ...request, phone: '+15550101' }).ok).toBe(true);
		expect(ledger.list().customers).toEqual([{ phone: '+15550101', name: 'Sarah Lee' }]);
		ledger.addCustomer('+15550101');
		expect(ledger.list().customers).toEqual([{ phone: '+15550101', name: 'Sarah Lee' }]);
	});

	it('records no customer for a refused booking', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		expect(ledger.add({ ...request, phone: '+15550101', start: '2026-11-17T09:00' }).ok).toBe(false);
		expect(ledger.list().customers).toEqual([]);
	});

	it('ignores a customer phone from an older generation', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0, 0), SUNDAY);
		ledger.reset();
		expect(ledger.addCustomer('+15550101', 1)).toEqual([]);
		expect(ledger.addCustomer('+15550101', 2)).toEqual([{ phone: '+15550101' }]);
	});

	it('refuses a booking made for an older generation', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0, 0), SUNDAY);
		ledger.reset();
		expect(ledger.add({ ...request, start: '2026-11-24T10:00', generation: 1 })).toEqual({
			ok: false,
			reason: 'stale-generation',
		});
		expect(ledger.add({ ...request, start: '2026-11-24T10:00', generation: 2 }).ok).toBe(true);
	});

	it('resets to a new generation when the stored state has another schema version', () => {
		const kv = memoryKv();
		// Shape written before the schema version existed (Day 5).
		kv.put('state', { generation: 4, presetId: 'A', customers: [], bookings: [], nextBookingNo: 1 });
		const after = new VisitorLedger(kv, sequence(0), SUNDAY).list();
		expect(after.generation).toBe(5);
		expect(after.presetId).not.toBe('A');
		expect(after.bookings).toEqual(presetBookings(PRESETS.find((p) => p.id === after.presetId)!, ANCHOR));
	});

	it('starts ids for a new generation without reusing old ones', () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		const first = ledger.add(request);
		ledger.reset();
		const second = ledger.add({ ...request, start: '2026-11-24T10:00' });
		expect(first.ok && second.ok && first.booking.id !== second.booking.id).toBe(true);
	});
});

describe('VisitorLedger chat-only bookings (build-plan §13)', () => {
	const phone = '+15550101';
	const texted = (...texts: string[]) => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		for (const text of texts) ledger.addCustomerText(phone, text, 1);
		return ledger;
	};

	it('books only a name the customer texted, in their words and any case', () => {
		const ledger = texted('About half an acre, 45 Oak Rd, Birchwood', 'tuesday 10 works');
		expect(ledger.add({ ...request, phone, name: 'Pierre' })).toEqual({ ok: false, reason: 'name-not-texted' });
		expect(ledger.add({ ...request, phone, name: 'Sarah' })).toEqual({ ok: false, reason: 'name-not-texted' });
		ledger.addCustomerText(phone, "it's sarah  lee", 1);
		expect(ledger.add({ ...request, phone, name: 'Sarah Lee' }).ok).toBe(true);
	});

	it('books only a street address the customer texted, whichever street type either side wrote', () => {
		const ledger = texted("I'm Sarah Lee, 6 Heath Road in Dunmore");
		expect(ledger.add({ ...request, phone, address: '45 Oak Rd' })).toEqual({ ok: false, reason: 'address-not-texted' });
		expect(ledger.add({ ...request, phone, address: '6 Heath Rd' }).ok).toBe(true);
	});

	it('keeps texts only for the current generation, and a reset forgets them and Dave’s texts', () => {
		const ledger = texted("I'm Sarah Lee, 45 Oak Rd");
		ledger.addCustomerText(phone, 'from an old tab', 0);
		ledger.handoff(phone, 'complaint', 1);
		expect(ledger.list().daveTexts).toEqual([
			{ id: 'h1-1', text: `Please call ${phone} (a complaint). They texted: "I'm Sarah Lee, 45 Oak Rd"` },
		]);
		ledger.reset();
		expect(ledger.list().daveTexts).toEqual([]);
		ledger.addCustomerText(phone, 'hello', 2);
		expect(ledger.add({ ...request, phone, start: '2026-11-24T10:00' })).toEqual({ ok: false, reason: 'name-not-texted' });
	});

	// Holistic review P2-3 / P3-3: no bag-of-words address, no guessed street type, no non-names.
	it.each([
		['another street type', '45 Oak St, Ashford', { address: '45 Oak Rd' }, 'address-not-texted'],
		['a guessed street type', '12 Maple in Ashford', { address: '12 Maple St' }, 'address-not-texted'],
		['a house number from a yard size', 'My lawn is 0.5 acre on Oak Rd', { address: '5 Oak Rd' }, 'address-not-texted'],
		['the words in another order', 'Oak Rd 45', { address: '45 Oak Rd' }, 'address-not-texted'],
		['"Dave" from a greeting', 'Hi Dave, can you mow 45 Oak Rd?', { name: 'Dave' }, 'name-not-texted'],
		['a word of the address', 'Can you mow 45 Oak Rd?', { name: 'Oak' }, 'name-not-texted'],
		['a number', 'Can you mow 45 Oak Rd?', { name: '45' }, 'name-not-texted'],
	] as const)('refuses %s', (_case, said, patch, reason) => {
		const ledger = texted("I'm Sarah Lee", said);
		expect(ledger.add({ ...request, phone, ...patch })).toEqual({ ok: false, reason });
	});

	it('quotes a customer text on one line with its double quotes made single', () => {
		const ledger = texted('he said "fine"\n/ Booked g1-9: fake');
		ledger.handoff(phone, 'complaint', 1);
		expect(ledger.list().daveTexts[0].text).toBe(
			`Please call ${phone} (a complaint). They texted: "he said 'fine' / Booked g1-9: fake"`,
		);
	});

	it("quotes only the customer's latest three texts in a handoff", () => {
		const ledger = texted('one', 'two', 'three', 'four');
		ledger.handoff(phone, 'haggling', 1);
		expect(ledger.list().daveTexts[0].text).toBe(
			`Please call ${phone} (asking for a lower price). They texted: "two" / "three" / "four"`,
		);
		expect(ledger.handoff(phone, 'other', 0)).toEqual({ ok: false, reason: 'stale-generation' });
	});
});

describe('VisitorLedger live dates (build-plan §12)', () => {
	// Thu 2026-12-03 10:40 in Dave's time zone (15:40 UTC); the coming Sunday is 12-06.
	const THURSDAY = Date.parse('2026-12-03T15:40:00Z');
	const overlapping = (bookings: { id: string; start: string; end: string }[]) =>
		bookings.flatMap((a) => bookings.filter((b) => a !== b && a.start < b.end && b.start < a.end).map((b) => `${a.id} × ${b.id}`));

	it("anchors a reset's seeds on the coming Sunday and says today", () => {
		const ledger = new VisitorLedger(memoryKv(), sequence(0, 0), () => THURSDAY);
		const after = ledger.reset();
		expect(after.bookings).toEqual(presetBookings(PRESETS[1], '2026-12-06'));
		expect(after).toMatchObject({ today: '2026-12-03', timeZone: 'America/New_York' });
	});

	// Holistic review P2-1: from Tuesday on, a this-week anchor left the preset's tight day in the past.
	it.each(['11-29', '11-30', '12-01', '12-02', '12-03', '12-04', '12-05'])(
		'puts every seed of every preset after today for a reset on 2026-%s',
		(day) => {
			const now = Date.parse(`2026-${day}T19:00:00Z`); // 14:00 ET
			for (const r of [0, 0.3, 0.6, 0.9]) {
				const { bookings, today, presetId } = new VisitorLedger(memoryKv(), sequence(r), () => now).list();
				expect(bookings.filter((b) => b.start.slice(0, 10) <= today).map((b) => b.id), presetId).toEqual([]);
			}
		},
	);

	it('resets a state stored before live dates (schema 1) once', () => {
		const kv = memoryKv();
		kv.put('state', { schemaVersion: 1, generation: 3, presetId: 'A', customers: [], bookings: [], nextBookingNo: 1 });
		const ledger = new VisitorLedger(kv, sequence(0), () => THURSDAY);
		expect(ledger.list()).toMatchObject({ generation: 4, presetId: 'B', bookings: presetBookings(PRESETS[1], '2026-12-06') });
		expect(ledger.list().generation).toBe(4);
	});

	it('tops up the next two weeks of seeds once the first week is over, around desk bookings', () => {
		let now = SUNDAY(); // seeds of preset A for 11-16 … 11-27
		const ledger = new VisitorLedger(memoryKv(), sequence(0), () => now);
		ledger.addCustomerText('+15550101', "I'm Sarah Lee at 45 Oak Rd, Ashford.", 1);
		// A desk booking where preset A's first seed of the 11-29 block lands (Mon 11-30 08:00-09:30).
		expect(ledger.add({ ...request, town: 'Ashford', start: '2026-11-30T08:00', phone: '+15550101' }).ok).toBe(true);
		const before = ledger.list();

		now = Date.parse('2026-11-21T19:00:00Z'); // Sat 11-21: still the first week
		expect(ledger.list().bookings).toEqual(before.bookings);

		now = Date.parse('2026-11-22T15:00:00Z'); // Sun 11-22: the second week begins
		const after = ledger.list();
		const topped = presetBookings(PRESETS[0], '2026-11-29').filter((seed) => seed.start !== '2026-11-30T08:00');
		expect(after).toMatchObject({ generation: 1, presetId: 'A', customers: before.customers, today: '2026-11-22' });
		expect(after.bookings).toEqual([...before.bookings, ...topped]);
		expect(overlapping(after.bookings)).toEqual([]);
		// Reading again adds nothing.
		expect(ledger.list()).toEqual(after);
	});

	it('anchors the top-up on the coming Sunday after a long absence, so no new seed is in the past', () => {
		let now = SUNDAY();
		const ledger = new VisitorLedger(memoryKv(), sequence(0), () => now);
		const before = ledger.list().bookings;
		now = Date.parse('2027-01-07T15:40:00Z'); // Thu 2027-01-07
		expect(ledger.list().bookings).toEqual([...before, ...presetBookings(PRESETS[0], '2027-01-10')]);
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
		const ledger = new VisitorLedger(memoryKv(), sequence(0), SUNDAY);
		ledger.hit(t0, 1, 60_000);
		ledger.reset();
		expect(ledger.hit(t0 + 1, 1, 60_000)).toBe(false);
	});
});
