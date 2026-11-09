import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { type GoogleStatus, type SyncWindow, syncWindow } from './link.ts';
import { consentUrl, signState, STATE_TTL_MS, verifyState } from './oauth.ts';

/**
 * Holds the state's nonce in the browser that started Connect, so a consent link sent to
 * someone else cannot link their Google account to the sender's demo (review round 3).
 * `Lax` still reaches the callback: Google's redirect is a top-level GET.
 */
const COOKIE = 'google_oauth';
const COOKIE_PATH = '/api/google';

/** What the Google routes need from a visitor's store (the Durable Object stub in production). */
export interface GoogleStoreApi {
	list(): { today: string; google?: GoogleStatus } | Promise<{ today: string; google?: GoogleStatus }>;
	googleConnect(code: string, redirectUri: string): { ok: boolean } | Promise<{ ok: boolean }>;
	googleDisconnect(): { calendarRemoved: boolean } | Promise<{ calendarRemoved: boolean }>;
}

export interface GoogleRouteDeps {
	getStore: (visitorId: string) => GoogleStoreApi;
	env: () => { SECRET?: string; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string };
	now?: () => number;
}

/**
 * Google Calendar connect, callback, and disconnect (build-plan §14). Connect and
 * disconnect sit under `/calendar/:visitorId`, behind the auth guard; the callback is a
 * browser redirect from Google with no bearer token, so it trusts only the signed state,
 * and only in the browser holding that state's nonce cookie.
 */
export function googleRoutes({ getStore, env, now = Date.now }: GoogleRouteDeps): Hono {
	const app = new Hono();
	const redirectUri = (url: string) => new URL('/api/google/callback', url).toString();

	app.post('/calendar/:visitorId/google/connect', async (c) => {
		const { SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env();
		if (!SECRET || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return c.json({ error: 'google not configured' }, 503);
		const visitorId = c.req.param('visitorId');
		const { today } = await getStore(visitorId).list();
		const state = await signState(SECRET, visitorId, now());
		setCookie(c, COOKIE, state.split('.')[2], {
			httpOnly: true,
			secure: new URL(c.req.url).protocol === 'https:',
			sameSite: 'Lax',
			path: COOKIE_PATH,
			maxAge: STATE_TTL_MS / 1000,
		});
		const window: SyncWindow = syncWindow(today);
		return c.json({ url: consentUrl(GOOGLE_CLIENT_ID, redirectUri(c.req.url), state), window });
	});

	app.post('/calendar/:visitorId/google/disconnect', async (c) => c.json(await getStore(c.req.param('visitorId')).googleDisconnect()));

	app.get('/google/callback', async (c) => {
		const failed = (reason: string) => c.redirect(`/?google=failed&reason=${reason}`, 302);
		const { SECRET } = env();
		if (!SECRET) return failed('exchange');
		const verified = await verifyState(SECRET, c.req.query('state') ?? '', now());
		const bound = verified !== null && getCookie(c, COOKIE) === verified.nonce;
		deleteCookie(c, COOKIE, { path: COOKIE_PATH });
		if (!verified || !bound) return failed('state');
		const { visitorId } = verified;
		if (c.req.query('error')) return failed('denied');
		const code = c.req.query('code');
		if (!code) return failed('denied');
		const { ok } = await getStore(visitorId).googleConnect(code, redirectUri(c.req.url));
		return ok ? c.redirect('/?google=connected', 302) : failed('exchange');
	});

	return app;
}
