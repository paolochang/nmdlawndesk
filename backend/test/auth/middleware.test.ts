import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { allowEntry, visitorIdFor } from '../../src/auth/identity.ts';
import { type AuthEnv, mountAuth } from '../../src/auth/middleware.ts';
import { TOKEN_TTL_SECONDS } from '../../src/auth/token.ts';
import { type KvStorage, VisitorLedger } from '../../src/store/ledger.ts';
import { storeRoutes } from '../../src/store/routes.ts';

const SECRET = 'test-secret';
const ACCESS_CODE = 'mow-2026';
const LIMIT = 3;

// Mirrors src/app.ts: /api base path, auth mounted before the agent and store routes.
async function setup(env: Partial<AuthEnv> = {}) {
	const entries = new Set(await Promise.all(['gang', 'mina'].map((n) => allowEntry(SECRET, n))));
	const clock = { now: Date.UTC(2026, 10, 7) };
	const hits = new Map<string, number>();
	const ledgers = new Map<string, VisitorLedger>();
	const app = new Hono().basePath('/api');
	app.get('/health', (c) => c.json({ ok: true }));
	mountAuth(app, {
		env: () => ({
			SECRET,
			ACCESS_CODE,
			ALLOWLIST: { get: async (key) => (entries.has(key) ? '1' : null) },
			...env,
		}),
		limit: async (visitorId) => {
			const n = (hits.get(visitorId) ?? 0) + 1;
			hits.set(visitorId, n);
			return n <= LIMIT;
		},
		now: () => clock.now,
	});
	const agent = new Hono();
	agent.all('/*', (c) => c.json({ agent: c.req.path }));
	app.route('/agents/lawn-desk', agent);
	app.route(
		'/',
		storeRoutes((visitorId) => {
			if (!ledgers.has(visitorId)) {
				const map = new Map<string, unknown>();
				const kv: KvStorage = { get: <T>(k: string) => map.get(k) as T, put: (k, v) => void map.set(k, v) };
				ledgers.set(visitorId, new VisitorLedger(kv, () => 0, () => Date.parse('2026-11-15T14:00:00Z')));
			}
			return ledgers.get(visitorId)!;
		}),
	);
	const signIn = (nickname: string, accessCode = ACCESS_CODE) =>
		app.request('/api/auth', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ accessCode, nickname }),
		});
	const session = async (nickname: string) => {
		const body = (await (await signIn(nickname)).json()) as { token: string; visitorId: string };
		return { ...body, headers: { authorization: `Bearer ${body.token}` } };
	};
	return { app, clock, signIn, session };
}

describe('POST /api/auth', () => {
	it('signs in an allowlisted nickname and returns its visitorId and a token', async () => {
		const { signIn } = await setup();
		const res = await signIn(' Gang ');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body).toMatchObject({ visitorId: await visitorIdFor(SECRET, 'gang'), token: expect.any(String) });
	});

	it('gives a returning visitor the same visitorId and the same bookings', async () => {
		const { app, session } = await setup();
		const first = await session('GANG');
		await app.request(`/api/calendar/${first.visitorId}/reset`, { method: 'POST', headers: first.headers });
		const again = await session('gang');
		expect(again.visitorId).toBe(first.visitorId);
		const res = await app.request(`/api/calendar/${again.visitorId}`, { headers: again.headers });
		expect(await res.json()).toMatchObject({ generation: 2 });
	});

	it.each([
		['a nickname not in the allowlist', 'stranger', ACCESS_CODE],
		['a wrong access code', 'gang', 'mow-2025'],
		['an empty access code', 'gang', ''],
	])('refuses %s with 401', async (_, nickname, code) => {
		const { signIn } = await setup();
		const res = await signIn(nickname, code);
		expect(res.status).toBe(401);
		expect(await res.json()).not.toHaveProperty('token');
	});

	it('fails closed with 500 when SECRET or ACCESS_CODE is not configured', async () => {
		expect((await (await setup({ SECRET: undefined })).signIn('gang')).status).toBe(500);
		expect((await (await setup({ ACCESS_CODE: '' })).signIn('gang')).status).toBe(500);
	});

	it.each([
		['a non-JSON body', 'nickname=gang'],
		['a non-string nickname', JSON.stringify({ accessCode: ACCESS_CODE, nickname: 42 })],
	])('answers 400 to %s', async (_, body) => {
		const { app } = await setup();
		const res = await app.request('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
		expect(res.status).toBe(400);
	});
});

