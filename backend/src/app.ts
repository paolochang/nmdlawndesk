import { createAgentRouter } from '@flue/runtime/routing';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { DavePhone } from './agents/dave-phone.ts';
import { LawnDesk } from './agents/lawn-desk.ts';
import { mountAuth, WRITE_RATE_LIMIT } from './auth/middleware.ts';
import { conversationGuard } from './desk/conversation-guard.ts';
import { storeRoutes } from './store/routes.ts';
import { visitorStore } from './store/stub.ts';

// Every route lives under /api. The frontend Worker forwards /api/* unchanged
// through its service binding, so URLs the runtime builds from the request
// (such as a conversation's streamUrl) stay valid for the browser.
const app = new Hono().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

// POST /api/auth, plus the 401/403/429 guard on /api/agents/* and /api/calendar/*
// (build-plan §8). Mounted before those routes, or the guard never runs.
// /api/health and /api/config stay public.
mountAuth(app, {
	env: () => env,
	limit: (visitorId) => visitorStore(visitorId).hit(WRITE_RATE_LIMIT.limit, WRITE_RATE_LIMIT.windowMs),
});

// After auth: 400 for an id of the wrong kind, 409 for a message to an old generation.
const generation = async (visitorId: string) => (await visitorStore(visitorId).list()).generation;

// Customer conversations, `<visitorId>:<generation>:<customerPhone>` (build-plan §3):
//   curl -X POST "http://localhost:8787/api/agents/lawn-desk/$VISITOR_ID:1:+15550101" \
//     -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"How much to mow half an acre?"}'
// The customer's admitted texts are recorded, so a booking can only use a name and
// address the customer texted (build-plan §13).
app.use(
	'/agents/lawn-desk/:id/*',
	conversationGuard('customer', generation, async (conversation, text) => {
		await visitorStore(conversation.visitorId).addCustomerText(
			conversation.kind === 'customer' ? conversation.phone : '',
			text,
			conversation.generation,
		);
	}),
);
app.route('/agents/lawn-desk', createAgentRouter(LawnDesk));

// Dave's phone, `<visitorId>:<generation>:dave`: alerts landed here until build-plan §13
// moved Dave's texts into the visitor store; kept read-only (405 to any message, so no
// model call) so older conversations still open.
app.use('/agents/dave-phone/:id/*', conversationGuard('dave', generation, undefined, { readOnly: true }));
app.route('/agents/dave-phone', createAgentRouter(DavePhone));

// /api/config and /api/calendar/:visitorId[/reset].
app.route('/', storeRoutes(visitorStore));

export default app;
