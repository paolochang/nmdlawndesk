// Worker-level Cloudflare code lives here; HTTP routing stays in src/app.ts.
//
//   - Named exports become top-level Worker exports — e.g. application-owned
//     Durable Object classes (declare their bindings in wrangler.jsonc).
//   - An optional default export adds non-HTTP handlers: scheduled (cron),
//     queue consumers, inbound email, etc. (never `fetch`).
//
// https://flueframework.com/docs/guide/cloudflare-target/#extending-cloudflarets-entrypoint

import { setProvider } from '@flue/runtime';
import { cloudflareBindingProvider } from '@flue/runtime/cloudflare/workers-ai';
import { env } from 'cloudflare:workers';
import { withoutThinking } from './desk/model.ts';

export { VisitorStore } from './store/visitor-store.ts';

// The Workers AI provider, with the desk model's thinking turned off when
// `DESK_THINKING_OFF` is set (build-plan §16; off by default until the E2E decides).
// Registered before the generated entry, which then keeps this `cloudflare` provider.
setProvider(cloudflareBindingProvider({ binding: withoutThinking(env.AI) }));
