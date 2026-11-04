import { describe, expect, it } from 'vitest';
import { RULES } from '../../src/domain/rules.ts';
import { type KvStorage, VisitorLedger } from '../../src/store/ledger.ts';
import { storeRoutes } from '../../src/store/routes.ts';

// Stands in for the Durable Object namespace: one ledger per visitor id.
function fakeNamespace() {
	const ledgers = new Map<string, VisitorLedger>();
	const requested: string[] = [];
	const getStore = (visitorId: string) => {
		requested.push(visitorId);
		if (!ledgers.has(visitorId)) {
			const map = new Map<string, unknown>();
			const kv: KvStorage = { get: <T>(k: string) => map.get(k) as T, put: (k, v) => void map.set(k, v) };
			ledgers.set(visitorId, new VisitorLedger(kv, () => 0));
		}
		return ledgers.get(visitorId)!;
	};
	return { app: storeRoutes(getStore), requested };
}

describe('store routes', () => {
	it('GET /config returns the business rules', async () => {
		const res = await fakeNamespace().app.request('/config');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual(RULES);
	});

	it('GET /calendar/:visitorId returns that visitor’s calendar', async () => {
		const { app, requested } = fakeNamespace();
		const res = await app.request('/calendar/v_abc-123');
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ generation: 1, presetId: 'A', customers: [] });
		expect(requested).toEqual(['v_abc-123']);
	});

	it('POST /calendar/:visitorId/reset starts a new generation for that visitor only', async () => {
		const { app } = fakeNamespace();
		const res = await app.request('/calendar/alice/reset', { method: 'POST' });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ generation: 2, presetId: 'B' });
		expect(await (await app.request('/calendar/bob')).json()).toMatchObject({ generation: 1 });
	});

	it.each(['a.b', 'a%20b', 'x'.repeat(65)])('rejects visitor id %s without touching a store', async (id) => {
		const { app, requested } = fakeNamespace();
		const res = await app.request(`/calendar/${id}`);
		expect(res.status).toBe(400);
		expect(requested).toEqual([]);
	});

	it('does not reset on GET', async () => {
		const res = await fakeNamespace().app.request('/calendar/alice/reset');
		expect(res.status).toBe(404);
	});
});
