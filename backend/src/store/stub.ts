import { env } from 'cloudflare:workers';

// One VisitorStore per visitor, named `visitor-<visitorId>` (build-plan §6).
// Renaming it after deploy orphans data.
export const visitorStore = (visitorId: string) => env.VISITOR_STORE.getByName(`visitor-${visitorId}`);
