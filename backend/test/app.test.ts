import { beforeEach, describe, expect, it, vi } from 'vitest';
import { allowEntry, visitorIdFor } from '../src/auth/identity.ts';
import { WRITE_RATE_LIMIT } from '../src/auth/middleware.ts';

// The real src/app.ts, with only its Cloudflare bindings faked: proves the auth
// guard is mounted ahead of the agent and calendar routes in production wiring,
// not only in the copy test/auth/middleware.test.ts builds.
const SECRET = 'test-secret';
const ACCESS_CODE = 'mow-2026';
const hits: [string, number, number][] = [];
const env = {
	SECRET,
	ACCESS_CODE,
	ALLOWLIST: { get: async (key: string) => (key === (await allowEntry(SECRET, 'gang')) ? '1' : null) },
	VISITOR_STORE: {
		getByName: (name: string) => ({
			hit: async (limit: number, windowMs: number) => (hits.push([name, limit, windowMs]), false),
		}),
	},
};
vi.mock('cloudflare:workers', () => ({ env, DurableObject: class {} }));
const { default: app } = await import('../src/app.ts');

describe('src/app.ts wiring', () => {
	beforeEach(() => void (hits.length = 0));

	it('guards the agent and calendar routes with 401 before they run', async () => {
		const id = await visitorIdFor(SECRET, 'gang');
		expect((await app.request(`/api/agents/lawn-desk/${id}:1:dave`)).status).toBe(401);
		expect((await app.request(`/api/calendar/${id}`)).status).toBe(401);
	});

	it('guards Google connect but leaves the Google callback public (it trusts only the signed state)', async () => {
		const id = await visitorIdFor(SECRET, 'gang');
		expect((await app.request(`/api/calendar/${id}/google/connect`, { method: 'POST' })).status).toBe(401);
		const callback = await app.request('/api/google/callback?code=x&state=forged');
		expect(callback.status).toBe(302);
		expect(callback.headers.get('location')).toBe('/?google=failed&reason=state');
	});

	it('limits writes through the visitor’s own store with WRITE_RATE_LIMIT', async () => {
		const res = await app.request('/api/auth', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ accessCode: ACCESS_CODE, nickname: 'gang' }),
		});
		const { visitorId, token } = (await res.json()) as { visitorId: string; token: string };
		const post = await app.request(`/api/calendar/${visitorId}/reset`, {
			method: 'POST',
			headers: { authorization: `Bearer ${token}` },
		});
		expect(post.status).toBe(429);
		expect(hits).toEqual([[`visitor-${visitorId}`, WRITE_RATE_LIMIT.limit, WRITE_RATE_LIMIT.windowMs]]);
	});
});