describe('auth middleware', () => {
	it.each([
		['GET', (v: string) => `/api/calendar/${v}`],
		['POST', (v: string) => `/api/calendar/${v}/reset`],
		['POST', (v: string) => `/api/agents/lawn-desk/${v}:1:+15550101`],
		['GET', (v: string) => `/api/agents/lawn-desk/${encodeURIComponent(`${v}:1:dave`)}`],
	])('lets the owner through: %s', async (method, path) => {
		const { app, session } = await setup();
		const gang = await session('gang');
		const res = await app.request(path(gang.visitorId), { method, headers: gang.headers });
		expect(res.status).toBe(200);
	});

	it.each([
		['no token', undefined],
		['a malformed token', 'Bearer nope'],
		['a non-bearer scheme', 'Basic Z2FuZw=='],
	])('answers 401 to %s', async (_, authorization) => {
		const { app, session } = await setup();
		const { visitorId } = await session('gang');
		const headers: Record<string, string> = authorization ? { authorization } : {};
		expect((await app.request(`/api/calendar/${visitorId}`, { headers })).status).toBe(401);
		expect((await app.request(`/api/agents/lawn-desk/${visitorId}:1:dave`, { headers })).status).toBe(401);
	});

	it('answers 401 once the token has expired', async () => {
		const { app, clock, session } = await setup();
		const gang = await session('gang');
		clock.now += TOKEN_TTL_SECONDS * 1000;
		const res = await app.request(`/api/calendar/${gang.visitorId}`, { headers: gang.headers });
		expect(res.status).toBe(401);
	});

	it.each([
		['GET', (v: string) => `/api/calendar/${v}`],
		['POST', (v: string) => `/api/calendar/${v}/reset`],
		['POST', (v: string) => `/api/agents/lawn-desk/${v}:1:+15550101`],
		['GET', (v: string) => `/api/agents/lawn-desk/${v}:1:dave`],
		['POST', (v: string) => `/api/agents/lawn-desk/${v}:1:dave/abort`],
		['GET', (v: string) => `/api/agents/lawn-desk/${v}`],
		['GET', (v: string) => `/api/agents/lawn-desk/${v}%3A1%3Adave`],
		['GET', () => '/api/agents/lawn-desk/my-first-chat'],
	])('answers 403 to another visitor’s %s path', async (method, path) => {
		const { app, session } = await setup();
		const gang = await session('gang');
		const mina = await session('mina');
		const res = await app.request(path(mina.visitorId), { method, headers: gang.headers });
		expect(res.status).toBe(403);
	});

	it('answers 429 when the visitor goes over the write limit, per visitor', async () => {
		const { app, session } = await setup();
		const gang = await session('gang');
		const mina = await session('mina');
		const send = (s: typeof gang) =>
			app.request(`/api/agents/lawn-desk/${s.visitorId}:1:+15550101`, { method: 'POST', headers: s.headers });
		for (let i = 0; i < LIMIT; i++) expect((await send(gang)).status).toBe(200);
		expect((await send(gang)).status).toBe(429);
		expect((await send(mina)).status).toBe(200);
		// Reads do not count against the limit.
		expect((await app.request(`/api/calendar/${gang.visitorId}`, { headers: gang.headers })).status).toBe(200);
	});

	it('lets a visitor at the write limit still abort a running turn, without counting it', async () => {
		const { app, session } = await setup();
		const gang = await session('gang');
		const path = `/api/agents/lawn-desk/${gang.visitorId}:1:+15550101`;
		const post = (suffix = '') => app.request(path + suffix, { method: 'POST', headers: gang.headers });
		for (let i = 0; i < LIMIT; i++) expect((await post()).status).toBe(200);
		expect((await post('/abort')).status).toBe(200);
		expect((await post()).status).toBe(429);
		expect((await post('/abort')).status).toBe(200);
	});

	it('fails closed with 500 on protected routes when SECRET is not configured', async () => {
		const { app, session } = await setup();
		const { visitorId, headers } = await session('gang');
		const broken = await setup({ SECRET: undefined });
		expect((await broken.app.request(`/api/calendar/${visitorId}`, { headers })).status).toBe(500);
		expect((await broken.app.request(`/api/agents/lawn-desk/${visitorId}:1:dave`, { headers })).status).toBe(500);
		expect((await app.request(`/api/calendar/${visitorId}`, { headers })).status).toBe(200);
	});

	it('keeps /api/health and /api/config public', async () => {
		const { app } = await setup();
		expect((await app.request('/api/health')).status).toBe(200);
		expect((await app.request('/api/config')).status).toBe(200);
	});
});
