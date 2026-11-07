import { createAgentRouter } from '@flue/runtime/routing';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { LawnDesk } from './agents/lawn-desk.ts';
import { mountAuth, WRITE_RATE_LIMIT } from './auth/middleware.ts';
import { storeRoutes } from './store/routes.ts';

// Every route lives under /api. The frontend Worker forwards /api/* unchanged
// through its service binding, so URLs the runtime builds from the request
// (such as a conversation's streamUrl) stay valid for the browser.
const app = new Hono().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

// One VisitorStore per visitor, named `visitor-<visitorId>` (build-plan §6).
// Renaming it after deploy orphans data.
const visitorStore = (visitorId: string) => env.VISITOR_STORE.getByName(`visitor-${visitorId}`);

// POST /api/auth, plus the 401/403/429 guard on /api/agents/* and /api/calendar/*
// (build-plan §8). Mounted before those routes, or the guard never runs.
// /api/health and /api/config stay public.
mountAuth(app, {
	env: () => env,
	limit: (visitorId) => visitorStore(visitorId).hit(WRITE_RATE_LIMIT.limit, WRITE_RATE_LIMIT.windowMs),
});

//   curl -X POST "http://localhost:8787/api/agents/lawn-desk/$VISITOR_ID:1:dave" \
//     -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"How much to mow half an acre?"}'
app.route('/agents/lawn-desk', createAgentRouter(LawnDesk));

// /api/config and /api/calendar/:visitorId[/reset].
app.route('/', storeRoutes(visitorStore));

export default app;
