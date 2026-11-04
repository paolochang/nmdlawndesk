import { Hono } from 'hono';
import { RULES } from '../domain/rules.ts';
import type { VisitorSnapshot } from './ledger.ts';

/** What the routes need from a visitor's store (the Durable Object stub in production). */
export interface VisitorStoreApi {
	list(): VisitorSnapshot | Promise<VisitorSnapshot>;
	reset(): VisitorSnapshot | Promise<VisitorSnapshot>;
}

// visitorId is a truncated base64url HMAC (build-plan §8); it also names the Durable Object.
const VISITOR_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `/config` (Dave's rules for the UI) and `/calendar/:visitorId` (that visitor's
 * calendar, plus reset). The calendar routes sit behind the auth middleware
 * (`mountAuth` in src/auth/middleware.ts); `/config` stays public.
 */
export function storeRoutes(getStore: (visitorId: string) => VisitorStoreApi): Hono {
	const app = new Hono();

	app.get('/config', (c) => c.json(RULES));

	// `/*` also matches `/calendar/:visitorId` itself.
	app.use('/calendar/:visitorId/*', async (c, next) => {
		if (!VISITOR_ID.test(c.req.param('visitorId'))) return c.json({ error: 'invalid visitor id' }, 400);
		await next();
	});

	app.get('/calendar/:visitorId', async (c) => c.json(await getStore(c.req.param('visitorId')).list()));
	app.post('/calendar/:visitorId/reset', async (c) => c.json(await getStore(c.req.param('visitorId')).reset()));

	return app;
}
