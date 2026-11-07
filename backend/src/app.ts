import { createAgentRouter } from '@flue/runtime/routing';
import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { LawnDesk } from './agents/lawn-desk.ts';
import { storeRoutes } from './store/routes.ts';

// Every route lives under /api. The frontend Worker forwards /api/* unchanged
// through its service binding, so URLs the runtime builds from the request
// (such as a conversation's streamUrl) stay valid for the browser.
const app = new Hono().basePath('/api');

app.get('/health', (c) => c.json({ ok: true }));

//   curl -X POST http://localhost:5173/api/agents/lawn-desk/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"How much to mow half an acre?"}'
app.route('/agents/lawn-desk', createAgentRouter(LawnDesk));

// /api/config and /api/calendar/:visitorId[/reset], one VisitorStore per visitor,
// named `visitor-<visitorId>` (build-plan §6). Renaming it after deploy orphans data.
app.route('/', storeRoutes((visitorId) => env.VISITOR_STORE.getByName(`visitor-${visitorId}`)));

export default app;
