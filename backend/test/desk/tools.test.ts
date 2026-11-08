import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { PRESETS, presetBookings } from '../../src/domain/presets.ts';
import { type DeskStore, deskTools, handoffReply } from '../../src/desk/tools.ts';
import { type KvStorage, VisitorLedger } from '../../src/store/ledger.ts';

// A ledger on an in-memory KV stands in for the Durable Object. The clock is Sun
// 2026-11-15 09:00 in Dave's time zone (14:00 UTC). Random 0 picks preset A:
// Mon 2026-11-16 is full, Tue 17 09:00-10:00 and Thu 19 10:00-11:30 are booked.
const SUNDAY = () => Date.parse('2026-11-15T14:00:00Z');

// The customer's texts so far (build-plan §13): bookings use only a texted name and street.
const TEXTS = ['Can you mow half an acre at 45 Oak Rd, Birchwood?', "I'm Sarah Lee."];

function setup(generation = 1, clock = SUNDAY, texts = TEXTS) {
	const map = new Map<string, unknown>();
	const kv: KvStorage = { get: <T>(k: string) => structuredClone(map.get(k)) as T, put: (k, v) => void map.set(k, structuredClone(v)) };
	const ledger = new VisitorLedger(kv, () => 0, clock);
	const store: DeskStore = {
		list: async () => ledger.list(),
		add: async (request) => ledger.add(request),
		addCustomer: async (phone, generation) => ledger.addCustomer(phone, generation),
		handoff: async (phone, reason, generation) => ledger.handoff(phone, reason, generation),
	};
	for (const text of texts) ledger.addCustomerText('+15550101', text, 1);
	const tools = deskTools({
		conversation: { kind: 'customer', visitorId: 'v1', generation, phone: '+15550101' },
		store,
		clock,
	});
	const call = async (name: string, data: unknown) => {
		const tool = tools.find((t) => t.name === name);
		if (!tool) throw new Error(`no tool ${name}`);
		// The runtime parses model arguments with the input schema before `run`.
		data = v.parse(tool.input!, data);
		const result = await tool.run({ data, toolCallId: 'call-1', log: console } as never);
		return typeof result === 'object' && result && 'output' in result ? result.output : result;
	};
	const daveTexts = () => ledger.list().daveTexts.map((t) => t.text);
	return { ledger, daveTexts, call };
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

		it('does not ask for a second handoff of an issue already handed off', async () => {
			const { next } = (await setup().call('quoteJob', { acres: 2 })) as { next: string };
			expect(next).toMatch(/^If this issue is not handed off yet, call handoffToDave/);
			expect(next).toContain('Otherwise do not hand it off again');
		});
	});

	describe('findSlots', () => {
		it('offers two open slots on the town’s weekdays from today, around existing bookings', async () => {
			const output = await setup().call('findSlots', { town: 'ashford', acres: 1 });
			expect(output).toMatchObject({
				town: 'Ashford',
				slots: [
					{ start: '2026-11-19T08:00', label: 'Thu Nov 19, 8:00-9:30 AM' },
					{ start: '2026-11-23T08:00', label: 'Mon Nov 23, 8:00-9:30 AM' },
				],
			});
		});

		it("searches from the clock's today in Dave's time zone and names it in the tool text (build-plan §12)", async () => {
			// Thu 2026-12-03 10:40 ET: preset A's seeds start Sun 12-06, so Mon 12-07 is full.
			const thursday = () => Date.parse('2026-12-03T15:40:00Z');
			const { call } = setup(1, thursday);
			const output = (await call('findSlots', { town: 'Ashford', acres: 0.5 })) as { slots: { start: string }[] };
			expect(output.slots.map((s) => s.start)).toEqual(['2026-12-03T12:00', '2026-12-10T08:00']);
			const tool = deskTools({ clock: thursday } as never).find((t) => t.name === 'findSlots')!;
			expect(JSON.stringify(tool.input)).toContain('Omit to search from today (2026-12-03)');
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

		it("texts Dave the new booking from the store's template: who, when, where, and the price", async () => {
			const { call, daveTexts } = setup();
			await call('bookSlot', booking);
			expect(daveTexts()).toEqual([
				'Booked g1-1: Sarah Lee, Tue Nov 17, 10:00-11:00 AM, 45 Oak Rd, Birchwood. $45 (1 h). Phone +15550101.',
			]);
		});

		// Owner E2E of PR 8: the desk booked under "Pierre", a name the customer never texted.
		it('books nothing under a name the customer never texted, and says to ask for it', async () => {
			const { call, ledger, daveTexts } = setup(1, SUNDAY, ['About half an acre, 45 Oak Rd, Birchwood', 'Tuesday 10 AM works']);
			const output = (await call('bookSlot', { ...booking, name: 'Pierre' })) as { reason: string; next: string };
			expect(output).toMatchObject({ ok: false, reason: 'name-not-texted' });
			expect(output.next).toContain('Ask for their name');
			expect(ledger.list().bookings).toEqual(presetBookings(PRESETS[0], '2026-11-15'));
			expect(daveTexts()).toEqual([]);
		});

		it('returns the rejection reason for a taken slot and books nothing', async () => {
			const { call, ledger, daveTexts } = setup();
			const output = await call('bookSlot', { ...booking, start: '2026-11-17T09:00' });
			expect(output).toMatchObject({ ok: false, reason: 'overlap' });
			expect(ledger.list().bookings).toEqual(presetBookings(PRESETS[0], '2026-11-15'));
			expect(daveTexts()).toEqual([]);
		});

		it('refuses a booking without a name', async () => {
			expect(await setup().call('bookSlot', { ...booking, name: ' ' })).toMatchObject({
				ok: false,
				reason: 'missing-name',
			});
		});

		// Holistic review P2-2: a same-day offer can pass the notice before the customer picks it.
		it('tells the model to search again when an offered time became too soon', async () => {
			let now = Date.parse('2026-12-03T15:59:00Z'); // Thu 10:59 ET: earliest start 11:59
			const { call } = setup(1, () => now);
			const offered = (await call('findSlots', { town: 'Ashford', acres: 0.5 })) as { slots: { start: string }[] };
			expect(offered.slots[0].start).toBe('2026-12-03T12:00');
			now = Date.parse('2026-12-03T16:01:00Z'); // 11:01 ET: 12:00 is now inside the notice
			const output = await call('bookSlot', { ...booking, town: 'Ashford', start: '2026-12-03T12:00' });
			expect(output).toMatchObject({ ok: false, reason: 'past' });
			expect((output as { next: string }).next).toContain('Call findSlots again');
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
		it("texts Dave the reason and the customer's own texts, and gives the customer reply", async () => {
			const { call, daveTexts } = setup(1, SUNDAY, ['How much for my 2 acre lot at 9 Hill Rd, Ashford?']);
			const output = await call('handoffToDave', { reason: 'yard-over-1-acre' });
			expect(daveTexts()).toEqual([
				'Please call +15550101 (yard over 1 acre). They texted: "How much for my 2 acre lot at 9 Hill Rd, Ashford?"',
			]);
			expect(output).toMatchObject({ ok: true, reply: handoffReply('yard-over-1-acre') });
		});

		it('refuses a handoff from a conversation of an older generation', async () => {
			const { call, ledger, daveTexts } = setup(1);
			ledger.reset();
			expect(await call('handoffToDave', { reason: 'complaint' })).toMatchObject({ ok: false, reason: 'stale-generation' });
			expect(daveTexts()).toEqual([]);
		});

		it('tells the customer why the desk cannot take it, then that Dave will contact them', () => {
			expect(handoffReply('out-of-area')).toBe(
				"Sorry, Dave doesn't work in your area; he only mows in Ashford, Clearwater, Birchwood, and Dunmore. I've passed your request to Dave, and he will contact you directly to talk it over.",
			);
			expect(handoffReply('yard-over-1-acre')).toBe(
				"Sorry, I can't book yards over 1 acre; Dave prices those himself. I've asked Dave to contact you directly to talk it over.",
			);
			for (const reason of ['complaint', 'refund', 'haggling', 'other'] as const) {
				expect(handoffReply(reason)).toMatch(/contact you directly/);
				expect(handoffReply(reason)).not.toBe('Dave will contact you directly.');
			}
		});

		it('says to send the reply once and keep answering, without handing off again', async () => {
			const output = (await setup().call('handoffToDave', { reason: 'out-of-area' })) as {
				next?: string;
			};
			expect(output.next).toMatch(/once/);
			expect(output.next).toMatch(/keep answering/);
			expect(output.next).toMatch(/do not call handoffToDave again/i);
		});

		it('tells haggling apart from a price question', () => {
			const tool = deskTools({} as never).find((t) => t.name === 'handoffToDave')!;
			expect(tool.description).toContain('Asking what a job costs is not haggling');
		});
	});
});
