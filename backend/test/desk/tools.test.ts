import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { PRESETS, presetBookings } from '../../src/domain/presets.ts';
import { type DaveAlert, type DeskStore, deskTools, HANDOFF_REPLY } from '../../src/desk/tools.ts';
import { type KvStorage, VisitorLedger } from '../../src/store/ledger.ts';

// A ledger on an in-memory KV stands in for the Durable Object. Random 0 picks
// preset A: Mon 2026-11-16 is full, Tue 17 09:00-10:00 and Thu 19 10:00-11:30 are booked.
function setup(generation = 1) {
	const map = new Map<string, unknown>();
	const kv: KvStorage = { get: <T>(k: string) => structuredClone(map.get(k)) as T, put: (k, v) => void map.set(k, structuredClone(v)) };
	const ledger = new VisitorLedger(kv, () => 0);
	const store: DeskStore = {
		list: async () => ledger.list(),
		add: async (request) => ledger.add(request),
		addCustomer: async (phone, generation) => ledger.addCustomer(phone, generation),
	};
	const alerts: DaveAlert[] = [];
	const tools = deskTools({
		conversation: { kind: 'customer', visitorId: 'v1', generation, phone: '+15550101' },
		store,
		alertDave: async (alert) => void alerts.push(alert),
	});
	const call = async (name: string, data: unknown) => {
		const tool = tools.find((t) => t.name === name);
		if (!tool) throw new Error(`no tool ${name}`);
		// The runtime parses model arguments with the input schema before `run`.
		data = v.parse(tool.input!, data);
		const result = await tool.run({ data, toolCallId: 'call-1', log: console } as never);
		return typeof result === 'object' && result && 'output' in result ? result.output : result;
	};
	return { ledger, alerts, call };
}

describe('desk tools', () => {
	it('offers the four build-plan tools', () => {
		const names = deskTools({} as never).map((t) => t.name);
		expect(names).toEqual(['quoteJob', 'findSlots', 'bookSlot', 'handoffToDave']);
	});

	it('requires the yard size key on every sized tool; null means unknown', () => {
		const tools = deskTools({} as never);
		const input = (name: string) => tools.find((t) => t.name === name)!.input!;
		const booking = { name: 'Sarah Lee', address: '45 Oak Rd', town: 'Birchwood', start: '2026-11-17T10:00' };
		expect(v.safeParse(input('quoteJob'), {}).success).toBe(false);
		expect(v.safeParse(input('findSlots'), { town: 'Ashford' }).success).toBe(false);
		expect(v.safeParse(input('bookSlot'), booking).success).toBe(false);
		expect(v.safeParse(input('bookSlot'), { ...booking, acres: null }).success).toBe(true);
	});

	describe('quoteJob', () => {
		it.each([
			[0.5, '$45', '1 h'],
			[1, '$67.50', '1.5 h'],
		])('quotes %s acre at %s for %s and says the price may change on site', async (acres, price, duration) => {
			const output = await setup().call('quoteJob', { acres });
			expect(output).toMatchObject({ price, duration });
			expect(JSON.stringify(output)).toContain('may change on site');
		});

		it('quotes the 1-hour rate for an unknown size, adjusted on site', async () => {
			const output = await setup().call('quoteJob', { acres: null });
			expect(output).toMatchObject({ price: '$45', duration: '1 h' });
			expect(JSON.stringify(output)).toContain('adjusted on site');
		});

		it('says to hand off a yard over 1 acre', async () => {
			expect(await setup().call('quoteJob', { acres: 2 })).toMatchObject({ handoff: 'yard-over-1-acre' });
		});
	});

	describe('findSlots', () => {
		it('offers two open slots on the town’s weekdays from the demo date, around existing bookings', async () => {
			const output = await setup().call('findSlots', { town: 'ashford', acres: 1 });
			expect(output).toMatchObject({
				town: 'Ashford',
				slots: [
					{ start: '2026-11-19T08:00', label: 'Thu Nov 19, 8:00-9:30 AM' },
					{ start: '2026-11-23T08:00', label: 'Mon Nov 23, 8:00-9:30 AM' },
				],
			});
		});

		it('searches from a later date when asked', async () => {
			const output = (await setup().call('findSlots', { town: 'Dunmore', acres: 0.5, from: '2026-11-20' })) as {
				slots: { start: string }[];
			};
			expect(output.slots.map((s) => s.start)).toEqual(['2026-11-20T08:00', '2026-11-24T08:00']);
		});

		it('says to hand off a town outside the service area', async () => {
			expect(await setup().call('findSlots', { town: 'Riverside', acres: 0.5 })).toMatchObject({
				handoff: 'out-of-area',
			});
		});

		it('says to hand off a yard over 1 acre', async () => {
			expect(await setup().call('findSlots', { town: 'Ashford', acres: 3 })).toMatchObject({
				handoff: 'yard-over-1-acre',
			});
		});
	});

	describe('bookSlot', () => {
		const booking = { name: 'Sarah Lee', address: '45 Oak Rd', town: 'Birchwood', start: '2026-11-17T10:00', acres: 0.5 };

		it('books the slot, priced by the store, and records the customer’s name', async () => {
			const { call, ledger } = setup();
			const output = await call('bookSlot', booking);
			expect(output).toMatchObject({
				ok: true,
				bookingId: 'g1-1',
				when: 'Tue Nov 17, 10:00-11:00 AM',
				duration: '1 h',
				price: '$45',
				basis: 'Sarah Lee · 45 Oak Rd, Birchwood · 0.5 acre → 1 h × $45 = $45',
			});
			expect(ledger.list().customers).toEqual([{ phone: '+15550101', name: 'Sarah Lee' }]);
		});

		it('returns the rejection reason for a taken slot and books nothing', async () => {
			const { call, ledger } = setup();
			const output = await call('bookSlot', { ...booking, start: '2026-11-17T09:00' });
			expect(output).toMatchObject({ ok: false, reason: 'overlap' });
			expect(ledger.list().bookings).toEqual(presetBookings(PRESETS[0]));
		});

		it('refuses a booking without a name', async () => {
			expect(await setup().call('bookSlot', { ...booking, name: ' ' })).toMatchObject({
				ok: false,
				reason: 'missing-name',
			});
		});

		it('refuses a booking from a conversation of an older generation', async () => {
			const { call, ledger } = setup(1);
			ledger.reset();
			expect(await call('bookSlot', { ...booking, start: '2026-11-24T10:00' })).toMatchObject({
				ok: false,
				reason: 'stale-generation',
			});
		});
	});

	describe('handoffToDave', () => {
		it('alerts Dave with the reason, details, and customer phone, and gives the customer reply', async () => {
			const { call, alerts } = setup();
			const output = await call('handoffToDave', { reason: 'yard-over-1-acre', details: 'Ann, 9 Hill Rd, Ashford, 2 acres' });
			expect(alerts).toEqual([
				{ reason: 'yard-over-1-acre', details: 'Ann, 9 Hill Rd, Ashford, 2 acres', customerPhone: '+15550101' },
			]);
			expect(output).toEqual({ ok: true, reply: HANDOFF_REPLY });
		});
	});
});
