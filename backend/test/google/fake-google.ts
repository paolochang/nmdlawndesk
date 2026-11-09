// A stand-in for Google's token, revoke, and Calendar endpoints, served through an
// injected `fetch`. It hands out a fixed refresh token, so tests can check it never
// lands in storage in the clear.
export const REFRESH_TOKEN = 'rt-test-refresh-token';

export interface FakeEvent {
	id: string;
	summary: string;
	description: string;
	start: { dateTime: string; timeZone: string };
	end: { dateTime: string; timeZone: string };
}

export function fakeGoogle() {
	const calendars = new Map<string, Map<string, FakeEvent>>();
	const requests: string[] = [];
	const state = { failCalendar: false, revoked: false, nextId: 1 };

	const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const method = init?.method ?? 'GET';
		requests.push(`${method} ${url.host}${url.pathname}`);
		const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

		if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
			const params = new URLSearchParams(String(init?.body));
			if (state.revoked) return json({ error: 'invalid_grant' }, 400);
			const fresh = params.get('grant_type') === 'authorization_code';
			if (fresh && params.get('code') !== 'good-code') return json({ error: 'invalid_request' }, 400);
			return json({ access_token: `at-${state.nextId++}`, expires_in: 3600, ...(fresh ? { refresh_token: REFRESH_TOKEN } : {}) });
		}
		if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
			state.revoked = true;
			return json({});
		}
		if (state.failCalendar) return json({ error: { code: 500 } }, 500);

		const [, , , , calendarId, , eventId] = url.pathname.split('/').map(decodeURIComponent);
		// /calendar/v3/calendars[/<id>[/events[/<eventId>]]]
		if (method === 'POST' && url.pathname === '/calendar/v3/calendars') {
			const id = `cal-${state.nextId++}@group.calendar.google.com`;
			calendars.set(id, new Map());
			return json({ id, ...JSON.parse(String(init?.body)) });
		}
		const calendar = calendarId ? calendars.get(calendarId) : undefined;
		if (!calendar) return json({ error: { code: 404 } }, 404);
		if (method === 'DELETE' && !url.pathname.includes('/events')) {
			calendars.delete(calendarId);
			return new Response(null, { status: 204 });
		}
		if (method === 'POST') {
			const id = `ev-${state.nextId++}`;
			calendar.set(id, { id, ...JSON.parse(String(init?.body)) });
			return json({ id });
		}
		if (method === 'DELETE') {
			if (!calendar.delete(eventId)) return json({ error: { code: 410 } }, 410);
			return new Response(null, { status: 204 });
		}
		return json({ error: { code: 400 } }, 400);
	}) as typeof fetch;

	return { fetcher, calendars, requests, state };
}

/** An in-memory stand-in for the Durable Object's synchronous KV. */
export function memoryKv() {
	const map = new Map<string, unknown>();
	return {
		map,
		get: <T>(key: string) => map.get(key) as T | undefined,
		put: (key: string, value: unknown) => void map.set(key, value),
		delete: (key: string) => map.delete(key),
	};
}
