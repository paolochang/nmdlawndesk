import { Hono } from 'hono';
import { type GoogleStatus, type SyncWindow, syncWindow } from './link.ts';
import { consentUrl, signState, verifyState } from './oauth.ts';

/** What the Google routes need from a visitor's store (the Durable Object stub in production). */
export interface GoogleStoreApi {
	list(): { today: string; google?: GoogleStatus } | Promise<{ today: string; google?: GoogleStatus }>;
	googleConnect(code: string, redirectUri: string): { ok: boolean } | Promise<{ ok: boolean }>;
	googleDisconnect(): { calendarRemoved: boolean } | Promise<{ calendarRemoved: boolean }>;
}

export interface GoogleRouteDeps {
	getStore: (visitorId: string) => GoogleStoreApi;
	env: () => { SECRET?: string; GOOGLE_CLIENT_ID?: string };
	now?: () => number;
}

/**
 * Google Calendar connect, callback, and disconnect (build-plan §14). Connect and
 * disconnect sit under `/calendar/:visitorId`, behind the auth guard; the callback is a
 * browser redirect from Google with no bearer token, so it trusts only the signed state.
 */
export function googleRoutes({ getStore, env, now = Date.now }: GoogleRouteDeps): Hono {
	const app = new Hono();
	const redirectUri = (url: string) => new URL('/api/google/callback', url).toString();

	app.post('/calendar/:visitorId/google/connect', async (c) => {
		const { SECRET, GOOGLE_CLIENT_ID } = env();
		if (!SECRET || !GOOGLE_CLIENT_ID) return c.json({ error: 'google not configured' }, 503);
		const visitorId = c.req.param('visitorId');
		const { today } = await getStore(visitorId).list();
		const state = await signState(SECRET, visitorId, now());
		const window: SyncWindow = syncWindow(today);
		return c.json({ url: consentUrl(GOOGLE_CLIENT_ID, redirectUri(c.req.url), state), window });
	});

	app.post('/calendar/:visitorId/google/disconnect', async (c) => c.json(await getStore(c.req.param('visitorId')).googleDisconnect()));

	app.get('/google/callback', async (c) => {
		const failed = (reason: string) => c.redirect(`/?google=failed&reason=${reason}`, 302);
		const { SECRET } = env();
		if (!SECRET) return failed('exchange');
		const visitorId = await verifyState(SECRET, c.req.query('state') ?? '', now());
		if (!visitorId) return failed('state');
		if (c.req.query('error')) return failed('denied');
		const code = c.req.query('code');
		if (!code) return failed('denied');
		const { ok } = await getStore(visitorId).googleConnect(code, redirectUri(c.req.url));
		return ok ? c.redirect('/?google=connected', 302) : failed('exchange');
	});

	return app;
}
