import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeGoogle, memoryKv } from './fake-google.ts';

// The real VisitorStore Durable Object with a fake ctx: proves the store itself starts
// the syncs, moves the window on Reset all, and reports `google` in its snapshots, not
// only GoogleLink driven by hand (review round 1).
vi.mock('cloudflare:workers', () => ({
	DurableObject: class {
		constructor(
			readonly ctx: unknown,
			readonly env: unknown,
		) {}
	},
}));
const { VisitorStore } = await import('../../src/store/visitor-store.ts');

const NOW = Date.parse('2026-12-03T15:40:00Z'); // Thu 10:40 in New York

function store() {
	const google = fakeGoogle();
	vi.stubGlobal('fetch', google.fetcher);
	vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
	const pending: Promise<unknown>[] = [];
	const ctx = { storage: { kv: memoryKv() }, waitUntil: (p: Promise<unknown>) => void pending.push(p) };
	const env = { SECRET: 'test-secret', GOOGLE_CLIENT_ID: 'client-1', GOOGLE_CLIENT_SECRET: 'shh' };
	const visitor = new VisitorStore(ctx as never, env as never);
	const settle = async () => {
		while (pending.length) await pending.shift();
	};
	const events = () => [...google.calendars.values()].flatMap((c) => [...c.values()]);
	return { google, visitor, settle, events };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('VisitorStore with Google Calendar (build-plan §14)', () => {
	it('connect reports in the snapshot, a desk booking and Reset all re-sync, Disconnect clears', async () => {
		const { visitor, settle, events } = store();
		expect(visitor.list().google).toEqual({ connected: false });

		expect(await visitor.googleConnect('good-code', 'http://localhost:5180/api/google/callback')).toEqual({ ok: true });
		expect(visitor.list().google).toMatchObject({ connected: true, window: { from: '2026-12-03', to: '2026-12-16' } });
		await settle();
		const seeded = events().length;
		expect(seeded).toBeGreaterThan(0);

		const generation = visitor.list().generation;
		visitor.addCustomerText('+15550101', 'Hi, I am Mia Park at 6 Heath Road, Ashford, half an acre', generation);
		expect(visitor.add({ name: 'Mia Park', address: '6 Heath Rd', town: 'Ashford', start: '2026-12-14T08:00', acres: 0.5, generation, phone: '+15550101' }).ok).toBe(true);
		await settle();
		expect(events().some((e) => e.summary === 'Mia Park · Ashford')).toBe(true);

		const next = visitor.reset();
		expect(next.google?.connected).toBe(true);
		await settle();
		expect(events().some((e) => e.summary === 'Mia Park · Ashford')).toBe(false);
		expect(visitor.list().google).toMatchObject({ connected: true, lastSync: 'ok' });

		expect(await visitor.googleDisconnect()).toEqual({ calendarRemoved: true });
		expect(visitor.list().google).toEqual({ connected: false });
		expect(events()).toEqual([]);
	});

	it('a failed code exchange answers ok: false and stays disconnected', async () => {
		const { visitor } = store();
		expect(await visitor.googleConnect('bad-code', 'http://localhost:5180/api/google/callback')).toEqual({ ok: false });
		expect(visitor.list().google).toEqual({ connected: false });
	});
});
