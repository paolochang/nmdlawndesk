import { describe, expect, it } from 'vitest';
import { GoogleLink } from '../../src/google/link.ts';
import { GOOGLE_SCOPE, signState, STATE_TTL_MS, verifyState } from '../../src/google/oauth.ts';
import { googleRoutes, type GoogleStoreApi } from '../../src/google/routes.ts';
import { VisitorLedger } from '../../src/store/ledger.ts';
import { fakeGoogle, memoryKv, REFRESH_TOKEN } from './fake-google.ts';

const SECRET = 'test-secret';
const NOW = Date.parse('2026-12-03T15:40:00Z'); // Thu 10:40 in New York
const VISITOR = 'v_abc-123';

function routes() {
	const connects: [string, string, string][] = [];
	const store = (visitorId: string): GoogleStoreApi => ({
		list: () => ({ today: '2026-12-03' }),
		googleConnect: (code, redirectUri) => (connects.push([visitorId, code, redirectUri]), { ok: true }),
		googleDisconnect: () => ({ calendarRemoved: true }),
	});
	const app = googleRoutes({ getStore: store, env: () => ({ SECRET, GOOGLE_CLIENT_ID: 'client-1', GOOGLE_CLIENT_SECRET: 'shh' }), now: () => NOW });
	return { app, connects };
}

describe('Google connect and callback (build-plan §14)', () => {
	it('connect returns a consent URL with only calendar.app.created, a signed state, and the two-week window', async () => {
		const res = await routes().app.request(`http://localhost:5180/calendar/${VISITOR}/google/connect`, { method: 'POST' });
		expect(res.status).toBe(200);
		const { url, window } = (await res.json()) as { url: string; window: unknown };
		const consent = new URL(url);
		expect(consent.origin + consent.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
		expect(consent.searchParams.get('scope')).toBe(GOOGLE_SCOPE);
		expect(consent.searchParams.get('redirect_uri')).toBe('http://localhost:5180/api/google/callback');
		expect((await verifyState(SECRET, consent.searchParams.get('state')!, NOW))?.visitorId).toBe(VISITOR);
		expect(window).toEqual({ from: '2026-12-03', to: '2026-12-16' });
	});

	it('connect answers 503 unless both the client id and secret are set', async () => {
		const app = googleRoutes({
			getStore: () => ({ list: () => ({ today: '2026-12-03' }), googleConnect: () => ({ ok: true }), googleDisconnect: () => ({ calendarRemoved: true }) }),
			env: () => ({ SECRET, GOOGLE_CLIENT_ID: 'client-1' }),
		});
		expect((await app.request(`/calendar/${VISITOR}/google/connect`, { method: 'POST' })).status).toBe(503);
	});

	/** Starts Connect like the browser does: the consent URL's state and the cookie set with it. */
	async function startConnect(app: ReturnType<typeof routes>['app']) {
		const res = await app.request(`http://localhost:5180/calendar/${VISITOR}/google/connect`, { method: 'POST' });
		const state = new URL(((await res.json()) as { url: string }).url).searchParams.get('state')!;
		const cookie = res.headers.get('set-cookie') ?? '';
		return { state, cookie, sent: cookie.split(';')[0] };
	}

	it('connect binds the round trip to the browser with an HttpOnly cookie scoped to the callback', async () => {
		const { cookie } = await startConnect(routes().app);
		expect(cookie).toMatch(/^google_oauth=[A-Za-z0-9_-]+;/);
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('SameSite=Lax');
		expect(cookie).toContain('Path=/api/google');
		expect(cookie).toContain('Max-Age=600');
	});

	it('a callback with a forged, tampered, or expired state connects nothing', async () => {
		const { app, connects } = routes();
		const { state: good, sent } = await startConnect(app);
		const tampered = good.replace(VISITOR, 'v_someone-else');
		const forged = await signState('another-secret', VISITOR, NOW);
		const expired = await signState(SECRET, VISITOR, NOW - STATE_TTL_MS - 1);
		for (const state of [tampered, forged, expired, '']) {
			const res = await app.request(`/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { headers: { cookie: sent } });
			expect(res.status).toBe(302);
			expect(res.headers.get('location')).toBe('/?google=failed&reason=state');
		}
		expect(connects).toEqual([]);

		const ok = await app.request(`http://localhost:5180/google/callback?code=good-code&state=${encodeURIComponent(good)}`, { headers: { cookie: sent } });
		expect(ok.headers.get('location')).toBe('/?google=connected');
		expect(ok.headers.get('set-cookie')).toMatch(/^google_oauth=;.*Max-Age=0/);
		expect(connects).toEqual([[VISITOR, 'good-code', 'http://localhost:5180/api/google/callback']]);
	});

	it('a valid state opened in another browser (no or another cookie) connects nothing (review round 3)', async () => {
		const { app, connects } = routes();
		const { state } = await startConnect(app);
		const { sent: otherBrowser } = await startConnect(app);
		for (const headers of [{}, { cookie: otherBrowser }] as Record<string, string>[]) {
			const res = await app.request(`/google/callback?code=good-code&state=${encodeURIComponent(state)}`, { headers });
			expect(res.headers.get('location')).toBe('/?google=failed&reason=state');
		}
		expect(connects).toEqual([]);
	});

	it('a declined consent redirects as denied', async () => {
		const { app, connects } = routes();
		const { state, sent } = await startConnect(app);
		const res = await app.request(`/google/callback?error=access_denied&state=${encodeURIComponent(state)}`, { headers: { cookie: sent } });
		expect(res.headers.get('location')).toBe('/?google=failed&reason=denied');
		expect(connects).toEqual([]);
	});

	it('connecting stores the refresh token sealed, creates the calendar, and reports the window', async () => {
		const google = fakeGoogle();
		const kv = memoryKv();
		const ledger = new VisitorLedger(kv, () => 0, () => NOW);
		const link = new GoogleLink({
			kv,
			fetch: google.fetcher,
			clock: () => NOW,
			secret: SECRET,
			client: { clientId: 'client-1', clientSecret: 'shh' },
			calendar: () => ledger.list(),
		});
		await link.connect('good-code', 'http://localhost:5180/api/google/callback');

		expect(JSON.stringify([...kv.map.values()])).not.toContain(REFRESH_TOKEN);
		expect(google.calendars.size).toBe(1);
		expect(link.status()).toEqual({ connected: true, window: { from: '2026-12-03', to: '2026-12-16' } });
	});
});
